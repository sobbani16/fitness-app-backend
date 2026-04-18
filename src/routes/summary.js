const express = require('express');
const { buildDailySummary, buildHistory } = require('../services/summaryService');

const router = express.Router();

// POST /summary/daily
// Body: { profile, meals?, caloriesBurnedExercise?, weather? }
// Client sends its locally-stored meals; backend stays stateless for now.
router.post('/daily', (req, res) => {
  try {
    const summary = buildDailySummary(req.body || {});
    res.json(summary);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /summary/history
// Body: { profile, days: [{ date, caloriesIn, caloriesBurnedExercise?, mealCount? }] }
// Returns per-day balance + streak counts.
router.post('/history', (req, res) => {
  try {
    const result = buildHistory(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
