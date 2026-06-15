const express = require('express');
const { getPrisma } = require('../lib/prisma');

const router = express.Router();

function getUserId(req) {
  return (req.headers['x-user-id'] || req.query.userId || '').toString().trim();
}

// POST /food-logs — log a meal (syncs from mobile)
router.post('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });
    const { foodName, quantityG, calories, proteinG, carbsG, fatG, fiberG, mealType } = req.body || {};
    if (!foodName) return res.status(400).json({ error: 'foodName required' });
    const prisma = getPrisma();
    const log = await prisma.foodLog.create({
      data: {
        userId,
        foodName: String(foodName),
        quantityG: Number(quantityG) || 0,
        calories: Number(calories) || 0,
        proteinG: Number(proteinG) || 0,
        carbsG: Number(carbsG) || 0,
        fatG: Number(fatG) || 0,
        fiberG: Number(fiberG) || 0,
        mealType: String(mealType || 'meal'),
      },
    });
    res.status(201).json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /food-logs — get today's food logs
router.get('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });
    const prisma = getPrisma();
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);
    const logs = await prisma.foodLog.findMany({
      where: { userId, loggedAt: { gte: start, lte: end } },
      orderBy: { loggedAt: 'desc' },
    });
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /food-logs/:id — remove a food log
router.delete('/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });
    const prisma = getPrisma();
    await prisma.foodLog.deleteMany({ where: { id: req.params.id, userId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
