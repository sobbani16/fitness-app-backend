// Server-side entitlement engine — modular membership access control.
// canAccessFeature() is the single evaluation point; routes call
// requireEntitlement(moduleKey) middleware. Entitlement ≠ role permission ≠
// feature flag ≠ consent: each is checked independently and none substitutes.
const { getPrisma } = require('./prisma');
const { httpError } = require('./errors');

// Capability → module mapping. A feature is reachable when the user holds ANY
// module that includes it. FREE_CORE is always granted to active accounts.
const FEATURE_MODULES = {
  'food.log': ['NUTRITION'],
  'nutrition.reports': ['NUTRITION', 'ADVANCED_ANALYTICS'],
  'workout.plan.self': ['WORKOUTS'],
  'exercise.library': ['EXERCISE_LIBRARY', 'WORKOUTS'],
  'video.guidance': ['ADVANCED_VIDEO_GUIDANCE'],
  'leo.ai': ['LEO_AI'],
  'analytics.advanced': ['ADVANCED_ANALYTICS'],
  'trainer.coaching': ['TRAINER_COACHING'],
  'live.sessions': ['LIVE_SESSIONS'],
  'academy.premium': ['KNOWLEDGE_PREMIUM'],
};

// Entitlement evaluation modes (env ENTITLEMENT_MODE):
//   shadow  — always allow, but compute result (rollout-safe default)
//   enforce — deny when no active module entitlement covers the feature
const MODE = () => process.env.ENTITLEMENT_MODE || 'shadow';

async function activeModules(userId, prisma) {
  const db = prisma || getPrisma();
  const now = new Date();
  const rows = await db.userEntitlement.findMany({
    where: {
      userId,
      status: { in: ['active', 'grace'] },
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    select: { moduleKey: true, status: true, endsAt: true },
  });
  const modules = new Set(['FREE_CORE', ...rows.map(r => r.moduleKey)]);
  return { modules, rows };
}

// Returns { allowed, mode, modules, reason } — never throws for denial.
async function canAccessFeature(userId, featureKey, ctx = {}) {
  const prisma = ctx.prisma || getPrisma();
  const needed = FEATURE_MODULES[featureKey];
  if (!needed) return { allowed: true, mode: MODE(), modules: [], reason: 'unmapped_feature' };
  const { modules } = await activeModules(userId, prisma);
  const hit = needed.find(m => modules.has(m));
  const allowed = Boolean(hit);
  if (MODE() === 'enforce' && !allowed) {
    return { allowed: false, mode: 'enforce', modules: [...modules], reason: `requires ${needed.join(' or ')}` };
  }
  return { allowed: true, mode: MODE(), modules: [...modules], via: hit };
}

// Express middleware — applies the engine to a feature key.
function requireEntitlement(featureKey) {
  return async (req, res, next) => {
    try {
      const result = await canAccessFeature(req.userId, featureKey);
      req.entitlement = result;
      if (!result.allowed) throw httpError(402, `This feature requires a membership module: ${result.reason}`);
      next();
    } catch (e) { next(e); }
  };
}

module.exports = { canAccessFeature, requireEntitlement, activeModules, FEATURE_MODULES };
