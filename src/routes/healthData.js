const express = require('express');
const { getPrisma } = require('../lib/prisma');
const { summary } = require('../services/healthData');

const router = express.Router();

function getUserId(req) {
  return (req.headers['x-user-id'] || req.query.userId || '').toString().trim();
}

// GET /health-data/summary?days=7 — normalized metrics + freshness + sources.
router.get('/summary', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    res.json(await summary(getPrisma(), userId, { days }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
