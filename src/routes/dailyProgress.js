const express = require('express');
const { computeDay, history } = require('../services/dailyProgress');
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

module.exports = router;
