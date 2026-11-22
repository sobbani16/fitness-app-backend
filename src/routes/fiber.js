// Smart Fiber Intelligence API — server-enforced, deterministic.
// Every route sits behind requireFeature; the parent gate is
// fiber_intelligence_enabled and sub-capabilities layer on top.
const express = require('express');
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { requireFeature } = require('../middleware/requireFeature');
const { resolveZone, dayKey, dayRangeUtc } = require('../services/localDay');
const { resolveFiberTarget } = require('../services/fiber/targets');
const { dailyFiber, fiberStateOf } = require('../services/fiber/dailyEngine');
const { sequenceMeal } = require('../services/fiber/sequencing');
const { evaluateFiberSupplement, confirmCheck } = require('../services/fiber/supplementCheck');

const router = express.Router();
router.use(requireFeature('fiber_intelligence_enabled'));

const uid = (req) => (req.userId || req.headers['x-user-id'] || '').toString().trim();

async function userTz(req) {
  const prisma = getPrisma();
  const u = await prisma.user.findUnique({ where: { id: uid(req) }, select: { timeZone: true } });
  return resolveZone(req.query.tz, u?.timeZone);
}

// GET /fiber/target — resolved personalized target with provenance.
router.get('/target', requireFeature('fiber_daily_goal_enabled'), async (req, res, next) => {
  try {
    const userId = uid(req);
    const prisma = getPrisma();
    const [user, macroGoal, conditions] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true, gender: true } }),
      prisma.macroGoal.findUnique({ where: { userId } }),
      prisma.userHealthCondition.findMany({ where: { userId, active: true }, include: { condition: { select: { name: true } } } }),
    ]);
    res.json(resolveFiberTarget({
      dateOfBirth: user?.dateOfBirth, gender: user?.gender, macroGoal,
      conditionNames: conditions.map((c) => c.condition?.name).filter(Boolean),
    }));
  } catch (e) { next(e); }
});

// PUT /fiber/target { targetG, note } — user override with provenance.
// A clinician-directed value is recorded as basis 'clinician' only when the
// caller declares it; the note preserves context. Clearing (targetG null)
// removes the override so the formula applies again.
router.put('/target', requireFeature('fiber_daily_goal_enabled'), async (req, res, next) => {
  try {
    const userId = uid(req);
    const { targetG, note, clinicianDirected } = req.body || {};
    const prisma = getPrisma();
    const existing = await prisma.macroGoal.findUnique({ where: { userId } });
    const base = existing || { userId, caloriesTarget: 2200, proteinTarget: 150, carbsTarget: 250, fatTarget: 70, waterMlTarget: 2000 };
    let data;
    if (targetG == null) {
      // Clear the override: basis=null lets the engine derive the target
      // (formula/life-stage/minor) on next read instead of trusting a stale
      // stored value.
      data = { ...base, fiberTarget: 30, fiberTargetBasis: null, fiberTargetNote: null };
    } else {
      const t = Number(targetG);
      if (!Number.isFinite(t) || t < 0 || t > 100) throw httpError(400, 'targetG must be 0–100 g');
      // 'clinician' provenance is attested data — a member must not be able to
      // mark their own target clinician-directed. Honoured only for clinical
      // roles; everyone else silently records 'custom'.
      const isClinical = await prisma.userRole.findFirst({
        where: { userId, active: true, role: { name: { in: ['CLINICAL_REVIEWER', 'NUTRITIONIST', 'ADMIN'] } } },
        select: { id: true },
      });
      const basis = clinicianDirected === true && isClinical ? 'clinician' : 'custom';
      data = { ...base, fiberTarget: t, fiberTargetBasis: basis, fiberTargetNote: typeof note === 'string' ? note.slice(0, 300) : null };
    }
    const saved = await prisma.macroGoal.upsert({ where: { userId }, update: data, create: { userId, ...data } });
    res.json({ fiberTarget: saved.fiberTarget, fiberTargetBasis: saved.fiberTargetBasis, fiberTargetNote: saved.fiberTargetNote });
  } catch (e) { next(e); }
});

// GET /fiber/daily?date&tz — today's engine output (recomputed on read).
router.get('/daily', requireFeature('fiber_daily_goal_enabled'), async (req, res, next) => {
  try {
    const userId = uid(req);
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : undefined;
    const tz = await userTz(req);
    res.json(await dailyFiber(userId, { date, tz }));
  } catch (e) { next(e); }
});

// GET /fiber/trend?days=7 — per-day confirmed/target history.
router.get('/trend', requireFeature('fiber_daily_goal_enabled'), async (req, res, next) => {
  try {
    const userId = uid(req);
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
    const tz = await userTz(req);
    const prisma = getPrisma();
    const today = dayKey(new Date(), tz);
    // The resolved target is user-level (not per-day), so one resolution
    // serves the whole window; past-day targets are not versioned yet.
    const [user, macroGoal, conditions] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true, gender: true } }),
      prisma.macroGoal.findUnique({ where: { userId } }),
      prisma.userHealthCondition.findMany({ where: { userId, active: true }, include: { condition: { select: { name: true } } } }),
    ]);
    const target = resolveFiberTarget({
      dateOfBirth: user?.dateOfBirth, gender: user?.gender, macroGoal,
      conditionNames: conditions.map((c) => c.condition?.name).filter(Boolean),
    });
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(Date.parse(`${today}T00:00:00Z`) - i * 86400000).toISOString().slice(0, 10);
      const { startUtc, endUtc } = dayRangeUtc(day, tz);
      // eslint-disable-next-line no-await-in-loop
      const logs = await prisma.foodLog.findMany({
        where: { userId, loggedAt: { gte: startUtc, lt: endUtc } },
        select: { fiberG: true, nutritionSnapshot: true },
      });
      let confirmed = 0, unknown = 0;
      for (const l of logs) {
        const st = fiberStateOf(l);
        if (st === 'confirmed') confirmed += l.fiberG;
        else if (st === 'unknown') unknown += 1;
      }
      out.push({ date: day, confirmedG: Math.round(confirmed * 10) / 10, targetG: target.targetG, unknownMeals: unknown, mealsLogged: logs.length });
    }
    res.json({ days: out, timezone: tz });
  } catch (e) { next(e); }
});

