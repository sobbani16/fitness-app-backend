// /activity-safety route tests — mocked prisma, AUTH_TEST_BYPASS env.
// Verifies flag gating, symptom triage, injury capture with follow-ups,
// recommendation pipeline output, and per-user context loading.
const request = require('supertest');
const { envOverrideName } = require('../src/config/featureRegistry');
const flags = require('../src/services/featureFlags/service');

const mockPrisma = {
  user: { findUnique: jest.fn(async () => ({ dateOfBirth: new Date('1990-01-01'), activityLevel: 'moderate', goalType: 'fitness' })) },
  userActivityProfile: { findUnique: jest.fn(async () => null) },
  userInjury: {
    findMany: jest.fn(async () => []),
    create: jest.fn(async ({ data }) => ({ id: 'inj-1', ...data })),
    updateMany: jest.fn(async () => ({ count: 1 })),
  },
  userSurgery: { findMany: jest.fn(async () => []) },
  userActivityRestriction: { findMany: jest.fn(async () => []) },
  userSymptomReport: {
    findMany: jest.fn(async () => []),
    create: jest.fn(async ({ data }) => ({ id: 'sym-1', ...data })),
  },
  userHealthCondition: { findMany: jest.fn(async () => []) },
  activitySafetyRule: { findMany: jest.fn(async () => []) }, // APPROVED set empty
  activitySafetyEvaluation: { create: jest.fn(async ({ data }) => ({ id: 'ev-1', ...data })) },
  activitySafetyFeedback: { create: jest.fn(async ({ data }) => ({ id: 'fb-1', ...data })) },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
// Never hit the network — env fetch fails → env unknown (conservative path)
jest.mock('../src/services/environmentService', () => ({
  fetchEnvironment: jest.fn(async () => { throw new Error('offline'); }),
  markStale: obs => obs,
}));

const app = require('../src/app');
const setFlag = (k, v) => { process.env[envOverrideName(k)] = v; flags.resetCache(); };

beforeEach(() => {
  jest.clearAllMocks();
  ['activity_safety_engine', 'health_aware_recommendations', 'weather_intelligence_v2', 'activity_safety_shadow_mode']
    .forEach(k => setFlag(k, 'true'));
});

describe('flag gating', () => {
  test('disabled engine → 403 FEATURE_DISABLED on all activity-safety routes', async () => {
    setFlag('activity_safety_engine', 'false');
    for (const [m, p] of [['post', '/activity-safety/evaluate'], ['post', '/activity-safety/symptoms'], ['post', '/activity-safety/injuries'], ['post', '/activity-safety/feedback'], ['get', '/activity-safety/profile']]) {
      const res = await request(app)[m](p).set('x-user-id', 'u1').send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FEATURE_DISABLED');
    }
  });
  test('disabled health_aware_recommendations → /recommendation 403', async () => {
    setFlag('health_aware_recommendations', 'false');
    const res = await request(app).get('/activity-safety/recommendation').set('x-user-id', 'u1');
    expect(res.status).toBe(403);
  });
  test('disabled weather_intelligence_v2 → /weather/environment 403', async () => {
    setFlag('weather_intelligence_v2', 'false');
    const res = await request(app).get('/weather/environment?lat=18&lon=73').set('x-user-id', 'u1');
    expect(res.status).toBe(403);
  });
});

describe('POST /activity-safety/symptoms', () => {
  test('urgent code → 201 + escalation + suppression flag', async () => {
    const res = await request(app).post('/activity-safety/symptoms').set('x-user-id', 'u1')
      .send({ symptoms: ['chest_pain'], severity: 'severe', context: 'at_rest' });
    expect(res.status).toBe(201);
    expect(res.body.disposition).toBe('urgent_escalation');
    expect(res.body.suppressesActivitySuggestions).toBe(true);
    expect(res.body.urgentSymptoms).toContain('chest_pain');
    expect(res.body.noDiagnosis).toBe(true);
    expect(mockPrisma.userSymptomReport.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'u1', symptoms: ['chest_pain'], triageOutcome: 'urgent_escalation', status: 'active' }),
    }));
  });
  test('non-urgent code → recorded', async () => {
    const res = await request(app).post('/activity-safety/symptoms').set('x-user-id', 'u1').send({ symptoms: ['dizziness'] });
    expect(res.status).toBe(201);
    expect(res.body.disposition).toBe('recorded');
    expect(res.body.urgentSymptoms).toEqual([]);
  });
  test('empty symptoms → 400', async () => {
    const res = await request(app).post('/activity-safety/symptoms').set('x-user-id', 'u1').send({ symptoms: [] });
    expect(res.status).toBe(400);
  });
});

