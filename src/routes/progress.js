const router = require('express').Router();
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { buildProgress, progressRange } = require('../services/progressService');
const { dedupedKcal, localDayBounds } = require('../services/energySummary');
const { calculateBMR, calculateTDEE, ACTIVITY_FACTORS } = require('../services/calorieEngine');
router.get('/', async (req, res, next) => {
  try {
    const range = progressRange(req.query);
    const userId = req.userId || req.headers['x-user-id'];
    if (!userId) throw httpError(401, 'Sign in required');
    const prisma = getPrisma();
    const dateWhere = { gte: range.start, lt: range.end };
    const [meals, weights, water, steps, workouts, energyRecs, user] = await Promise.all([
      prisma.foodLog.findMany({ where: { userId, loggedAt: dateWhere }, select: { loggedAt: true, calories: true, proteinG: true, carbsG: true, fatG: true, fiberG: true } }),
      prisma.weightEntry.findMany({ where: { userId, recordedAt: dateWhere }, select: { recordedAt: true, weightKg: true }, orderBy: { recordedAt: 'asc' } }),
      prisma.waterLog.findMany({ where: { userId, loggedAt: dateWhere }, select: { loggedAt: true, amountMl: true } }),
      prisma.dailySteps.findMany({ where: { userId, date: dateWhere }, select: { date: true, steps: true } }),
      prisma.workoutSession.findMany({ where: { userId, startedAt: dateWhere }, select: { startedAt: true } }),
      prisma.healthEnergyRecord.findMany({ where: { userId, startAt: { lt: range.end }, endAt: { gt: range.start } }, select: { provider: true, startAt: true, endAt: true, activeKcal: true, restingKcal: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true, gender: true, heightCm: true, currentWeightKg: true, activityLevel: true } }),
    ]);
    // Per-day expenditure: measured when a wearable covered the day (deduped,
    // single best-coverage provider), otherwise the profile TDEE estimate —
    // labeled so charts can style estimate vs measured differently. Null when
    // neither exists (no fake decline to zero).
    let tdeeEst = null, bmrEst = null;
    try {
      if (user?.currentWeightKg > 0 && user?.heightCm > 0 && user?.dateOfBirth) {
        const age = Math.floor((Date.now() - new Date(user.dateOfBirth).getTime()) / (365.25 * 86400000));
        bmrEst = calculateBMR({ sex: user.gender === 'female' || user.gender === 'male' ? user.gender : 'other', weightKg: user.currentWeightKg, heightCm: user.heightCm, age });
        tdeeEst = calculateTDEE(bmrEst, ACTIVITY_FACTORS[user.activityLevel] ? user.activityLevel : 'sedentary');
      }
    } catch { /* profile insufficient — expenditure stays null */ }
    const expenditureByDate = {};
    // Group records by the viewer-local date of their start instant.
    const recsByDay = new Map();
    for (const r of energyRecs) {
      const k = range.date(r.startAt);
      if (!recsByDay.has(k)) recsByDay.set(k, []);
      recsByDay.get(k).push(r);
    }
    const DAY = 86400000;
    for (let i = 0; i < range.count; i++) {
      const dateStr = new Date(Date.parse(range.from) + i * DAY).toISOString().slice(0, 10);
      const recs = recsByDay.get(dateStr) || [];
      if (recs.length) {
        // Best-covered single provider for active; resting added from same
        // provider when present (provider definitions: active excludes basal).
        const { start, end } = localDayBounds(dateStr, range.timeZone);
        const byProvider = {};
        for (const r of recs) (byProvider[r.provider] ||= []).push(r);
        const active = Object.entries(byProvider)
          .map(([p, rs]) => ({ p, ...dedupedKcal(rs, 'activeKcal', start.getTime(), end.getTime()) }))
          .filter(x => x.coveredMs > 60000)
          .sort((a, b) => b.coveredMs - a.coveredMs)[0];
        const resting = active ? dedupedKcal(byProvider[active.p].filter(r => r.restingKcal != null), 'restingKcal', start.getTime(), end.getTime()) : { kcal: 0 };
        const measured = (active?.kcal || 0) + (resting.kcal || 0);
        // When measured active exists but resting doesn't, add estimated resting
        // (BMR) so the series is comparable — labeled mixed.
        const restFill = active && resting.kcal <= 0 && bmrEst != null ? bmrEst : 0;
        expenditureByDate[dateStr] = { kcal: measured + restFill, source: resting.kcal > 0 ? 'wearable' : 'wearable+estimated_resting' };
      } else if (tdeeEst != null) {
        expenditureByDate[dateStr] = { kcal: tdeeEst, source: 'estimate' };
      }
    }
    res.json({ entries: buildProgress(range, { meals, weights, water, steps, workouts, expenditureByDate }), timeZone: range.timeZone });
  } catch (e) { next(e); }
});
module.exports = router;
