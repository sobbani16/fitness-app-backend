const express = require('express');
const { getPrisma } = require('../lib/prisma');
const {
  listSupplements,
  searchSupplements,
  addSupplement,
  addPersonalSupplement,
  getUserSupplements,
  selectSupplement,
  deselectSupplement,
} = require('../services/supplementService');
const { guidanceFor } = require('../services/supplements/timingGuidance');
const { evaluateUserSupplements } = require('../services/supplements/safetyEngine');
const schedSvc = require('../services/supplements/schedules');

const router = express.Router();
router.use(require('../middleware/requireFeature').requireFeature('supplements'));

// The global authenticate middleware already rewrites x-user-id to the verified
// session identity; req.userId is always authoritative downstream.
function getUserId(req) {
  return (req.userId || req.headers['x-user-id'] || req.query.userId || '').toString().trim();
}

function requireUser(req, res) {
  const userId = getUserId(req);
  if (!userId) res.status(401).json({ error: 'Authentication required' });
  return userId;
}

// GET /supplements — browsable catalog (published + candidate + own personal).
router.get('/', async (req, res) => {
  try {
    const supplements = await listSupplements({ userId: getUserId(req) });
    res.json({ supplements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /supplements/search?q=creatine — name + alias search. Includes
// review_only entries flagged `research: true` unless ?skipReview=true.
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || req.query.query || '').toString();
    if (!q.trim()) return res.status(400).json({ error: 'q (query) is required' });
    const results = await searchSupplements(q, {
      userId: getUserId(req),
      includeReviewOnly: req.query.skipReview !== 'true',
    });
    res.json({
      results: results.map(s => ({
        ...s,
        research: s.catalogStatus === 'review_only' || s.catalogStatus === 'candidate',
        unverified: s.reviewStatus === 'UNREVIEWED_RESEARCH_DRAFT',
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /supplements/mine — the user's selected supplements.
router.get('/mine', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const supplements = await getUserSupplements(userId);
    res.json({ supplements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /supplements/mine — add a catalog supplement to the user's list.
router.post('/mine', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { supplementId } = req.body || {};
    if (!supplementId) return res.status(400).json({ error: 'supplementId is required' });
    const result = await selectSupplement(userId, supplementId);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /supplements/mine/:supplementId — remove from the user's list.
router.delete('/mine/:supplementId', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    await deselectSupplement(userId, req.params.supplementId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /supplements/mine/:userSupplementId — user dose/notes (user-entered,
// never system-recommended).
router.patch('/mine/:userSupplementId', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const prisma = getPrisma();
    const link = await prisma.userSupplement.findUnique({ where: { id: req.params.userSupplementId } });
    if (!link || link.userId !== userId) return res.status(404).json({ error: 'Not in your list' });
    const data = {};
    if (req.body.doseAmount !== undefined) {
      const n = req.body.doseAmount == null ? null : Number(req.body.doseAmount);
      if (n != null && (!Number.isFinite(n) || n <= 0 || n > 100000)) return res.status(400).json({ error: 'doseAmount must be a positive number' });
      data.doseAmount = n;
    }
    if (req.body.doseUnit !== undefined) data.doseUnit = req.body.doseUnit == null ? null : String(req.body.doseUnit).slice(0, 20);
    if (req.body.notes !== undefined) data.notes = req.body.notes == null ? null : String(req.body.notes).slice(0, 500);
    const updated = await prisma.userSupplement.update({ where: { id: link.id }, data });
    res.json({ userSupplement: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /supplements/detail/:supplementId — education + timing + safety context.
router.get('/detail/:supplementId', async (req, res) => {
  try {
    const userId = getUserId(req);
    const prisma = getPrisma();
    const s = await prisma.supplement.findUnique({
      where: { id: req.params.supplementId },
      include: {
        ingredient: { include: { aliases: true, forms: true } },
        form: true,
        product: { include: { ingredients: { include: { ingredient: true } } } },
        attributes: true,
        supplementRules: true,
        education: { include: { sources: true } },
      },
    });
    if (!s) return res.status(404).json({ error: 'Supplement not found' });
    if (s.ownerId && s.ownerId !== userId) return res.status(404).json({ error: 'Supplement not found' });
    const edu = s.education;
    const guidance = edu ? guidanceFor({
      timingCode: edu.timingCode,
      timingStrength: edu.timingStrength,
      relativeAnchor: edu.relativeAnchor,
      evidenceClass: edu.evidenceClass,
      productLabelRequired: Boolean(edu.labelExceptions),
    }) : guidanceFor({ timingCode: 'FOLLOW_LABEL' });
    if (edu?.timingRationale) guidance.rationale = edu.timingRationale;
    res.json({
      supplement: s,
      education: edu,
      guidance,
      labels: {
        research: s.catalogStatus === 'review_only' || s.catalogStatus === 'candidate',
        reviewOnly: s.catalogStatus === 'review_only',
        unverified: s.reviewStatus === 'UNREVIEWED_RESEARCH_DRAFT',
        evidenceReviewed: edu ? edu.reviewStatus === 'PUBLISHED' || edu.reviewStatus === 'APPROVED' : false,
      },
      disclaimer: 'Educational information, not medical advice. Review supplements and timing with a clinician or pharmacist, especially with medicines or health conditions.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /supplements/personal — create an owner-scoped personal supplement and
// add it to the user's list. Never writes to the shared catalog.
router.post('/personal', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const result = await addPersonalSupplement(userId, req.body || {});
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /supplements — legacy shared-catalog upsert. Restricted: non-admin
// calls create a personal entry instead so user content never silently
// publishes to the trusted catalog.
router.post('/', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const prisma = getPrisma();
    const adminRole = await prisma.userRole.findFirst({
      where: { userId, active: true, role: { name: { in: ['SUPER_ADMIN', 'ADMIN'] } } },
      select: { id: true },
    });
    if (adminRole) {
      const supplement = await addSupplement(req.body || {});
      return res.status(201).json(supplement);
    }
    const result = await addPersonalSupplement(userId, req.body || {});
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /supplements/safety — personalized safety context for the user's list.
router.get('/safety', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    res.json(await evaluateUserSupplements(getPrisma(), userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Schedules -------------------------------------------------------------

// GET /supplements/mine/:userSupplementId/schedules
router.get('/mine/:userSupplementId/schedules', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const prisma = getPrisma();
    const link = await prisma.userSupplement.findUnique({ where: { id: req.params.userSupplementId } });
    if (!link || link.userId !== userId) return res.status(404).json({ error: 'Not in your list' });
    const schedules = await prisma.supplementSchedule.findMany({
      where: { userSupplementId: link.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ schedules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /supplements/mine/:userSupplementId/schedules — create a schedule.
router.post('/mine/:userSupplementId/schedules', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const prisma = getPrisma();
    const link = await prisma.userSupplement.findUnique({ where: { id: req.params.userSupplementId }, include: { supplement: true } });
    if (!link || link.userId !== userId) return res.status(404).json({ error: 'Not in your list' });
    const { errors, data } = schedSvc.validateScheduleInput(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    if (!data.reminderTime && !data.fallbackTime && data.notifyEnabled !== false && data.frequency !== 'as_needed') {
      return res.status(400).json({ error: 'A reminder needs reminderTime (fixed) or fallbackTime (anchored) — or set notifyEnabled false.' });
    }
    const schedule = await prisma.supplementSchedule.create({
      data: {
        userId,
        userSupplementId: link.id,
        supplementId: link.supplementId,
        dose: data.dose ?? null,
        doseAmount: data.doseAmount ?? link.doseAmount ?? null,
        doseUnit: data.doseUnit ?? link.doseUnit ?? null,
        frequency: data.frequency || 'daily',
        daysOfWeek: data.daysOfWeek ?? null,
        timingRelation: data.timingRelation || 'FIXED_TIME',
        mealAnchor: data.mealAnchor ?? null,
        workoutAnchor: Boolean(data.workoutAnchor),
        reminderTime: data.reminderTime ?? null,
        fallbackTime: data.fallbackTime ?? null,
        timezonePolicy: data.timezonePolicy || 'FOLLOW_DEVICE',
        startDate: data.startDate ?? null,
        endDate: data.endDate ?? null,
        active: data.active !== false,
        notifyEnabled: data.notifyEnabled !== false,
        soundEnabled: data.soundEnabled !== false,
        snoozeMinutes: data.snoozeMinutes ?? 30,
        instructions: data.instructions ?? null,
        timeOfDay: data.timeOfDay ?? null,
      },
    });
    const created = await schedSvc.generateOccurrences(prisma, schedule, { days: 14 });
    res.status(201).json({ schedule, occurrencesCreated: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /supplements/schedules/:id — update; regenerates future occurrences.
router.put('/schedules/:id', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const prisma = getPrisma();
    const existing = await prisma.supplementSchedule.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== userId) return res.status(404).json({ error: 'Schedule not found' });
    const { errors, data } = schedSvc.validateScheduleInput(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    const schedule = await prisma.supplementSchedule.update({ where: { id: existing.id }, data });
    // Future PENDING occurrences regenerate under the new schedule; past and
    // acted-on occurrences are history and stay untouched.
    const today = new Date().toISOString().slice(0, 10);
    await prisma.supplementDoseOccurrence.updateMany({
      where: { scheduleId: schedule.id, status: 'PENDING', localDate: { gte: today } },
      data: { status: 'CANCELLED' },
    });
    const created = await schedSvc.generateOccurrences(prisma, schedule, { days: 14 });
    res.json({ schedule, occurrencesCreated: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /supplements/schedules/:id — cancels the schedule and pending doses.
router.delete('/schedules/:id', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const prisma = getPrisma();
    const existing = await prisma.supplementSchedule.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== userId) return res.status(404).json({ error: 'Schedule not found' });
    await prisma.supplementDoseOccurrence.updateMany({
      where: { scheduleId: existing.id, status: { in: ['PENDING', 'SNOOZED'] } },
      data: { status: 'CANCELLED' },
    });
    await prisma.supplementSchedule.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Dose occurrences ------------------------------------------------------

// GET /supplements/doses/today?date=YYYY-MM-DD — doses for a local day.
router.get('/doses/today', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const prisma = getPrisma();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : new Date().toISOString().slice(0, 10);
    // Ensure today's occurrences exist for active schedules (idempotent).
    await schedSvc.reviveSnoozed(prisma);
    const occurrences = await schedSvc.listOccurrences(prisma, userId, { date });
    res.json({ date, occurrences });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /supplements/doses/upcoming?days=14 — generates + lists upcoming doses.
router.get('/doses/upcoming', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const prisma = getPrisma();
    const days = Math.min(Number(req.query.days) || 14, 30);
    await schedSvc.reviveSnoozed(prisma);
    await schedSvc.regenerateForUser(prisma, userId, { days });
    const occurrences = await schedSvc.listOccurrences(prisma, userId, { days });
    res.json({ days, occurrences });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /supplements/doses/:id/action — taken | skipped | snoozed | pending | cancelled.
router.post('/doses/:id/action', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const action = String(req.body?.action || '').toLowerCase();
    const result = await schedSvc.actOnOccurrence(getPrisma(), userId, req.params.id, action, req.body || {});
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /supplements/history?days=30 — occurrences + adherence summary.
router.get('/history', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const prisma = getPrisma();
    const days = Math.min(Number(req.query.days) || 30, 90);
    const occurrences = await schedSvc.listOccurrences(prisma, userId, { days });
    const [week, month] = await Promise.all([
      schedSvc.adherence(prisma, userId, { days: 7 }),
      schedSvc.adherence(prisma, userId, { days: 30 }),
    ]);
    res.json({ occurrences, adherence: { week, month } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /supplements/timing/:supplementId — qualified timing guidance.
router.get('/timing/:supplementId', async (req, res) => {
  try {
    const prisma = getPrisma();
    const edu = await prisma.supplementEducation.findUnique({ where: { supplementId: req.params.supplementId } });
    const guidance = guidanceFor({
      timingCode: edu?.timingCode,
      timingStrength: edu?.timingStrength,
      relativeAnchor: edu?.relativeAnchor,
      evidenceClass: edu?.evidenceClass,
      productLabelRequired: Boolean(edu?.labelExceptions),
    });
    if (edu?.timingRationale) guidance.rationale = edu.timingRationale;
    res.json({ guidance, reviewed: edu ? edu.reviewStatus === 'PUBLISHED' : false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /supplements/log — record that the user took a supplement today.
// Kept for backward compatibility; scheduled doses should use /doses/:id/action.
router.post('/log', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { userSupplementId, date, quantity, idempotencyKey, amount, unit } = req.body || {};
    if (!userSupplementId) return res.status(400).json({ error: 'userSupplementId required' });

    const prisma = getPrisma();
    const link = await prisma.userSupplement.findUnique({ where: { id: userSupplementId }, include: { supplement: true } });
    if (!link || link.userId !== userId) return res.status(404).json({ error: 'Supplement not found in your list' });

    const today = date || new Date().toISOString().slice(0, 10);
    const q = Number(quantity) || 1;
    const sup = link.supplement;
    const idem = idempotencyKey ? String(idempotencyKey).slice(0, 120) : null;
    if (idem) {
      const existing = await prisma.supplementLog.findUnique({ where: { idempotencyKey: idem } }).catch(() => null);
      if (existing) return res.status(200).json({ ...existing, idempotent: true });
    }

    const log = await prisma.supplementLog.create({
      data: {
        userId,
        userSupplementId,
        supplementName: sup.name,
        quantity: q,
        calories: (sup.calories || 0) * q,
        proteinG: (sup.proteinG || 0) * q,
        carbsG: (sup.carbsG || 0) * q,
        fatG: (sup.fatG || 0) * q,
        fiberG: (sup.fiberG || 0) * q,
        amount: amount != null && Number.isFinite(Number(amount)) ? Number(amount) : null,
        unit: unit != null ? String(unit) : null,
        date: today,
      },
    });
    await prisma.userSupplement.update({ where: { id: link.id }, data: { lastTakenAt: new Date() } }).catch(() => {});
    res.status(201).json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /supplements/log/:id — remove a supplement log entry.
router.delete('/log/:id', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const prisma = getPrisma();
    await prisma.supplementLog.deleteMany({ where: { id: req.params.id, userId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /supplements/log — get supplement logs (optionally ?date=YYYY-MM-DD).
router.get('/log', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const prisma = getPrisma();
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const logs = await prisma.supplementLog.findMany({ where: { userId, date }, orderBy: { loggedAt: 'desc' } });
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
