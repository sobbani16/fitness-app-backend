const express = require('express');
const router = express.Router();
const { getPrisma } = require('../lib/prisma');
const planner = require('../services/workoutPlanner');
const { suggestNext, missedSessionNote } = require('../services/workoutProgression');
const { classify } = require('../services/exerciseSuitability');
const { EXERCISES } = require('../services/exerciseCatalog');

function getUserId(req) {
  return (req.headers['x-user-id'] || req.body?.userId || '').toString().trim();
}

// POST /personal-plans/draft — AI-generate a draft plan (never auto-active).
router.post('/draft', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const prefs = req.body?.preferences || {};
    const draft = await planner.generateDraft(userId, prefs);
    const prisma = getPrisma();
    const prev = await prisma.userWorkoutPlan.count({ where: { userId } });
    const rec = await prisma.userWorkoutPlan.create({
      data: { userId, version: prev + 1, status: 'draft', preferences: prefs, plan: { ...draft.plan, meta: { warnings: draft.warnings, catalogVersion: draft.catalogVersion, ruleVersion: draft.ruleVersion } } },
    });
    res.status(201).json({ id: rec.id, version: rec.version, ...draft });
  } catch (e) { next(e); }
});

// GET /personal-plans — user's plan history (drafts + active).
router.get('/', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const plans = await getPrisma().userWorkoutPlan.findMany({
      where: { userId }, orderBy: { version: 'desc' }, take: 20,
      select: { id: true, version: true, status: true, plan: true, preferences: true, createdAt: true, confirmedAt: true },
    });
    res.json({ plans });
  } catch (e) { next(e); }
});

// PUT /personal-plans/:id — edit a draft; re-validates deterministically.
router.put('/:id', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const prisma = getPrisma();
    const rec = await prisma.userWorkoutPlan.findUnique({ where: { id: req.params.id } });
    if (!rec || rec.userId !== userId) return res.status(404).json({ error: 'Plan not found' });
    if (rec.status !== 'draft') return res.status(409).json({ error: 'Only draft plans can be edited' });
    const prefs = req.body?.preferences || rec.preferences || {};
    const { plan, warnings } = planner.validateEditedPlan(req.body?.plan || rec.plan, prefs);
    const updated = await prisma.userWorkoutPlan.update({
      where: { id: rec.id, status: 'draft' },
      data: { plan: { ...plan, meta: { warnings, edited: true } }, preferences: prefs },
    });
    res.json({ id: updated.id, version: updated.version, plan, warnings });
  } catch (e) { next(e); }
});

// POST /personal-plans/:id/confirm — explicit activation; archives prior actives.
router.post('/:id/confirm', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const prisma = getPrisma();
    const result = await prisma.$transaction(async tx => {
      // Serialize activation for an account so concurrent confirmations cannot
      // leave two active plans. Re-read status after obtaining the lock.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const rec = await tx.userWorkoutPlan.findUnique({ where: { id: req.params.id } });
      if (!rec || rec.userId !== userId) return { status: 404, body: { error: 'Plan not found' } };
      if (rec.status === 'active') return { status: 200, body: { id: rec.id, status: 'active' } };
      if (rec.status !== 'draft') return { status: 409, body: { error: 'Only draft plans can be activated' } };
      const validated = planner.validateEditedPlan(rec.plan, rec.preferences || {});
      if (validated.warnings.length) return { status: 409, body: { error: 'Review and save the adjusted draft before activating it' } };
      await tx.userWorkoutPlan.updateMany({ where: { userId, status: 'active' }, data: { status: 'archived' } });
      await tx.userWorkoutPlan.update({ where: { id: rec.id }, data: { status: 'active', confirmedAt: new Date() } });
      return { status: 200, body: { id: rec.id, status: 'active' } };
    });
    res.status(result.status).json(result.body);
  } catch (e) { next(e); }
});

// GET /personal-plans/catalog?equipment=&limitations=&experience= —
// catalog with per-exercise suitability for replacement/browse pickers.
router.get('/catalog', async (req, res, next) => {
  try {
    if (!getUserId(req)) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const parse = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
    const profile = {
      limitations: parse(req.query.limitations),
      experience: req.query.experience || undefined,
      equipment: req.query.equipment !== undefined ? parse(req.query.equipment) : undefined,
    };
    const exercises = Object.entries(EXERCISES).map(([id, e]) => ({ id, ...e, suitability: classify(id, profile) }));
    res.json({ exercises });
  } catch (e) { next(e); }
});

// GET /personal-plans/suggestions?rir=&discomfort=&missed= —
// per-exercise progression suggestions for the active plan, from logged history.
router.get('/suggestions', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const prisma = getPrisma();
    const active = await prisma.userWorkoutPlan.findFirst({ where: { userId, status: 'active' }, orderBy: { version: 'desc' } });
    if (!active) return res.json({ suggestions: [], note: 'No active plan.' });
    const exerciseIds = [...new Set((active.plan?.days || []).flatMap(d => (d.exercises || []).map(e => e.exerciseId)))];
    const sessions = await prisma.workoutSession.findMany({
      where: { userId, finishedAt: { not: null } }, orderBy: { startedAt: 'desc' }, take: 20,
      include: { exerciseSets: true },
    });
    sessions.reverse();
    // feedback: JSON map exerciseId -> { rir, discomfort } captured after
    // each finished session; per-exercise values take precedence over the
    // global rir/discomfort query params.
    let feedback = {};
    try { feedback = req.query.feedback ? JSON.parse(req.query.feedback) : {}; } catch { feedback = {}; }
    const rir = req.query.rir != null ? Number(req.query.rir) : null;
    const discomfort = req.query.discomfort === 'true';
    const suggestions = exerciseIds.map(id => {
      const latestSession = [...sessions].reverse().find(s => s.exerciseSets.some(x => String(x.exerciseName || '').toLowerCase().replace(/-/g, ' ').trim() === id.replace(/-/g, ' ')));
      const fb = latestSession && feedback[id]?.sessionId && feedback[id].sessionId === latestSession.id ? feedback[id] : {};
      const exRir = fb.rir != null ? Number(fb.rir) : rir;
      const exDiscomfort = fb.discomfort != null ? !!fb.discomfort : discomfort;
      // Match catalog id to logged exerciseName (hyphen/space tolerant).
      const normalize = value => String(value || '').toLowerCase().replace(/-/g, ' ').trim();
      const needle = normalize(id);
      const history = sessions.map(s => ({
        sets: s.exerciseSets.filter(x => normalize(x.exerciseName) === needle)
          .map(x => ({ reps: x.reps, weightLbs: x.weightLbs })),
        at: s.finishedAt,
      })).filter(h => h.sets.length);
      if (history.length) Object.assign(history[history.length - 1], { rir: exRir, discomfort: exDiscomfort });
      return suggestNext(id, history, active.preferences || {});
    });
    const missed = Number(req.query.missed || 0);
    res.json({ planId: active.id, version: active.version, suggestions, missedNote: missedSessionNote(missed) });
  } catch (e) { next(e); }
});

module.exports = router;
