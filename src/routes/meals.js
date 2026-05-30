const express = require('express');
const { analyzeMeal } = require('../services/mealAnalyzer');
const { detectFood } = require('../services/foodDetector');

const router = express.Router();

// POST /meals/analyze
// Body: { description?: string, mealType?: 'breakfast'|'lunch'|'dinner'|'snack', hasPhoto?: boolean }
// Returns deterministic mock AI analysis (no real AI yet).
router.post('/analyze', (req, res) => {
  try {
    const { description, mealType, hasPhoto } = req.body || {};
    const analysis = analyzeMeal({ description, mealType, hasPhoto });
    res.json(analysis);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /meals/detect
// Body: { description?: string, mealType?: string, hasPhoto?: boolean }
// AI-assisted food detection stub. Returns caloriesPer100g + suggestedPortionGrams
// so the client can recompute calories once a real weight is known (e.g. BLE scale).
router.post('/detect', (req, res) => {
  try {
    const { description, mealType, hasPhoto } = req.body || {};
    const detection = detectFood({ description, mealType, hasPhoto });
    res.json(detection);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
