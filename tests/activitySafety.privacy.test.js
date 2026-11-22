// Privacy remediation regression tests — Phase 15 P4 findings P-1..P-5.
const request = require('supertest');
const { envOverrideName } = require('../src/config/featureRegistry');
const flags = require('../src/services/featureFlags/service');

const mockPrisma = {
  user: { findUnique: jest.fn(async () => ({ dateOfBirth: new Date('1990-01-01'), activityLevel: 'moderate', goalType: 'fitness' })) },
  userActivityProfile: { findUnique: jest.fn(async () => null) },
  userInjury: {
    findMany: jest.fn(async () => []),
    create: jest.fn(async ({ data }) => ({ id: 'inj-1', ...data })),
    deleteMany: jest.fn(async () => ({ count: 1 })),
    updateMany: jest.fn(async () => ({ count: 1 })),
  },
  userSurgery: { findMany: jest.fn(async () => []) },
  userActivityRestriction: {
    findMany: jest.fn(async () => []),
    findFirst: jest.fn(async () => null),
    deleteMany: jest.fn(async () => ({ count: 1 })),
    update: jest.fn(async () => ({})),
  },
  userSymptomReport: {
    findMany: jest.fn(async () => []),
    create: jest.fn(async ({ data }) => ({ id: 'sym-1', ...data })),
    deleteMany: jest.fn(async () => ({ count: 1 })),
  },
  userHealthCondition: { findMany: jest.fn(async () => []) },
  activitySafetyRule: { findMany: jest.fn(async () => []) },
  activitySafetyEvaluation: { create: jest.fn(async ({ data }) => ({ id: 'ev-1', ...data })) },
  activitySafetyFeedback: {
    create: jest.fn(async ({ data }) => ({ id: 'fb-1', ...data })),
    deleteMany: jest.fn(async () => ({ count: 1 })),
  },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
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

describe('P-1 retention — user-scoped deletes', () => {
  test('DELETE /injuries/:id removes own record; missing → 404', async () => {
    const r = await request(app).delete('/activity-safety/injuries/inj-1').set('x-user-id', 'u1');
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(true);
    expect(mockPrisma.userInjury.deleteMany).toHaveBeenCalledWith({ where: { id: 'inj-1', userId: 'u1' } });
    mockPrisma.userInjury.deleteMany.mockResolvedValueOnce({ count: 0 });
    const r2 = await request(app).delete('/activity-safety/injuries/nope').set('x-user-id', 'u1');
    expect(r2.status).toBe(404);
  });
  test('DELETE /symptoms/:id and /feedback/:id are user-scoped', async () => {
    await request(app).delete('/activity-safety/symptoms/s1').set('x-user-id', 'u2');
    expect(mockPrisma.userSymptomReport.deleteMany).toHaveBeenCalledWith({ where: { id: 's1', userId: 'u2' } });
    await request(app).delete('/activity-safety/feedback/f1').set('x-user-id', 'u2');
    expect(mockPrisma.activitySafetyFeedback.deleteMany).toHaveBeenCalledWith({ where: { id: 'f1', userId: 'u2' } });
  });
  test('clinician-documented restriction soft-deletes to superseded; self-reported hard-deletes', async () => {
    mockPrisma.userActivityRestriction.findFirst
      .mockResolvedValueOnce({ id: 'r1', source: 'clinician_documented' })
      .mockResolvedValueOnce({ id: 'r2', source: 'self_reported' });
    const r1 = await request(app).delete('/activity-safety/restrictions/r1').set('x-user-id', 'u1');
    expect(r1.body.mode).toBe('superseded');
    expect(mockPrisma.userActivityRestriction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'superseded', resolvedBy: 'user_deleted' }),
    }));
    const r2 = await request(app).delete('/activity-safety/restrictions/r2').set('x-user-id', 'u1');
    expect(r2.body.deleted).toBe(true);
    expect(r2.body.mode).toBeUndefined();
  });
  test('a different user cannot delete records they do not own', async () => {
    const r = await request(app).delete('/activity-safety/injuries/inj-1').set('x-user-id', 'u1');
    expect(mockPrisma.userInjury.deleteMany).toHaveBeenLastCalledWith({ where: { id: 'inj-1', userId: 'u1' } });
    expect(r.status).toBe(200);
  });
});

