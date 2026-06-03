const express = require('express');
const { searchRecipes, getRecipeNutrition } = require('../services/recipeService');

const router = express.Router();

// GET /recipes/search?q=chicken
// Returns autosuggest results: [{ id, title, image }]
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || req.query.query || '').toString();
    const results = await searchRecipes(q);
    res.json({ results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /recipes/:id/nutrition
// Returns macros + per-100g values so the client can re-scale by portion.
router.get('/:id/nutrition', async (req, res) => {
  try {
    const nutrition = await getRecipeNutrition(req.params.id);
    res.json(nutrition);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
