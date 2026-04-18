const express = require('express');
const { buildDailySummary } = require('../services/summaryService');

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

module.exports = router;
