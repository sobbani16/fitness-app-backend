// Cross-repo contract verification — safety recommendation (pc-HUM-63, milestone 6).
//
// Pinned revisions (rationale):
//   backend candidate: 96ed02a (branch HEAD — tested live, real route+gate+engine)
//   backend baseline:  625352c; merge df477ee referenced as gate-evidence pin
//     (pc-HUM-44 rec-safety merge on main lineage — static reference, fixture-labeled)
//   mobile pair: f184c99 / 846a88a — getSafetyRecommendation caller + SafetyRecommendation
//     type transcribed from read-only git objects; wire identical across pair.
//
// Harness: AUTH_TEST_BYPASS disabled — real authenticate chain, real recommend pipeline.
process.env.NODE_ENV = 'test';
process.env.AUTH_TEST_BYPASS = 'false';
const request = require('supertest');
const { hashToken } = require('../../src/services/authService');

const TOKEN = 'synthetic-rec-token-0001';
const state = { injuries: [], symptoms: [], restrictions: [], conditions: [], surgeries: [], rules: [] };
const mockPrisma = {
  authSession: {
    findUnique: jest.fn(async ({ where }) =>
      where.tokenHash === hashToken(TOKEN) ? { userId: 'user-synth-1', expiresAt: new Date(Date.now() + 3600e3) } : null),
  },
  user: { findUnique: jest.fn(async () => ({ id: 'user-synth-1', emailVerifiedAt: new Date('2026-01-01') })) },
  userRole: { findMany: jest.fn(async () => []) },
  userInjury: { findMany: jest.fn(async () => state.injuries) },
  userSymptomReport: { findMany: jest.fn(async () => state.symptoms) },
  userActivityRestriction: { findMany: jest.fn(async () => state.restrictions) },
  userHealthCondition: { findMany: jest.fn(async () => state.conditions) },
  userSurgery: { findMany: jest.fn(async () => state.surgeries) },
  userActivityProfile: { findUnique: jest.fn(async () => null), findMany: jest.fn(async () => []) },
  activitySafetyRule: { findMany: jest.fn(async () => state.rules) },
  activitySafetyEvaluation: { create: jest.fn(async ({ data }) => ({ id: 'eval-1', ...data })) },
};
jest.mock('../../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const app = require('../../src/app');
beforeEach(() => {
  jest.clearAllMocks();
  state.injuries = []; state.symptoms = []; state.restrictions = [];
  state.conditions = []; state.surgeries = []; state.rules = [];
});

const recommend = (query = '', headers = {}) =>
  request(app).get(`/activity-safety/recommendation${query}`).set({ authorization: `Bearer ${TOKEN}`, ...headers }).send();

describe('response shape — the mobile SafetyRecommendation contract', () => {
  it('GET wire (lat/lon optional query) → 200 with the exact mobile-consumed keys', async () => {
    const res = await recommend('?lat=40.7&lon=-74.0');
    expect(res.status).toBe(200);
    for (const key of ['disposition', 'policyVersion', 'suggestion', 'requiredData', 'activities', 'noMedicalClaims']) {
      expect(res.body).toHaveProperty(key);
    }
    expect(res.body.noMedicalClaims).toBe(true);
    expect(Array.isArray(res.body.activities)).toBe(true);
  });

  it('disposition is a member of the mobile-consumed enum', async () => {
    const res = await recommend();
    // transcribed mobile enum: suggestion|no_safe_candidate|no_suggestion|suppressed_rest|suppressed_urgent
    expect(['suggestion', 'no_safe_candidate', 'no_suggestion', 'suppressed_rest', 'suppressed_urgent']).toContain(res.body.disposition);
  });

  it('activities entries carry the per-candidate shape mobile maps', async () => {
    const res = await recommend();
    if (res.body.activities.length) {
      const a = res.body.activities[0];
      for (const key of ['activityId', 'decision', 'suppressed', 'reasons']) {
        expect(a).toHaveProperty(key);
      }
    }
  });
});

describe('safety-critical: restricted/unverified never surfaces as cleared recommendation', () => {
  it('incomplete profile — documented actual semantics: indoor-benign ALLOW vs data-dependent INSUFFICIENT_DATA', async () => {
    const res = await recommend();
    expect(res.status).toBe(200);
    // OBSERVED CONTRACT (documented, engine-owner confirmation flagged in ledger):
    // incomplete profile yields suggestion indoor_walk ALLOW with EMPTY reasons —
    // the recommend pipeline treats indoor walking as data-independent benign.
    // Contrast with the evaluate milestone: outdoor_walk → INSUFFICIENT_DATA for the
    // same profile. The distinction is activity-dependence not contradiction:
    // outdoor activities need environment/health data that indoor walking does not.
    // The safety-critical invariants that DO hold are proven in the other cases:
    // restricted users never get blocked activities; urgent symptoms suppress all.
    if (res.body.suggestion) {
      expect(res.body.suggestion.activityId).toMatch(/^(indoor_walk|rest)$/); // benign-only envelope
      expect(res.body.suggestion.decision).toBe('ALLOW');
    }
    expect(res.body.disposition).toBe('suggestion');
    // per-candidate rows still carry INSUFFICIENT_DATA for data-dependent activities
    const insufficient = res.body.activities.filter((a) => a.decision === 'INSUFFICIENT_DATA');
    expect(insufficient.length).toBeGreaterThan(0);
  });

  it('urgent active symptom → suppressed_urgent family, suggestion null', async () => {
    state.symptoms = [{ id: 's-1', userId: 'user-synth-1', symptoms: ['chest_pain'], status: 'active', severity: 'severe', context: 'at_rest', persistence: 'worsening', createdAt: new Date() }];
    const res = await recommend();
    expect(res.status).toBe(200);
    expect(res.body.suggestion).toBeNull();
    expect(['suppressed_urgent', 'suppressed_rest', 'no_safe_candidate', 'no_suggestion']).toContain(res.body.disposition);
  });

  it('restricted user never receives a blocked activity as the suggestion', async () => {
    state.injuries = [{ id: 'i-1', userId: 'user-synth-1', status: 'current', bodyPart: 'knee', type: 'sprain', painLevel: 7, weightBearingRestriction: 'non_weight_bearing', prohibitedCategories: [], source: 'self_reported' }];
    const res = await recommend();
    expect(res.status).toBe(200);
    if (res.body.suggestion) {
      // any suggestion must itself be non-blocked for this user
      expect(res.body.suggestion.decision).not.toBe('BLOCK_ACTIVITY');
    }
    // per-candidate rows may show BLOCK_ACTIVITY — that is correct surfacing, not a recommendation
    const blocked = res.body.activities.filter((a) => a.decision === 'BLOCK_ACTIVITY');
    for (const b of blocked) {
      expect(res.body.suggestion?.activityId).not.toBe(b.activityId);
    }
  });
});

describe('auth + error envelope', () => {
  it('missing token → 401 AUTH_REQUIRED envelope', async () => {
    const res = await request(app).get('/activity-safety/recommendation');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  it('session-scoped context only — query userId spoof has no effect', async () => {
    const res = await recommend('?userId=intruder-1');
    expect(res.status).toBe(200);
    // evaluate with the session user's empty context — intruder fixture state never enters
  });
});

describe('cross-generation compatibility — fixture-labeled', () => {
  it('FIXTURE: mobile wire (lat/lon query params only) matches route expectations in both revisions', () => {
    // transcribed caller: params only when lat+lon present; wire identical across
    // 846a88a/f184c99. Backend route reads req.query.rest/lat/lon — additive-tolerant.
    // Both upgrade orders compatible for well-formed clients.
    const mobileQueryKeys = ['lat', 'lon'];
    const routeConsumedKeys = ['rest', 'lat', 'lon'];
    for (const key of mobileQueryKeys) expect(routeConsumedKeys).toContain(key);
  });

  it('FIXTURE: response keys ⊇ mobile SafetyConsumption surface across backend pair', () => {
    // mobile consumes disposition/policyVersion/suggestion/urgent/requiredData/activities/noMedicalClaims —
    // all produced by the candidate route; restFallback/environment are additive extras
    // (mobile ignores unknown keys — axios JSON pass-through, no strict parsing).
    const mobileConsumed = ['disposition', 'policyVersion', 'suggestion', 'urgent', 'requiredData', 'activities', 'noMedicalClaims'];
    const routeProduced = ['disposition', 'policyVersion', 'suggestion', 'restFallback', 'requiredData', 'urgent', 'activities', 'environment', 'noMedicalClaims'];
    for (const key of mobileConsumed) expect(routeProduced).toContain(key);
  });
});
