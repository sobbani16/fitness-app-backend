const express = require('express');
const { getPrisma } = require('../lib/prisma');

const router = express.Router();

function getUserId(req) {
  return (req.headers['x-user-id'] || req.query.userId || '').toString().trim();
}

function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// POST /daily-stats/water — log or replace today's water intake
// Body: { amountMl, date? }
router.post('/water', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const { amountMl, date } = req.body || {};
    if (amountMl == null) return res.status(400).json({ error: 'amountMl required' });

    const prisma = getPrisma();
    const today = date || isoDate();
    const log = await prisma.waterLog.create({
      data: {
        userId,
        amountMl: Number(amountMl),
        loggedAt: new Date(),
      },
    });
    res.status(201).json({ log, date: today });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /daily-stats/water/replace — replace today's water with an absolute value
// Body: { amountMl, date? }
router.put('/water/replace', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const { amountMl, date } = req.body || {};
    if (amountMl == null) return res.status(400).json({ error: 'amountMl required' });

    const prisma = getPrisma();
    const today = date || isoDate();
    const start = new Date(`${today}T00:00:00.000Z`);
    const end = new Date(`${today}T23:59:59.999Z`);
    await prisma.waterLog.deleteMany({ where: { userId, loggedAt: { gte: start, lte: end } } });
    const log = await prisma.waterLog.create({
      data: { userId, amountMl: Number(amountMl), loggedAt: new Date() },
    });
    res.json({ log, date: today });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /daily-stats/water — today's total water
router.get('/water', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const prisma = getPrisma();
    const date = req.query.date || isoDate();
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);
    const total = await prisma.waterLog.aggregate({
      where: { userId, loggedAt: { gte: start, lte: end } },
      _sum: { amountMl: true },
    });
    res.json({ amountMl: total._sum.amountMl || 0, date });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /daily-stats/steps — upsert today's step count
// Body: { steps, date? }
router.post('/steps', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const { steps, date } = req.body || {};
    if (steps == null) return res.status(400).json({ error: 'steps required' });

    const prisma = getPrisma();
    const today = date || isoDate();
    const existing = await prisma.dailySteps.findFirst({
      where: { userId, date: new Date(`${today}T00:00:00.000Z`) },
    });
    let record;
    if (existing) {
      record = await prisma.dailySteps.update({
        where: { id: existing.id },
        data: { steps: Number(steps) },
      });
    } else {
      record = await prisma.dailySteps.create({
        data: { userId, date: new Date(`${today}T00:00:00.000Z`), steps: Number(steps) },
      });
    }
    res.json({ record, date: today });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /daily-stats/steps — today's steps
router.get('/steps', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const prisma = getPrisma();
    const date = req.query.date || isoDate();
    const record = await prisma.dailySteps.findFirst({
      where: { userId, date: new Date(`${date}T00:00:00.000Z`) },
    });
    res.json({ steps: record?.steps || 0, date });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
