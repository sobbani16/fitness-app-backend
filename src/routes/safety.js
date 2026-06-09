const express = require('express');
const { generateMealRecommendation } = require('../services/safety/mealRecommendationService');
const { runSafetyPipeline, validateRecipe } = require('../services/safety/safetyPipeline');
const { validateIngredients } = require('../services/safety/ingredientValidator');
const { validateSupplements } = require('../services/safety/supplementValidator');
const { generateAndStoreCoaching } = require('../services/safety/coachingService');
const { buildUserContext } = require('../services/safety/contextBuilder');

const router = express.Router();

function getUserId(req) {
  return (req.headers['x-user-id'] || req.query.userId || '').toString().trim();
}

// GET /safety/recommend  (header: x-user-id)
// Generate a personalized meal recommendation.
router.get('/recommend', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });
    const goalType = req.query.goal || 'maintain';
    const weightKg = req.query.weightKg ? Number(req.query.weightKg) : undefined;
    const result = await generateMealRecommendation(userId, { goalType, weightKg });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /safety/validate/ingredients  (header: x-user-id)
// Body: { ingredients: [{name, ingredientId?}] }
router.post('/validate/ingredients', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });
    const { ingredients } = req.body || {};
    if (!ingredients || !Array.isArray(ingredients)) {
      return res.status(400).json({ error: 'ingredients array required' });
    }
    const result = await validateIngredients(userId, ingredients);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /safety/validate/supplements  (header: x-user-id)
// Body: { supplements: [{name, supplementId?}] }
router.post('/validate/supplements', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });
    const { supplements } = req.body || {};
    if (!supplements || !Array.isArray(supplements)) {
      return res.status(400).json({ error: 'supplements array required' });
    }
    const result = await validateSupplements(userId, supplements);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /safety/validate/recipe  (header: x-user-id)
// Body: { ingredients: [...], totalCalories, totalProteinG, totalCarbsG, totalFatG, targets? }
router.post('/validate/recipe', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });
    const result = await validateRecipe(userId, req.body || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /safety/coaching  (header: x-user-id)
// Generate proactive coaching messages for now.
router.get('/coaching', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });
    const dailyCaloriesTarget = req.query.calories ? Number(req.query.calories) : undefined;
    const dailyProteinTarget = req.query.protein ? Number(req.query.protein) : undefined;
    const messages = await generateAndStoreCoaching(userId, { dailyCaloriesTarget, dailyProteinTarget });
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /safety/context  (header: x-user-id)
// Returns Leo's full context for the user (debugging/transparency).
router.get('/context', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });
    const context = await buildUserContext(userId);
    res.json(context);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
