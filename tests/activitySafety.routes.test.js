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
    findFirst: jest.fn(async () => ({ source: 'self_reported' })),
    create: jest.fn(async ({ data }) => ({ id: 'inj-1', ...data })),
    updateMany: jest.fn(async () => ({ count: 1 })),
  },
  userSurgery: { findMany: jest.fn(async () => []) },
  userActivityRestriction: { findMany: jest.fn(async () => []) },
  userSymptomReport: {
    findMany: jest.fn(async () => []),
    create: jest.fn(async ({ data }) => ({ id: 'sym-1', ...data })),
    updateMany: jest.fn(async () => ({ count: 1 })),
    deleteMany: jest.fn(async () => ({ count: 1 })),
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

const GATED_KEYS = ['activity_safety_engine', 'health_aware_recommendations', 'weather_intelligence_v2', 'activity_safety_shadow_mode'];

beforeEach(() => {
  jest.clearAllMocks();
  GATED_KEYS.forEach(k => setFlag(k, 'true'));
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

describe('GET /activity-safety/symptoms', () => {
  test('lists only the caller\'s reports, newest first, capped', async () => {
    mockPrisma.userSymptomReport.findMany.mockResolvedValueOnce([{ id: 's1', symptoms: ['dizziness'], reportedAt: '2026-11-20T10:00:00Z' }]);
    const res = await request(app).get('/activity-safety/symptoms').set('x-user-id', 'u1');
    expect(res.status).toBe(200);
    expect(res.body.reports).toHaveLength(1);
    expect(mockPrisma.userSymptomReport.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1' },
      orderBy: { reportedAt: 'desc' },
      take: 90,
    }));
  });
});

describe('PATCH /activity-safety/symptoms/:id', () => {
  test('owner-scoped update of editable fields', async () => {
    const res = await request(app).patch('/activity-safety/symptoms/s1').set('x-user-id', 'u1')
      .send({ severity: 'moderate', persistence: 'persistent' });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
    expect(mockPrisma.userSymptomReport.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 's1', userId: 'u1' },
      data: expect.objectContaining({ severity: 'moderate', persistence: 'persistent' }),
    }));
    // reportedAt/userId are immutable — never in the update payload
    const data = mockPrisma.userSymptomReport.updateMany.mock.calls[0][0].data;
    expect(data.reportedAt).toBeUndefined();
    expect(data.userId).toBeUndefined();
  });

  test('symptom codes editable; empty list rejected; invalid enum dropped', async () => {
    const res = await request(app).patch('/activity-safety/symptoms/s1').set('x-user-id', 'u1')
      .send({ symptoms: ['dizziness', 'nausea'], severity: 'bogus' });
    expect(res.status).toBe(200);
    const data = mockPrisma.userSymptomReport.updateMany.mock.calls[0][0].data;
    expect(data.symptoms).toEqual(['dizziness', 'nausea']);
    expect(data.severity).toBeNull();

    const bad = await request(app).patch('/activity-safety/symptoms/s1').set('x-user-id', 'u1').send({ symptoms: [] });
    expect(bad.status).toBe(400);
    const empty = await request(app).patch('/activity-safety/symptoms/s1').set('x-user-id', 'u1').send({});
    expect(empty.status).toBe(400);
  });

  test('404 on nonexistent/cross-user record', async () => {
    mockPrisma.userSymptomReport.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await request(app).patch('/activity-safety/symptoms/sX').set('x-user-id', 'u2').send({ severity: 'mild' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /activity-safety/symptoms/:id', () => {
  test('owner-scoped delete', async () => {
    const res = await request(app).delete('/activity-safety/symptoms/s1').set('x-user-id', 'u1');
    expect(res.status).toBe(200);
    expect(mockPrisma.userSymptomReport.deleteMany).toHaveBeenCalledWith({ where: { id: 's1', userId: 'u1' } });
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

describe('PATCH /activity-safety/injuries/:id — validation and clinician lock', () => {
  test('unknown fields → 400 unsupported_fields, nothing written', async () => {
    const res = await request(app).patch('/activity-safety/injuries/inj-1').set('x-user-id', 'u1').send({ severity: 'severe', hacker: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_fields');
    expect(res.body.unsupported).toEqual(expect.arrayContaining(['severity', 'hacker']));
    expect(mockPrisma.userInjury.updateMany).not.toHaveBeenCalled();
  });
  test('empty body → 400 no_editable_fields', async () => {
    const res = await request(app).patch('/activity-safety/injuries/inj-1').set('x-user-id', 'u1').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_editable_fields');
  });
  test('invalid enum values → 400 invalid_field', async () => {
    for (const [field, value] of [['status', 'kinda-better'], ['type', 'vibes'], ['laterality', 'middle'], ['weightBearingRestriction', 'sometimes']]) {
      const res = await request(app).patch('/activity-safety/injuries/inj-1').set('x-user-id', 'u1').send({ [field]: value });
      expect(res.status).toBe(400);
      expect(res.body.field).toBe(field);
    }
    expect(mockPrisma.userInjury.updateMany).not.toHaveBeenCalled();
  });
  test('painLevel out of range / non-integer → 400', async () => {
    for (const v of [11, -1, 4.5, 'ouch']) {
      const res = await request(app).patch('/activity-safety/injuries/inj-1').set('x-user-id', 'u1').send({ painLevel: v });
      expect(res.status).toBe(400);
      expect(res.body.field).toBe('painLevel');
    }
    const ok = await request(app).patch('/activity-safety/injuries/inj-1').set('x-user-id', 'u1').send({ painLevel: 7 });
    expect(ok.status).toBe(200);
  });
  test('prohibitedCategories validates against activity taxonomy', async () => {
    const bad = await request(app).patch('/activity-safety/injuries/inj-1').set('x-user-id', 'u1').send({ prohibitedCategories: ['made_up_cat'] });
    expect(bad.status).toBe(400);
    const ok = await request(app).patch('/activity-safety/injuries/inj-1').set('x-user-id', 'u1').send({ prohibitedCategories: ['impact', 'weight_bearing_lower'] });
    expect(ok.status).toBe(200);
    expect(mockPrisma.userInjury.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ prohibitedCategories: ['impact', 'weight_bearing_lower'] }),
    }));
  });
  test('resolved status stamps resolvedAt; recovering clears it', async () => {
    await request(app).patch('/activity-safety/injuries/inj-1').set('x-user-id', 'u1').send({ status: 'resolved' });
    expect(mockPrisma.userInjury.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'resolved', resolvedAt: expect.any(Date) }),
    }));
    await request(app).patch('/activity-safety/injuries/inj-1').set('x-user-id', 'u1').send({ status: 'current' });
    expect(mockPrisma.userInjury.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'current', resolvedAt: null }),
    }));
  });
  test('clearance fields are clinician-attested — self-report PATCH cannot write them', async () => {
    // Resolve ≠ clearance: a self-reported injury must not fabricate a
    // clinician clearance record via PATCH, single field or both.
    const single = await request(app).patch('/activity-safety/injuries/inj-1').set('x-user-id', 'u1').send({ clearanceRecordedAt: '2026-01-01' });
    expect(single.status).toBe(400); expect(single.body.error).toBe('unsupported_fields');
    const both = await request(app).patch('/activity-safety/injuries/inj-1').set('x-user-id', 'u1').send({ clearanceRecordedAt: '2026-01-01', clearanceNote: 'cleared by physio' });
    expect(both.status).toBe(400); expect(both.body.error).toBe('unsupported_fields');
    expect(both.body.unsupported).toEqual(expect.arrayContaining(['clearanceRecordedAt', 'clearanceNote']));
    expect(mockPrisma.userInjury.updateMany).not.toHaveBeenCalled();
  });
  test('clinician-documented injury: restriction fields locked → 409, status still editable', async () => {
    mockPrisma.userInjury.findFirst.mockResolvedValueOnce({ source: 'clinician_documented' });
    const res = await request(app).patch('/activity-safety/injuries/inj-1').set('x-user-id', 'u1').send({ weightBearingRestriction: 'full' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('clinician_fields_locked');
    expect(mockPrisma.userInjury.updateMany).not.toHaveBeenCalled();

    mockPrisma.userInjury.findFirst.mockResolvedValueOnce({ source: 'clinician_documented' });
    const ok = await request(app).patch('/activity-safety/injuries/inj-1').set('x-user-id', 'u1').send({ status: 'recovering', painLevel: 2 });
    expect(ok.status).toBe(200);
  });
  test('missing row → 404', async () => {
    mockPrisma.userInjury.findFirst.mockResolvedValueOnce(null);
    const res = await request(app).patch('/activity-safety/injuries/inj-1').set('x-user-id', 'u1').send({ status: 'recovering' });
    expect(res.status).toBe(404);
  });
});

