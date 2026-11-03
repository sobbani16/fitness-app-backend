const express = require('express');
const {
  calculateScore,
  getGoals,
  updateGoals,
  getTrend,
} = require('../services/macroScoreService');

const router = express.Router();

// Identity comes from the authenticated session (authenticate middleware);
// the header fallback exists only for isolated unit tests.
function getUserId(req) {
  return (req.userId || req.headers['x-user-id'] || '').toString().trim();
}

// GET /macro-score — today's macro score
router.get('/', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });
    const date = req.query.date || undefined;
    const score = await calculateScore(userId, date);
    res.json(score);
  } catch (err) {
    next(err);
  }
});

// GET /macro-score/goals — user's macro targets
router.get('/goals', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });
    const goals = await getGoals(userId);
    res.json(goals);
  } catch (err) {
    next(err);
  }
});

// PUT /macro-score/goals — update macro targets
router.put('/goals', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });
    const { caloriesTarget, proteinTarget, carbsTarget, fatTarget, fiberTarget, waterMlTarget } = req.body || {};
    const updates = {};
    if (caloriesTarget != null) updates.caloriesTarget = Number(caloriesTarget);
    if (proteinTarget != null) updates.proteinTarget = Number(proteinTarget);
    if (carbsTarget != null) updates.carbsTarget = Number(carbsTarget);
    if (fatTarget != null) updates.fatTarget = Number(fatTarget);
    if (fiberTarget != null) updates.fiberTarget = Number(fiberTarget);
    if (waterMlTarget != null) updates.waterMlTarget = Number(waterMlTarget);
    if (Object.values(updates).some(v => !Number.isFinite(v) || v < 0)) return res.status(400).json({ error: 'Targets must be non-negative numbers.', code: 'INVALID_REQUEST' });
    const goals = await updateGoals(userId, updates);
    res.json(goals);
  } catch (err) {
    next(err);
  }
});

// GET /macro-score/trend?days=7 — score trend
router.get('/trend', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });
    const days = req.query.days ? Number(req.query.days) : 7;
    const trend = await getTrend(userId, days);
    res.json({ trend });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
