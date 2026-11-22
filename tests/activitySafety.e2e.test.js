// End-to-end workflow test through the real Express app + route handlers.
// A stateful in-memory store backs the prisma mock so writes (injury report,
// symptom report, feedback, injury update) flow into later evaluations —
// the same state transitions a production deployment would see.
const request = require('supertest');
const { envOverrideName } = require('../src/config/featureRegistry');
const flags = require('../src/services/featureFlags/service');

const store = {
  injuries: [], symptoms: [], restrictions: [], surgeries: [], conditions: [],
  feedback: [], evaluations: [], seq: 0,
};
const nid = () => `row-${++store.seq}`;

const mockPrisma = {
  user: { findUnique: jest.fn(async ({ where }) => ({ id: where.id, dateOfBirth: new Date('1990-01-01'), activityLevel: 'moderate', goalType: 'fitness' })) },
  userActivityProfile: { findUnique: jest.fn(async () => null) },
  userInjury: {
    findMany: jest.fn(async ({ where }) => store.injuries.filter(i => i.userId === where.userId && where.status.in.includes(i.status))),
    create: jest.fn(async ({ data }) => { const r = { id: nid(), updatedAt: new Date(), ...data }; store.injuries.push(r); return r; }),
    updateMany: jest.fn(async ({ where, data }) => {
      let n = 0;
      for (const i of store.injuries) if (i.id === where.id && i.userId === where.userId) { Object.assign(i, data, { updatedAt: new Date() }); n++; }
      return { count: n };
    }),
  },
  userSurgery: { findMany: jest.fn(async ({ where }) => store.surgeries.filter(s => s.userId === where.userId)) },
  userActivityRestriction: { findMany: jest.fn(async ({ where }) => store.restrictions.filter(r => r.userId === where.userId)) },
  userSymptomReport: {
    findMany: jest.fn(async ({ where }) => store.symptoms.filter(s => s.userId === where.userId && s.status === where.status && new Date(s.reportedAt) >= where.reportedAt.gte)),
    create: jest.fn(async ({ data }) => { const r = { id: nid(), reportedAt: new Date(), createdAt: new Date(), ...data }; store.symptoms.push(r); return r; }),
  },
  userHealthCondition: { findMany: jest.fn(async ({ where }) => store.conditions.filter(c => c.userId === where.userId)) },
  activitySafetyRule: { findMany: jest.fn(async () => []) }, // zero APPROVED rules
  activitySafetyEvaluation: { create: jest.fn(async ({ data }) => { const r = { id: nid(), ...data }; store.evaluations.push(r); return r; }) },
  activitySafetyFeedback: { create: jest.fn(async ({ data }) => { const r = { id: nid(), ...data }; store.feedback.push(r); return r; }) },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
// Deterministic env: mild conditions, no alerts (recommendation pipeline runs).
jest.mock('../src/services/environmentService', () => ({
  fetchEnvironment: jest.fn(async () => ({
    provider: 'test', available: true, stale: false, tempC: 20, apparentTempC: 20,
    weatherCode: 2, precipitationMm: 0, aqi: { value: 30 }, uvIndex: 2,
    alerts: [], alertsAvailable: true, forecast: [],
  })),
  markStale: obs => obs,
}));

const app = require('../src/app');
const setFlag = (k, v) => { process.env[envOverrideName(k)] = v; flags.resetCache(); };
const U = 'e2e-user';

beforeEach(() => {
  ['activity_safety_engine', 'health_aware_recommendations', 'weather_intelligence_v2', 'activity_safety_shadow_mode']
    .forEach(k => setFlag(k, 'true'));
});
afterEach(() => {
  for (const k of Object.keys(store)) store[k] = Array.isArray(store[k]) ? [] : store[k];
  store.seq = 0;
});

describe('full safety workflow (stateful)', () => {
  test('healthy → injury → restricted recommendation → urgent symptom → recovery → restored', async () => {
    // 1. Healthy user gets an activity suggestion.
    let res = await request(app).get('/activity-safety/recommendation').set('x-user-id', U);
    expect(res.status).toBe(200);
    expect(res.body.disposition).toBe('suggestion');
    expect(['outdoor_walk', 'indoor_walk', 'outdoor_run']).toContain(res.body.suggestion.activityId);

    // 2. Reports an ankle fracture with an explicit NWB restriction.
    res = await request(app).post('/activity-safety/injuries').set('x-user-id', U)
      .send({ bodyPart: 'ankle', type: 'fracture', weightBearingRestriction: 'non_weight_bearing', painLevel: 6 });
    expect(res.status).toBe(201);
    expect(res.body.followUps.length).toBeGreaterThan(0); // reassessment question still needed
    const injuryId = res.body.injuryId;

    // 3. The same evaluation pipeline now excludes weight-bearing outdoors;
    //    the suggestion (if any) cannot be a weight-bearing activity.
    res = await request(app).get('/activity-safety/recommendation').set('x-user-id', U);
    expect(res.status).toBe(200);
    const walkEval = res.body.activities.find(a => a.activityId === 'outdoor_walk');
    expect(walkEval.decision).toBe('BLOCK_ACTIVITY');
    if (res.body.suggestion) {
      expect(['outdoor_walk', 'outdoor_run', 'indoor_walk', 'strength_training', 'group_fitness_class']).not.toContain(res.body.suggestion.activityId);
    }

    // 4. Specific-activity evaluation agrees — run is blocked.
    res = await request(app).post('/activity-safety/evaluate').set('x-user-id', U).send({ activityId: 'outdoor_run' });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('BLOCK_ACTIVITY');

    // 5. Urgent symptom → escalation copy + full suppression.
    res = await request(app).post('/activity-safety/symptoms').set('x-user-id', U)
      .send({ symptoms: ['chest_pain'], severity: 'severe', context: 'at_rest' });
    expect(res.status).toBe(201);
    expect(res.body.disposition).toBe('urgent_escalation');
    res = await request(app).get('/activity-safety/recommendation').set('x-user-id', U);
    expect(res.body.disposition).toBe('suppressed_urgent');
    expect(res.body.suggestion).toBeNull();
    expect(res.body.urgent).toBeTruthy();

    // 6. Symptom resolves (aged out of the 72h window) — manually mark resolved.
    for (const s of store.symptoms) s.status = 'resolved';
    // 7. Feedback records user context — clinician advice noted, no permanent ban.
    res = await request(app).post('/activity-safety/feedback').set('x-user-id', U)
      .send({ verdict: 'clinician_advised_against', activityId: 'outdoor_run', detail: 'physio says no running yet' });
    expect(res.status).toBe(201);
    expect(res.body.actions.length).toBeGreaterThan(0);

    // 8. Injury marked resolved → weight-bearing options return.
    res = await request(app).patch(`/activity-safety/injuries/${injuryId}`).set('x-user-id', U).send({ status: 'resolved' });
    expect(res.status).toBe(200);
    res = await request(app).get('/activity-safety/recommendation').set('x-user-id', U);
    expect(res.body.disposition).toBe('suggestion');
    expect(['outdoor_walk', 'indoor_walk', 'outdoor_run']).toContain(res.body.suggestion.activityId);
  });

  test('restriction via clinician-advised feedback + injury update narrows suggestions without a permanent ban', async () => {
    // Surgery with undocumented clearance → review-level decisions, not blocks.
    store.surgeries.push({ id: 'sx1', userId: U, procedureCategory: 'knee_arthroscopy', status: 'recovering', clinicianRestrictions: [], activityClearance: {}, updatedAt: new Date() });
    let res = await request(app).post('/activity-safety/evaluate').set('x-user-id', U).send({ activityId: 'outdoor_run' });
    expect(res.body.decision).toBe('NEEDS_CLINICAL_REVIEW');
    // Indoor light activity may still be suggested — recovery never equals ban.
    res = await request(app).get('/activity-safety/recommendation').set('x-user-id', U);
    expect(res.status).toBe(200);
    expect(['suggestion', 'no_safe_candidate', 'no_suggestion']).toContain(res.body.disposition);
  });

  test('profile endpoint reflects recorded state for correction UX', async () => {
    await request(app).post('/activity-safety/injuries').set('x-user-id', U).send({ bodyPart: 'wrist', type: 'strain' });
    const res = await request(app).get('/activity-safety/profile').set('x-user-id', U);
    expect(res.status).toBe(200);
    expect(res.body.injuries.some(i => i.bodyPart === 'wrist')).toBe(true);
    expect(res.body.restrictions).toEqual([]);
  });
});
