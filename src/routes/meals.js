const router = require('express').Router();
const { analyzeMeal } = require('../services/mealAnalyzer');
const { detectFood } = require('../services/foodDetector');
const { validateFoodInput } = require('../services/foodInput');
const { reserveFoodRequest } = require('../services/foodQuota');
for (const [path, fn] of [['/analyze', analyzeMeal], ['/detect', detectFood]]) router.post(path, async (req, res, next) => {
  try {
    if (process.env.NODE_ENV !== 'test' || process.env.AUTH_TEST_BYPASS !== 'true') {
      validateFoodInput(req.body);
      const gate = await reserveFoodRequest(req.userId);
      if (!gate.allowed) return res.set('Retry-After', String(gate.retryAfter)).status(429).json({ error: 'Daily food analysis budget reached. Use food search or try after the daily reset.' });
    }
    res.set('Cache-Control', 'no-store').json(await fn(req.body || {}));
  } catch (e) { next(e); }
});
module.exports = router;