describe('P-4 region-specific emergency copy', () => {
  test('declared region localizes urgent guidance; undeclared stays generic', async () => {
    const urgent = { symptoms: ['chest_pain'] };
    const inr = await request(app).post('/activity-safety/symptoms').set('x-user-id', 'u1').send({ ...urgent, region: 'in' });
    expect(inr.body.message).toContain('call 112');
    const usr = await request(app).post('/activity-safety/symptoms').set('x-user-id', 'u1').send({ ...urgent, region: 'us' });
    expect(usr.body.message).toContain('911');
    const none = await request(app).post('/activity-safety/symptoms').set('x-user-id', 'u1').send(urgent);
    expect(none.body.message).toContain('local emergency services');
    const bogus = await request(app).post('/activity-safety/symptoms').set('x-user-id', 'u1').send({ ...urgent, region: '<script>' });
    expect(bogus.body.message).toContain('local emergency services'); // unvalidated region never echoes
  });
});

describe('P-5 free-text fields never surface', () => {
  test('/profile response contains no rehabInstructions/notes fields', async () => {
    mockPrisma.userInjury.findMany.mockResolvedValueOnce([{
      id: 'i1', bodyPart: 'knee', status: 'current', weightBearingRestriction: 'partial',
      rehabInstructions: 'SECRET-FREETEXT', notes: 'SECRET-NOTES',
    }]);
    const r = await request(app).get('/activity-safety/profile').set('x-user-id', 'u1');
    expect(r.status).toBe(200);
    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain('SECRET-FREETEXT');
    expect(raw).not.toContain('SECRET-NOTES');
    expect(raw).not.toContain('rehabInstructions');
    expect(raw).not.toContain('notes');
  });
  test('injury create stores rehabInstructions but response never echoes it', async () => {
    const r = await request(app).post('/activity-safety/injuries').set('x-user-id', 'u1')
      .send({ bodyPart: 'knee', type: 'sprain', notes: 'SECRET-NOTES' });
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.body)).not.toContain('SECRET-NOTES');
    expect(JSON.stringify(r.body)).not.toContain('rehabInstructions');
  });
});

describe('P-2/P-3 trainer clinical detail requires explicit grant', () => {
  const { planSafetyConflicts } = require('../src/services/activitySafety/gate');
  test('consent category safety_restrictions is registered', () => {
    const { CONSENT_CATEGORIES } = require('../src/services/trainerAccess');
    expect(CONSENT_CATEGORIES).toContain('safety_restrictions');
  });
  test('summary detail strips categories; full detail keeps them (consent-gated)', async () => {
    const plan = { days: [{ dayIndex: 0, exercises: [{ exerciseName: 'Barbell Squat', exerciseId: 'ex-squat' }] }] };
    mockPrisma.exercise = { findUnique: jest.fn(async () => ({ id: 'ex-squat', name: 'Barbell Squat', mechanic: 'compound', equipment: 'barbell', category: 'strength', muscles: [{ muscle: 'quadriceps', role: 'primary' }] })) };
    mockPrisma.userActivityRestriction.findMany.mockResolvedValue([
      { id: 'r1', status: 'active', severity: 'prohibited', categories: ['lower_limb_load'], bodyRegions: ['lower_limb'], source: 'clinician_documented' },
    ]);
    const summary = await planSafetyConflicts(mockPrisma, 'u1', plan, { detail: 'summary' });
    const full = await planSafetyConflicts(mockPrisma, 'u1', plan, { detail: 'full' });
    const srow = summary.conflicts.find(c => c.exerciseName === 'Barbell Squat');
    const frow = full.conflicts.find(c => c.exerciseName === 'Barbell Squat');
    expect(srow.status).toBe('conflict');
    expect(srow.blockedCategories).toBeUndefined(); // stripped for trainers by default
    expect(srow.limitationConflict).toBeUndefined();
    expect(JSON.stringify(summary)).not.toContain('lower_limb_load');
    expect(frow.status).toBe('conflict'); // full detail only via grant — categories visible
    expect(JSON.stringify(full)).toContain('lower_limb_load');
  });
});
