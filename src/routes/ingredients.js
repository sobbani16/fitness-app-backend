const express = require('express');
const { searchIngredients } = require('../services/ingredientService');

const router = express.Router();

function getUserId(req) {
  return (req.headers['x-user-id'] || req.query.userId || '').toString().trim();
}

// GET /ingredients/search?q=chicken   (header: x-user-id)
// Three-tier lookup: user table -> central table -> USDA (cached into both).
// Returns: { results: [{ id, fdcId, name, caloriesPer100g, macrosPer100g, source }] }
router.get('/search', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(400).json({ error: 'x-user-id header or userId required' });
    }
    const query = (req.query.q || req.query.query || '').toString();
    if (!query.trim()) {
      return res.status(400).json({ error: 'q (query) is required' });
    }
    const results = await searchIngredients({ userId, query });
    res.json({ results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
