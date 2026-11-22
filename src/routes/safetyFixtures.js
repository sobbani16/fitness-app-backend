// Staging-only safety-state fixture route (OPS-REQ-4).
// HARD GUARDS:
//   1. NODE_ENV === 'production' → throws at require time (boot fails).
//   2. SAFETY_STATE_FIXTURE must be explicitly '1' — else the router 404s.
//   3. Caller must be a synthetic user (email domain allowlist) — checked per
//      request against the DB, not a client claim.
//   4. All writes audit-logged; DELETE /me resets fixture state for the caller.
// Fixture data goes through the same models loadSafetyContext reads — the
// deployed evaluate endpoint is never special-cased.
if (process.env.NODE_ENV === 'production') {
  throw new Error('safetyFixtures must never load in production (SAFETY_STATE_FIXTURE)');
}
const express = require('express');
const router = express.Router();
const { getPrisma } = require('../lib/prisma');
const { requireFeature } = require('../middleware/requireFeature');
const audit = require('../services/auditService');
const uid = req => req.userId;
const body = req => (req.body && typeof req.body === 'object' ? req.body : {});

const ENABLED = process.env.SAFETY_STATE_FIXTURE === '1';
const SYNTHETIC_DOMAINS = new Set(['euploading.com', 'staging.test', 'syn.local', 'example.com']);
const CONDITION_KEY_BY_NAME = require('../services/activitySafety/context').CONDITION_KEYS || {};

const isSynthetic = async (prisma, userId) => {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!u?.email && SYNTHETIC_DOMAINS.has(u.email.split('@')[1]?.toLowerCase());
};

const gate = async (req, res, next) => {
  if (!ENABLED) return res.status(404).json({ error: 'not_found' });
  if (!await isSynthetic(getPrisma(), uid(req))) return res.status(403).json({ error: 'synthetic_users_only' });
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
    const made = { conditions: 0, restrictions: 0, surgeries: 0, profile: false, user: false };
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
    await audit.log({ actorId: userId, action: 'fixture.safety_state_reset', entityType: 'SyntheticFixture', entityId: userId, afterData: { c: c.count, r: r.count, s: s.count, i: i.count, sy: sy.count } }).catch(() => null);
    res.json({ cleared: { conditions: c.count, restrictions: r.count, surgeries: s.count, injuries: i.count, symptoms: sy.count } });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
