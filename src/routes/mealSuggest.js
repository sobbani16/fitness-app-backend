const { httpError } = require('../lib/errors');
const { getPrisma } = require('../lib/prisma');
const { getMealSuggestions } = require('../services/mealSuggestion');
const asyncRouter = require('../lib/asyncRouter');

const router = asyncRouter();

// GET /meal-suggest?occasion=lunch&limit=5&tz=IANA — "What should I eat now?"
// Hard eligibility (allergies, exclusions, dietary restrictions) is applied
// before ranking and can never be overridden by score or future AI re-rank.
router.get('/', async (req, res) => {
  const userId = req.userId || req.headers['x-user-id'];
  if (!userId) throw httpError(401, 'Sign in required');
  const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 10);
  const result = await getMealSuggestions(getPrisma(), userId, {
    occasion: req.query.occasion,
    limit,
    timeZone: req.query.tz,
  });
  if (!result) throw httpError(404, 'User not found');
  res.json(result);
});

module.exports = router;
