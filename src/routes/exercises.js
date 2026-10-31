const express = require('express');
const ctrl = require('../controllers/exerciseController');
const db = require('../services/exerciseDbService');
const { MUSCLES } = require('../services/muscles');

const router = express.Router();
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

// Expose store for tests (mirrors the pattern in chat.js).
router.__store = ctrl.store;

// Exercise library (imported catalog) — mounted before '/'.
router.get('/library/muscles', wrap(async (req, res) => res.json({ muscles: MUSCLES })));
router.get('/library/search', wrap(async (req, res) => {
  const { q, muscle, role, equipment, mechanic, level, page, limit } = req.query;
  res.json(await db.searchExercises({
    q, muscle, role, equipment, mechanic, level,
    page: Math.max(1, parseInt(page) || 1), limit: Math.min(50, parseInt(limit) || 25),
  }));
}));
router.get('/library/muscle-heatmap', wrap(async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 7));
  const userId = (req.userId || req.headers['x-user-id'] || '').toString().trim();
  res.json(await db.muscleHeatmap(userId, { days }));
}));
router.get('/library/:id', wrap(async (req, res) => {
  const ex = await db.getExercise(req.params.id);
  if (!ex) return res.status(404).json({ error: 'Exercise not found' });
  res.json(ex);
}));
router.get('/library/:id/alternatives', wrap(async (req, res) => {
  const alt = await db.getAlternatives(req.params.id, { equipment: req.query.equipment });
  if (!alt) return res.status(404).json({ error: 'Exercise not found' });
  res.json(alt);
}));

router.get('/', wrap(ctrl.listSessions));
router.get('/prefill/:exerciseType', wrap(ctrl.getPrefill));
router.post('/', wrap(ctrl.createSession));
router.post('/:id/sets', wrap(ctrl.appendSet));

router.post('/:id/finish', wrap(ctrl.finishSession));

module.exports = router;
