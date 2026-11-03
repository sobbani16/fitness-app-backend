const express = require('express');
const { getPrisma } = require('../lib/prisma');

const router = express.Router();

// Identity comes from the authenticated session (authenticate middleware);
// the header fallback exists only for isolated unit tests.
function getUserId(req) {
  return (req.userId || req.headers['x-user-id'] || '').toString().trim();
}

function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// POST /daily-stats/water — log or replace today's water intake
// Body: { amountMl, date? }
router.post('/water', async (req, res, next) => {
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
    next(err);
  }
});

// PUT /daily-stats/water/replace — replace today's water with an absolute value
// Body: { amountMl, date? }
router.put('/water/replace', async (req, res, next) => {
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
    next(err);
  }
});

// GET /daily-stats/water — today's total water
router.get('/water', async (req, res, next) => {
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
    next(err);
  }
});

// GET /daily-stats/water/last — most recent water log timestamp
router.get('/water/last', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const last = await getPrisma().waterLog.findFirst({ where: { userId }, orderBy: { loggedAt: 'desc' }, select: { loggedAt: true, amountMl: true } });
    res.json({ loggedAt: last?.loggedAt || null });
  } catch (err) {
    next(err);
  }
});

// POST /daily-stats/steps — set the device step total for a day (idempotent)
// Body: { steps, date? } — date is the client's local calendar day.
router.post('/steps', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const { steps, date } = req.body || {};
    if (steps == null) return res.status(400).json({ error: 'steps required' });

    const prisma = getPrisma();
    const today = date || isoDate();
    const day = new Date(`${today}T00:00:00.000Z`);
    // Only the device ('app') row is replaced; wearable rows keep their own source.
    const rows = await prisma.dailySteps.findMany({ where: { userId, date: day, source: 'app' }, orderBy: { id: 'asc' } });
    let record;
    if (rows.length) {
      record = await prisma.dailySteps.update({ where: { id: rows[0].id }, data: { steps: Number(steps) } });
      // Collapse duplicates left by earlier concurrent writes.
      if (rows.length > 1) await prisma.dailySteps.deleteMany({ where: { id: { in: rows.slice(1).map(r => r.id) } } });
    } else {
      record = await prisma.dailySteps.create({ data: { userId, date: day, steps: Number(steps), source: 'app' } });
    }
    res.json({ record, date: today });
  } catch (err) {
    next(err);
  }
});

// GET /daily-stats/steps — today's steps
router.get('/steps', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const prisma = getPrisma();
    const date = req.query.date || isoDate();
    // Device and wearable counts describe the same walking; take the highest, never the sum.
    const rows = await prisma.dailySteps.findMany({
      where: { userId, date: new Date(`${date}T00:00:00.000Z`) },
      select: { steps: true },
    });
    res.json({ steps: rows.reduce((max, r) => Math.max(max, r.steps || 0), 0), date });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
