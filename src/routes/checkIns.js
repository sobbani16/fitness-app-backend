// Structured weekly check-ins between a member and their coach.
// Member submits → trainer (approved + active relation) reviews and replies.
// Check-ins are member-authored disclosures to their coach — they require an
// ACTIVE relation but not per-category consent (the member sent them directly).
const express = require('express');
const { identifyUser } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { requireApprovedTrainer, requireRelationParticipant, forbidden } = require('../services/trainerAccess');
const { loadDisplayNames } = require('../services/trainerService');
const audit = require('../services/auditService');
const { coachingTransaction } = require('../services/coachingTransaction');

const router = express.Router();
router.use(requireFeature('trainer_coaching'), identifyUser);

function weekStart(value) {
  const d = value ? new Date(value) : new Date();
  if (!Number.isFinite(d.getTime())) throw httpError(400, 'Invalid weekOf');
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7)); // Monday UTC
  return day;
}

function str(v, max = 2000) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) throw httpError(400, `Field exceeds ${max} characters`);
  return s;
}
function scale(v, name) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw httpError(400, `${name} must be 1-5`);
  return n;
}

// POST /check-ins {relationId, weekOf?, ...} — member submits this week's check-in.
// Upserts while unreviewed; once the trainer reviewed, a new week is required.
router.post('/', async (req, res) => {
  try {
    const { relationId } = req.body || {};
    if (typeof relationId !== 'string') throw httpError(400, 'relationId required');
    const prisma = getPrisma();
    const relation = await prisma.trainerClient.findUnique({ where: { id: relationId } });
    if (!relation || relation.clientId !== req.userId) throw forbidden('Not your coaching relationship.');
    if (relation.status !== 'active') throw forbidden('Coaching relationship is not active.');

    const data = {
      goalProgress: str(req.body.goalProgress, 1000),
      workoutDifficulty: scale(req.body.workoutDifficulty, 'workoutDifficulty'),
      energyLevel: scale(req.body.energyLevel, 'energyLevel'),
      weightKg: req.body.weightKg == null ? null : (() => {
        const n = Number(req.body.weightKg);
        if (!Number.isFinite(n) || n < 20 || n > 400) throw httpError(400, 'Invalid weightKg');
        return n;
      })(),
      questions: str(req.body.questions),
      challenges: str(req.body.challenges),
      notes: str(req.body.notes),
    };
    const wk = weekStart(req.body.weekOf);

    const checkIn = await coachingTransaction(async tx => {
      const existing = await tx.checkIn.findUnique({
        where: { relationId_weekOf: { relationId, weekOf: wk } },
      });
      if (existing?.reviewedAt) throw httpError(409, 'This week was already reviewed by your coach.');
      const saved = existing
        ? await tx.checkIn.update({ where: { id: existing.id }, data })
        : await tx.checkIn.create({ data: { relationId, clientId: req.userId, weekOf: wk, ...data } });
      await audit.log({
        actorId: req.userId, action: 'checkin.submit', entityType: 'CheckIn',
        entityId: saved.id, afterData: { relationId, weekOf: wk },
      }, tx);
      // Optional same-payload weight update lands on the member's trend.
      if (data.weightKg != null) {
        await tx.weightEntry.create({ data: { userId: req.userId, weightKg: data.weightKg } });
      }
      return saved;
    });
    res.status(201).json(checkIn);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /check-ins/mine — member's own history.
router.get('/mine', async (req, res) => {
  try {
    const checkIns = await getPrisma().checkIn.findMany({
      where: { clientId: req.userId },
      orderBy: { weekOf: 'desc' },
      take: 52,
    });
    res.json({ checkIns });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /check-ins/trainer?clientId=&unreviewed=1 — approved trainer's queue.
router.get('/trainer', async (req, res) => {
  try {
    const trainer = await requireApprovedTrainer(req.userId);
    const prisma = getPrisma();
    const where = {
      relation: { trainerId: trainer.id, status: 'active' },
      ...(req.query.unreviewed === '1' ? { reviewedAt: null } : {}),
      ...(typeof req.query.clientId === 'string' && req.query.clientId ? { clientId: req.query.clientId } : {}),
    };
    const rows = await prisma.checkIn.findMany({
      where, orderBy: [{ reviewedAt: 'asc' }, { weekOf: 'desc' }], take: 100,
      include: { relation: { select: { id: true, status: true } } },
    });
    const names = await loadDisplayNames([...new Set(rows.map(r => r.clientId))]);
    res.json({ checkIns: rows.map(r => ({ ...r, clientName: names.get(r.clientId) || 'Client' })) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /check-ins/:id — either participant only.
router.get('/:id', async (req, res) => {
  try {
    const checkIn = await getPrisma().checkIn.findUnique({ where: { id: req.params.id } });
    if (!checkIn) throw httpError(404, 'Check-in not found.');
    await requireRelationParticipant(checkIn.relationId, req.userId);
    res.json(checkIn);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /check-ins/:id/review {reply?} — trainer reviews; read-only to the client.
router.post('/:id/review', async (req, res) => {
  try {
    const trainer = await requireApprovedTrainer(req.userId);
    const prisma = getPrisma();
    const checkIn = await prisma.checkIn.findUnique({
      where: { id: req.params.id },
      include: { relation: true },
    });
    if (!checkIn) throw httpError(404, 'Check-in not found.');
    if (checkIn.relation.trainerId !== trainer.id) throw forbidden('Not your client.');
    if (checkIn.relation.status !== 'active') throw forbidden('Coaching relationship is not active.');

    const saved = await coachingTransaction(async tx => {
      const saved = await tx.checkIn.update({
        where: { id: checkIn.id },
        data: { reviewedAt: new Date(), reviewedBy: req.userId, trainerReply: str(req.body?.reply) },
      });
      await audit.log({
        actorId: req.userId, action: 'checkin.review', entityType: 'CheckIn',
        entityId: checkIn.id, afterData: { relationId: checkIn.relationId },
      }, tx);
      return saved;
    });
    res.json(saved);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
