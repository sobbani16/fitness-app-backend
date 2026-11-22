const express = require('express');
const { computeDay, history } = require('../services/dailyProgress');
const { calendar, week, assignWeeklyTarget } = require('../services/progressCalendar');
const { requireFeature } = require('../middleware/requireFeature');
const { isValidZone } = require('../services/localDay');

const router = express.Router();
const wrap = (fn) => async (req, res, next) => { try { res.json(await fn(req)); } catch (e) { next(e); } };
const uid = (req) => req.userId;

router.use(requireFeature('daily_progress_v2_enabled'));

// GET /daily-progress/today?tz= — recompute (idempotent) or pass ?day=
router.get('/today', wrap(async (req) => {
  const tz = isValidZone(req.query.tz) ? req.query.tz : undefined;
  return { progress: await computeDay(uid(req), { tz, dayKeyStr: /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || '') ? req.query.day : undefined }) };
}));

// GET /daily-progress/history?days=14 — persisted V2 day records only
router.get('/history', wrap(async (req) => history(uid(req), { days: Math.min(90, Number(req.query.days) || 14) })));

// PUT /daily-progress/preferences { restDays: number[] } — user-planned rest
// weekdays (0=Sun..6=Sat). A6: a planned rest day fulfills the activity
// component; no workout required to reach 100.
router.put('/preferences', wrap(async (req) => {
  const restDays = Array.isArray(req.body?.restDays) ? [...new Set(req.body.restDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
  const { getPrisma } = require('../lib/prisma');
  const prefs = await getPrisma().userPlanningPreferences.upsert({
    where: { userId: uid(req) }, create: { userId: uid(req), restDays }, update: { restDays },
  });
  return { preferences: { restDays: prefs.restDays } };
}));

// GET/POST /daily-progress/target — current target + weekly adaptive review.
router.get('/target', wrap(async (req) => ({ target: await assignWeeklyTarget(uid(req), { tz: isValidZone(req.query.tz) ? req.query.tz : undefined }) })));
router.put('/target', wrap(async (req) => {
  const t = Number(req.body?.target), mode = req.body?.mode;
  const { getPrisma } = require('../lib/prisma');
  if (mode === 'adaptive') {
    const prefs = await getPrisma().userPlanningPreferences.upsert({ where: { userId: uid(req) }, create: { userId: uid(req), targetMode: 'adaptive' }, update: { targetMode: 'adaptive' } });
    return { preferences: { dailyTarget: prefs.dailyTarget, targetMode: prefs.targetMode } };
  }
  if (!Number.isInteger(t) || t < 10 || t > 100) throw Object.assign(new Error('target must be 10–100'), { status: 400 });
  const prefs = await getPrisma().userPlanningPreferences.upsert({ where: { userId: uid(req) }, create: { userId: uid(req), dailyTarget: t, targetMode: mode === 'paused' ? 'paused' : 'manual' }, update: { dailyTarget: t, targetMode: mode === 'paused' ? 'paused' : 'manual' } });
  return { preferences: { dailyTarget: prefs.dailyTarget, targetMode: prefs.targetMode } };
}));

// GET /daily-progress/week — Mon–Sun week view + previous-week comparison.
router.get('/week', wrap(async (req) => ({
  week: await week(uid(req), { tz: isValidZone(req.query.tz) ? req.query.tz : undefined }),
})));

// GET /daily-progress/calendar?month=YYYY-MM — Leo Score Calendar (one query).
router.get('/calendar', wrap(async (req) => ({
  calendar: await calendar(uid(req), { month: /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : undefined, tz: isValidZone(req.query.tz) ? req.query.tz : undefined }),
})));

// GET /daily-progress/score-v2 — dps-v2 composite behind health_score_v2 flag.
// v1 /today is untouched; this is additive and snapshot-versioned.
router.get('/score-v2', wrap(async (req) => {
  const { isEnabled } = require('../services/featureFlags/service');
  const { getPrisma } = require('../lib/prisma');
  const { dailyScore, SCORE_VERSION } = require('../services/scoringV2');
  const { nutrientStatus } = require('../services/nutrientStatus');
  if (!(await isEnabled('health_score_v2', uid(req)))) { const { httpError } = require('../lib/errors'); throw httpError(403, 'health_score_v2 is not enabled for this account'); }
  const prisma = getPrisma();
  const userId = uid(req);
  const now = new Date(); const day = new Date(now); day.setHours(0, 0, 0, 0);
  const weekAgo = new Date(day); weekAgo.setDate(weekAgo.getDate() - 6);
  const [status, workouts, sleeps, waters] = await Promise.all([
    nutrientStatus(prisma, userId, { days: 1, now }),
    prisma.workoutSession.findMany({ where: { userId, startedAt: { gte: weekAgo } }, select: { type: true, durationMin: true, startedAt: true } }),
    prisma.sleepLog.findMany({ where: { userId, sleepEnd: { gte: day } }, orderBy: { sleepEnd: 'desc' }, take: 1 }),
    prisma.waterLog.findMany({ where: { userId, loggedAt: { gte: day } }, select: { amountMl: true } }),
  ]);
  const n = status.nutrients;
  const minutes = workouts.reduce((s, w) => s + (w.durationMin || 0), 0);
  const cardio = workouts.filter(w => /run|cycle|swim|cardio|walk|aerobic/i.test(w.type || '')).length;
  const resist = workouts.filter(w => /strength|resist|weight|gym|push|pull|leg|upper|lower/i.test(w.type || '')).length;
  const score = dailyScore({
    nutrition: {
      proteinG: n.proteinG.value, carbsG: n.carbsG.value, fatG: n.fatG.value, fiberG: n.fiberG.value,
      calories: n.calories.value,
      targets: { proteinG: n.proteinG.reference, carbsG: n.carbsG.reference, fatG: n.fatG.reference, fiberG: n.fiberG.reference, caloriesMin: null, caloriesMax: null, calorieFloor: null },
    },
    foodQuality: {},
    activity: { weeklyMovementMin: minutes, cardioSessions: cardio, resistanceSessions: resist },
    sleep: { hoursSlept: sleeps[0]?.hoursSlept ?? null },
    hydration: { waterMl: waters.reduce((s, w) => s + (w.amountMl || 0), 0) || null },
  });
  await prisma.dailyScoreSnapshot.upsert({
    where: { userId_date_version: { userId, date: day, version: SCORE_VERSION } },
    create: { userId, date: day, version: SCORE_VERSION, composite: score.composite, state: score.state, components: score.components },
    update: { composite: score.composite, state: score.state, components: score.components },
  }).catch(() => {}); // table may not exist until migration applies — read path still works
  return { score, loggedCompleteness: status.completeness, disclaimer: score.note };
}));

module.exports = router;