describe('POST /activity-safety/injuries', () => {
  test('creates self-reported injury with targeted follow-ups', async () => {
    const res = await request(app).post('/activity-safety/injuries').set('x-user-id', 'u1')
      .send({ bodyPart: 'knee', laterality: 'right', type: 'sprain', painLevel: 5 });
    expect(res.status).toBe(201);
    expect(res.body.injuryId).toBe('inj-1');
    expect(res.body.followUps.map(q => q.id)).toContain('weight_bearing');
    expect(res.body.noDiagnosis).toBe(true);
    expect(mockPrisma.userInjury.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'u1', bodyPart: 'knee', status: 'current', source: 'self_reported' }),
    }));
  });
  test('missing bodyPart → 400', async () => {
    const res = await request(app).post('/activity-safety/injuries').set('x-user-id', 'u1').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /activity-safety/recommendation', () => {
  test('healthy profile → suggestion with policy version', async () => {
    const res = await request(app).get('/activity-safety/recommendation').set('x-user-id', 'u1');
    expect(res.status).toBe(200);
    expect(res.body.policyVersion).toBeTruthy();
    expect(res.body.noMedicalClaims).toBe(true);
    // env fetch fails offline → outdoor is INSUFFICIENT_DATA, indoor suggestion still offered
    expect(res.body.suggestion).not.toBeNull();
    const outdoor = res.body.activities.find(a => a.activityId === 'outdoor_walk');
    expect(outdoor.decision).toBe('INSUFFICIENT_DATA');
  });
  test('active NWB injury → walking excluded from suggestion', async () => {
    mockPrisma.userInjury.findMany.mockResolvedValueOnce([{
      id: 'i1', userId: 'u1', bodyPart: 'ankle', type: 'fracture', status: 'current',
      weightBearingRestriction: 'non_weight_bearing', prohibitedCategories: [], updatedAt: new Date(),
    }]);
    const res = await request(app).get('/activity-safety/recommendation').set('x-user-id', 'u1');
    expect(res.status).toBe(200);
    const walk = res.body.activities.find(a => a.activityId === 'outdoor_walk');
    expect(walk.decision).toBe('BLOCK_ACTIVITY');
    expect(res.body.suggestion.activityId).not.toBe('outdoor_walk');
  });
  test('active urgent symptom → suppressed_urgent, no suggestion', async () => {
    mockPrisma.userSymptomReport.findMany.mockResolvedValueOnce([{
      id: 's1', userId: 'u1', symptoms: ['chest_pain'], status: 'active', reportedAt: new Date(),
    }]);
    const res = await request(app).get('/activity-safety/recommendation').set('x-user-id', 'u1');
    expect(res.status).toBe(200);
    expect(res.body.disposition).toBe('suppressed_urgent');
    expect(res.body.suggestion).toBeNull();
    expect(res.body.urgent.decision).toBe('URGENT_ESCALATION');
  });
});

describe('POST /activity-safety/evaluate', () => {
  test('unknown activityId → 400', async () => {
    const res = await request(app).post('/activity-safety/evaluate').set('x-user-id', 'u1').send({ activityId: 'nope' });
    expect(res.status).toBe(400);
  });
  test('documented restriction → BLOCK_ACTIVITY in response', async () => {
    mockPrisma.userActivityRestriction.findMany.mockResolvedValueOnce([{
      id: 'r1', userId: 'u1', categories: ['impact'], severity: 'prohibited', status: 'active',
      source: 'clinician_documented', updatedAt: new Date(),
    }]);
    const res = await request(app).post('/activity-safety/evaluate').set('x-user-id', 'u1').send({ activityId: 'outdoor_run' });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('BLOCK_ACTIVITY');
    expect(res.body.noMedicalClaims).toBe(true);
  });
});

describe('POST /activity-safety/feedback + GET profile + PATCH injury', () => {
  test('valid feedback → 201 with actions', async () => {
    const res = await request(app).post('/activity-safety/feedback').set('x-user-id', 'u1')
      .send({ verdict: 'clinician_advised_against', activityId: 'outdoor_run' });
    expect(res.status).toBe(201);
    expect(res.body.actions.length).toBeGreaterThan(0);
    expect(mockPrisma.activitySafetyFeedback.create).toHaveBeenCalled();
  });
  test('invalid verdict → 400', async () => {
    const res = await request(app).post('/activity-safety/feedback').set('x-user-id', 'u1').send({ verdict: 'meh' });
    expect(res.status).toBe(400);
  });
  test('profile returns safety snapshot', async () => {
    const res = await request(app).get('/activity-safety/profile').set('x-user-id', 'u1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('injuries');
    expect(res.body).toHaveProperty('restrictions');
    expect(res.body).toHaveProperty('mobility');
  });
  test('PATCH injury status', async () => {
    const res = await request(app).patch('/activity-safety/injuries/inj-1').set('x-user-id', 'u1').send({ status: 'recovering' });
    expect(res.status).toBe(200);
    expect(mockPrisma.userInjury.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'inj-1', userId: 'u1' }, data: expect.objectContaining({ status: 'recovering' }),
    }));
  });
});