describe('GET /activity-safety/injuries — management list', () => {
  test('returns full rows ordered current→resolved with provenance metadata', async () => {
    mockPrisma.userInjury.findMany.mockResolvedValueOnce([
      { id: 'r1', type: 'sprain', bodyPart: 'ankle', laterality: 'left', status: 'resolved', source: 'self_reported', injuredAt: '2026-10-01T00:00:00Z' },
      { id: 'c1', type: 'post_surgical', bodyPart: 'knee', laterality: 'right', status: 'current', source: 'clinician_documented', injuredAt: '2026-11-01T00:00:00Z' },
      { id: 's1', type: 'strain', bodyPart: 'wrist', laterality: 'na', status: 'current', source: 'self_reported', injuredAt: '2026-11-15T00:00:00Z' },
    ]);
    const res = await request(app).get('/activity-safety/injuries').set('x-user-id', 'u1');
    expect(res.status).toBe(200);
    expect(mockPrisma.userInjury.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
    const rows = res.body.injuries;
    expect(rows.map(r => r.id)).toEqual(['c1', 's1', 'r1']); // current first (input order within status), resolved last
    const clin = rows.find(r => r.id === 'c1');
    expect(clin.clinicianDocumented).toBe(true);
    expect(clin.lockedFields).toEqual(expect.arrayContaining(['weightBearingRestriction', 'prohibitedCategories', 'clearanceNote']));
    expect(clin.editableFields).not.toContain('weightBearingRestriction');
    const self = rows.find(r => r.id === 's1');
    expect(self.clinicianDocumented).toBe(false);
    expect(self.lockedFields).toEqual([]);
    expect(self.editableFields).toContain('weightBearingRestriction');
    // Clinician-attested fields are never advertised as self-editable.
    expect(self.editableFields).not.toContain('clearanceRecordedAt');
    expect(self.editableFields).not.toContain('clearanceNote');
  });
  test('empty list → 200 with empty array', async () => {
    const res = await request(app).get('/activity-safety/injuries').set('x-user-id', 'u1');
    expect(res.status).toBe(200);
    expect(res.body.injuries).toEqual([]);
  });
});

// Restore flag env state — in-band jest shares process.env across suites.
afterAll(() => {
  GATED_KEYS.forEach(k => setFlag(k, 'true'));
});
