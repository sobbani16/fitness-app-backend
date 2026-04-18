const express = require('express');
const { analyzeMeal } = require('../services/mealAnalyzer');

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

module.exports = router;