// GET /fiber/weekly — 7-day review: distinguishes incomplete logging from
// genuinely low intake, suggests food-first changes to recurring patterns.
router.get('/weekly', requireFeature('fiber_daily_goal_enabled'), async (req, res, next) => {
  try {
    const { weeklyReview } = require('../services/fiber/weeklyReview');
    const tz = await userTz(req);
    res.json(await weeklyReview(uid(req), { zone: tz }));
  } catch (e) { next(e); }
});

// POST /fiber/sequence — eating-order suggestion for a component-wise meal.
// Body: { items: [{name, amountG, ingredientId?}] } OR { foodLogId } to
// sequence a stored meal's nutritionSnapshot.components.
router.post('/sequence', requireFeature('fiber_meal_sequencing_enabled'), async (req, res, next) => {
  try {
    const userId = uid(req);
    const prisma = getPrisma();
    let items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items && typeof req.body?.foodLogId === 'string') {
      const log = await prisma.foodLog.findFirst({ where: { id: req.body.foodLogId, userId }, select: { nutritionSnapshot: true } });
      if (!log) throw httpError(404, 'Meal not found');
      const comps = log.nutritionSnapshot?.components;
      if (!Array.isArray(comps) || !comps.length) throw httpError(422, 'That meal has no recorded components to sequence.');
      items = comps.flatMap((c) => (Array.isArray(c.ingredients) && c.ingredients.length ? c.ingredients : [{ name: c.foodName, amountG: null }]).map((i) => ({ name: i.name || c.foodName, amountG: i.amountG ?? null })));
    }
    if (!items?.length) throw httpError(400, 'Provide items[] or foodLogId.');
    for (const it of items) {
      if (typeof (it.name || it.foodName) !== 'string' || !(it.name || it.foodName).trim()) throw httpError(400, 'Each item needs a name.');
      if (it.amountG != null && (!Number.isFinite(it.amountG) || it.amountG <= 0 || it.amountG > 20000)) throw httpError(400, 'amountG must be 0–20000.');
    }
    const [allergies, prefs] = await Promise.all([
      prisma.userAllergy.findMany({ where: { userId }, include: { allergy: { select: { name: true } } } }).catch(() => []),
      prisma.foodPreference.findMany({ where: { userId, preference: { in: ['DISLIKE', 'NEVER_RECOMMEND'] } }, select: { foodName: true } }).catch(() => []),
    ]);
    res.json(await sequenceMeal(items, {
      allergenTerms: new Set(allergies.map((a) => String(a.allergy?.name || '').toLowerCase()).filter(Boolean)),
      avoidNames: new Set(prefs.map((p) => p.foodName.toLowerCase())),
    }));
  } catch (e) { next(e); }
});

// GET /fiber/supplement-education — general psyllium education, no
// personalization. Available whenever the supplement-suggestions flag is on;
// used when a personalized check is suppressed or no product is selected.
router.get('/supplement-education', requireFeature('fiber_supplement_suggestions_enabled'), async (_req, res) => {
  const { EDUCATION } = require('../services/fiber/supplementCheck');
  res.json({ education: EDUCATION, disclaimers: ['General information only — not a recommendation. Confirm products and use with a clinician or pharmacist.'] });
});

// POST /fiber/supplement-check — eligibility evaluation for a user-selected
// fiber supplement. Returns label-derived fiber only when the product label
// is verified; every outcome (including suppressed) is audited.
// Body: { supplementId } OR { productId }.
router.post('/supplement-check', requireFeature('fiber_supplement_suggestions_enabled'), async (req, res, next) => {
  try {
    const userId = uid(req);
    const { supplementId, productId } = req.body || {};
    if (!supplementId && !productId) throw httpError(400, 'Provide supplementId or productId.');
    res.json(await evaluateFiberSupplement(userId, { supplementId, productId }));
  } catch (e) { next(e); }
});

// POST /fiber/supplement-check/:id/confirm — records that the user saw the
// verdict and chose to proceed. Logging still goes through the normal
// supplement flow by the user's own hand; nothing is auto-logged.
router.post('/supplement-check/:id/confirm', requireFeature('fiber_supplement_suggestions_enabled'), async (req, res, next) => {
  try {
    const saved = await confirmCheck(uid(req), req.params.id);
    res.json({ checkId: saved.id, userConfirmed: saved.userConfirmed, confirmedAt: saved.confirmedAt });
  } catch (e) { next(e); }
});

module.exports = router;
