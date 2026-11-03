const express = require('express');
const {
  calculateHealthScore,
  getImprovementActions,
  getHealthScoreTrend,
} = require('../services/healthScoreEngine');

const router = express.Router();

// Identity comes from the authenticated session (authenticate middleware);
// the header fallback exists only for isolated unit tests.
function getUserId(req) {
  return (req.userId || req.headers['x-user-id'] || '').toString().trim();
}

// GET /health-score — calculate and return today's health score
router.get('/', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });
    const date = req.query.date || undefined;
    const result = await calculateHealthScore(userId, date);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /health-score/actions — ranked improvement actions
router.get('/actions', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });
    const date = req.query.date || undefined;
    const result = await getImprovementActions(userId, date);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /health-score/trend?days=7 — score trend
router.get('/trend', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });
    const days = req.query.days ? Number(req.query.days) : 7;
    const trend = await getHealthScoreTrend(userId, days);
    res.json({ trend });
  } catch (err) {
    next(err);
  }
});

// GET /health-score/:id/detail — full detail with all contributors
router.get('/:id/detail', async (req, res, next) => {
  try {
    const { getPrisma } = require('../lib/prisma');
    const prisma = getPrisma();
    const score = await prisma.healthScore.findUnique({
      where: { id: req.params.id },
      include: {
        contributors: { orderBy: { scoreImpact: 'desc' } },
        insights: true,
      },
    });
    if (!score || score.userId !== getUserId(req)) return res.status(404).json({ error: 'Score not found' });
    res.json(score);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
