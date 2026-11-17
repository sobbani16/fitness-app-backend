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

module.exports = router;
