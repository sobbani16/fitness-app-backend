// Staging-only safety-state fixture route (OPS-REQ-4).
// HARD GUARDS:
//   1. NODE_ENV === 'production' → throws at require time (boot fails).
//   2. SAFETY_STATE_FIXTURE must be explicitly '1' — else the router 404s.
//   3. Caller must be a synthetic user (email domain allowlist) — checked per
//      request against the DB, not a client claim.
//   4. All writes audit-logged; DELETE /me resets fixture state for the caller.
// Fixture data goes through the same models loadSafetyContext reads — the
// deployed evaluate endpoint is never special-cased.
// Railway staging runs NODE_ENV=production — the real prod gate is
// RAILWAY_ENVIRONMENT_NAME when present, NODE_ENV otherwise.
const _railEnv = process.env.RAILWAY_ENVIRONMENT_NAME;
const _isProd = _railEnv ? _railEnv === 'production' : process.env.NODE_ENV === 'production';
if (_isProd) {
  throw new Error('safetyFixtures must never load in production (SAFETY_STATE_FIXTURE)');
}
const express = require('express');
const router = express.Router();
const { getPrisma } = require('../lib/prisma');
const { requireFeature } = require('../middleware/requireFeature');
const envFixture = require('../services/activitySafety/envFixtureStore');
const audit = require('../services/auditService');
const uid = req => req.userId;
const body = req => (req.body && typeof req.body === 'object' ? req.body : {});

const ENABLED = process.env.SAFETY_STATE_FIXTURE === '1';
const SYNTHETIC_DOMAINS = new Set(['euploading.com', 'staging.test', 'syn.local', 'example.com']);
// Fixture writes require BOTH a synthetic identity AND an explicit DB-backed
// privilege — a synthetic email domain alone must not authorize writes, and
// no prod account can hold this role (roles are server-assigned).
const FIXTURE_ROLE = 'QA_FIXTURE_WRITER';
const CONDITION_KEY_BY_NAME = require('../services/activitySafety/context').CONDITION_KEYS || {};

