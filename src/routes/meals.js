const router = require('express').Router();
const { analyzeMeal } = require('../services/mealAnalyzer');
const { detectFood } = require('../services/foodDetector');
const { attachRecipeMatches } = require('../services/photoRecipeMatcher');
const { computeMealNutrition } = require('../services/mealNutrition');
const { validateFoodInput } = require('../services/foodInput');
const { reserveFoodRequest } = require('../services/foodQuota');
const { requireFeature } = require('../middleware/requireFeature');
// food_photo_scanning gate runs before any quota is consumed.
for (const [path, fn] of [['/analyze', analyzeMeal], ['/detect', detectFood]]) router.post(path, requireFeature('food_photo_scanning'), async (req, res, next) => {
  try {
    if (process.env.NODE_ENV !== 'test' || process.env.AUTH_TEST_BYPASS !== 'true') {
      validateFoodInput(req.body);
      const gate = await reserveFoodRequest(req.userId);
      if (!gate.allowed) return res.set('Retry-After', String(gate.retryAfter)).status(429).json({ error: 'Daily food analysis budget reached. Use food search or try after the daily reset.' });
    }
    const uid = req.userId || req.headers['x-user-id'];
    const result = await fn({ ...(req.body || {}), userId: uid });
    // Structured scans get deterministic local recipe matches — one AI call total.
    if (path === '/detect' && Array.isArray(result.detectedFoods) && result.detectedFoods.length) {
      result.detectedFoods = await attachRecipeMatches(result.detectedFoods, uid);
    }
    res.set('Cache-Control', 'no-store').json(result);
  } catch (e) { next(e); }
});

// Deterministic recalculation for reviewed ingredient lines — no AI, no quota.
router.post('/ingredient-nutrition', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store').json(await computeMealNutrition(req.userId || req.headers['x-user-id'], req.body));
  } catch (e) { next(e); }
});
module.exports = router;
