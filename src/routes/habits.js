const express = require('express');
const { requireFeature } = require('../middleware/requireFeature');
const { listHabits, createHabit, updateHabit, recordOutcome } = require('../services/habits');

const router = express.Router();
router.use(requireFeature('habit_coaching'));
const uid = req => req.user?.id || req.userId || req.headers['x-user-id'];
const tz = req => req.user?.timeZone || req.query.tz || 'UTC';

router.get('/', async (req, res, next) => {
  try { res.json(await listHabits(uid(req), tz(req))); } catch (e) { next(e); }
});
router.post('/', async (req, res, next) => {
  try { res.status(201).json(await createHabit(uid(req), req.body || {})); } catch (e) { next(e); }
});
router.patch('/:id', async (req, res, next) => {
  try { res.json(await updateHabit(uid(req), req.params.id, req.body || {})); } catch (e) { next(e); }
});
router.post('/:id/outcome', async (req, res, next) => {
  try { res.json(await recordOutcome(uid(req), req.params.id, req.body?.outcome, tz(req))); } catch (e) { next(e); }
});

module.exports = router;
