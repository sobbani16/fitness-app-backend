const express = require('express');
const { getTodayActions, recordFeedback } = require('../services/todayActions');
const { requireFeature } = require('../middleware/requireFeature');

const router = express.Router();
router.use(requireFeature('health_priorities'));

function getUserId(req) { return req.user?.id || req.userId || req.headers['x-user-id']; }

// GET /today/actions — personalized priorities (max 3, rule-based, evidence-backed)
router.get('/actions', async (req, res, next) => {
  try {
    const tz = req.user?.timeZone || req.query.tz || 'UTC';
    res.json(await getTodayActions(getUserId(req), tz));
  } catch (e) { next(e); }
});

// POST /today/actions/feedback { actionKey, verdict }
router.post('/actions/feedback', async (req, res, next) => {
  try {
    const { actionKey, verdict } = req.body || {};
    if (!actionKey || !verdict) return res.status(400).json({ error: 'actionKey and verdict required.' });
    res.json(await recordFeedback(getUserId(req), actionKey, verdict));
  } catch (e) { next(e); }
});

module.exports = router;
