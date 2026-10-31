// Feature-flag enforcement middleware — requireFeature('ai_coach')
// Backend is the authoritative enforcement point; hiding UI is not enough.
const flags = require('../services/featureFlags/service');
const { FEATURES } = require('../config/featureRegistry');
const { getUserId } = require('./rbac');

const DISABLED = {
  error: { code: 'FEATURE_DISABLED', message: 'This feature is temporarily unavailable.' },
};

function rejected(res) {
  return res.status(403).json(DISABLED);
}

/** resolve fail-open on evaluation error only when the flag is registered failOpen */
async function evalKey(key, userId) {
  try {
    return await flags.isEnabled(key, userId);
  } catch (err) {
    if (FEATURES[key] && FEATURES[key].failOpen) return true;
    throw err;
  }
}

/**
 * Middleware factory: rejects with 403 FEATURE_DISABLED when the flag resolves
 * false for the authenticated user.
 * Usage: router.post('/draft', requireFeature('ai_workout_recommendations'), handler)
 *        router.use(requireFeature('weekly_meal_plans'))
 */
function requireFeature(key) {
  return async (req, res, next) => {
    try {
      if (!(await evalKey(key, req.userId || getUserId(req)))) return rejected(res);
      next();
    } catch (err) { next(err); }
  };
}

/**
 * Any-of variant for endpoints shared by several flags (e.g. /voice/* serves
 * both voice_food_logging and voice_exercise_logging).
 */
function requireAnyFeature(...keys) {
  return async (req, res, next) => {
    try {
      const userId = req.userId || getUserId(req);
      for (const key of keys) if (await evalKey(key, userId)) return next();
      return rejected(res);
    } catch (err) { next(err); }
  };
}

module.exports = { requireFeature, requireAnyFeature };
