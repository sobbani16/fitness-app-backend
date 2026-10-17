const router = require('express').Router();
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { buildProgress, progressRange } = require('../services/progressService');
router.get('/', async (req, res, next) => {
  try {
    const range = progressRange(req.query);
    const userId = req.userId;
    if (!userId) throw httpError(401, 'Sign in required');
    const prisma = getPrisma();
    const dateWhere = { gte: range.start, lt: range.end };
    const [meals, weights, water, steps, workouts] = await Promise.all([
      prisma.foodLog.findMany({ where: { userId, loggedAt: dateWhere }, select: { loggedAt: true, calories: true, proteinG: true, carbsG: true, fatG: true, fiberG: true } }),
      prisma.weightEntry.findMany({ where: { userId, recordedAt: dateWhere }, select: { recordedAt: true, weightKg: true }, orderBy: { recordedAt: 'asc' } }),
      prisma.waterLog.findMany({ where: { userId, loggedAt: dateWhere }, select: { loggedAt: true, amountMl: true } }),
      prisma.dailySteps.findMany({ where: { userId, date: dateWhere }, select: { date: true, steps: true } }),
      prisma.workoutSession.findMany({ where: { userId, startedAt: dateWhere }, select: { startedAt: true } }),
    ]);
    res.json({ entries: buildProgress(range, { meals, weights, water, steps, workouts }), timeZone: range.timeZone });
  } catch (e) { next(e); }
});
module.exports = router;