// Per-caller sliding-window rate limit: fixture setup is scripted, anything
// beyond this is abuse or a runaway harness.
const RATE_LIMIT = { windowMs: 60_000, max: 30 };
const buckets = new Map();
const rateLimited = (userId) => {
  const now = Date.now();
  const hits = (buckets.get(userId) || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (hits.length >= RATE_LIMIT.max) { buckets.set(userId, hits); return true; }
  hits.push(now); buckets.set(userId, hits); return false;
};

const isSynthetic = async (prisma, userId) => {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!u?.email && SYNTHETIC_DOMAINS.has(u.email.split('@')[1]?.toLowerCase());
};

const isPrivileged = async (prisma, userId) => !!(await prisma.userRole.findFirst({
  where: { userId, active: true, role: { name: FIXTURE_ROLE } }, select: { id: true },
}));

const gate = async (req, res, next) => {
  if (!ENABLED) return res.status(404).json({ error: 'not_found' });
  const prisma = getPrisma();
  if (!await isSynthetic(prisma, uid(req))) return res.status(403).json({ error: 'synthetic_users_only' });
  if (!await isPrivileged(prisma, uid(req))) return res.status(403).json({ error: 'fixture_privilege_required' });
  if (rateLimited(uid(req))) return res.status(429).json({ error: 'rate_limited' });
  next();
};
router.use(gate);

// POST /test-fixtures/safety-state — set medical/safety state for the CALLER.
// Body subsets: {conditions:[names], restrictions:[{categories,severity}],
//   surgeries:[{procedureCategory,status,...}], profile:{pregnancyStatus,
//   postpartumWeeks,walkingAbility,mobilityAids,wheelchairUser,balanceLimitation},
//   user:{dateOfBirth,activityLevel,goalType}}
router.post('/', requireFeature('activity_safety_engine'), async (req, res) => {
  try {
    const prisma = getPrisma(), userId = uid(req), b = body(req);
    for (const k of ['conditions', 'restrictions', 'surgeries']) {
      if (b[k] !== undefined && (!Array.isArray(b[k]) || b[k].length > 25)) {
        return res.status(400).json({ error: `${k} must be an array of at most 25 entries` });
      }
    }
    if ((b.conditions || []).some((n) => typeof n !== 'string' || n.length > 120)) {
      return res.status(400).json({ error: 'condition names must be strings of at most 120 chars' });
    }
    const made = { conditions: 0, restrictions: 0, surgeries: 0, profile: false, user: false, env: false };
    // env: per-scenario deterministic environment fixture (envPatch) for THIS
    // synthetic user — in-memory only, cleared on DELETE and on restart.
    if (b.env && typeof b.env === 'object') { envFixture.set(userId, b.env); made.env = true; }
    for (const name of b.conditions || []) {
      const cond = await prisma.healthCondition.upsert({
        where: { name: String(name) }, create: { name: String(name) }, update: {},
      });
      await prisma.userHealthCondition.create({ data: { userId, conditionId: cond.id, active: true } });
      made.conditions++;
    }
    for (const r of b.restrictions || []) {
      await prisma.userActivityRestriction.create({ data: {
        userId, categories: r.categories || [], bodyRegions: r.bodyRegions || [],
        severity: r.severity || 'prohibited', status: r.status || 'active', source: 'self_reported',
      } });
      made.restrictions++;
    }
    for (const s of b.surgeries || []) {
      await prisma.userSurgery.create({ data: {
        userId, procedureCategory: s.procedureCategory || 'other',
        status: s.status || 'recovering', performedAt: s.performedAt ? new Date(s.performedAt) : null,
        reassessAt: s.reassessAt ? new Date(s.reassessAt) : null,
        clinicianRestrictions: s.clinicianRestrictions || [], activityClearance: s.activityClearance || {},
      } });
      made.surgeries++;
    }
    if (b.profile) {
      const d = {}; for (const k of ['pregnancyStatus','postpartumWeeks','walkingAbility','mobilityAids','wheelchairUser','balanceLimitation','standingToleranceMin','accessibilityNeeds','preferredAdaptations']) if (b.profile[k] !== undefined) d[k] = b.profile[k];
      await prisma.userActivityProfile.upsert({ where: { userId }, create: { userId, ...d }, update: d });
      made.profile = true;
    }
    if (b.user) {
      const d = {}; for (const k of ['dateOfBirth','activityLevel','goalType']) if (b.user[k] !== undefined) d[k] = k === 'dateOfBirth' ? new Date(b.user[k]) : b.user[k];
      if (Object.keys(d).length) { await prisma.user.update({ where: { id: userId }, data: d }); made.user = true; }
    }
    await audit.log({ actorId: userId, action: 'fixture.safety_state', entityType: 'SyntheticFixture', entityId: userId, afterData: made }).catch(() => null);
    res.json({ applied: made });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /test-fixtures/safety-state — clear all fixture-writable state for caller.
router.delete('/', requireFeature('activity_safety_engine'), async (req, res) => {
  try {
    const prisma = getPrisma(), userId = uid(req);
    const [c, r, s, i, sy] = await prisma.$transaction([
      prisma.userHealthCondition.deleteMany({ where: { userId } }),
      prisma.userActivityRestriction.deleteMany({ where: { userId } }),
      prisma.userSurgery.deleteMany({ where: { userId } }),
      prisma.userInjury.deleteMany({ where: { userId } }),
      prisma.userSymptomReport.deleteMany({ where: { userId } }),
    ]);
    await prisma.userActivityProfile.updateMany({ where: { userId }, data: { pregnancyStatus: null, postpartumWeeks: null, mobilityAids: [], wheelchairUser: false, balanceLimitation: false, standingToleranceMin: null } });
    envFixture.clear(userId);
    await audit.log({ actorId: userId, action: 'fixture.safety_state_reset', entityType: 'SyntheticFixture', entityId: userId, afterData: { c: c.count, r: r.count, s: s.count, i: i.count, sy: sy.count } }).catch(() => null);
    res.json({ cleared: { conditions: c.count, restrictions: r.count, surgeries: s.count, injuries: i.count, symptoms: sy.count } });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
