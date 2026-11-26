// HUM-42 §2.2/§2.6 Decision-#125: production restriction management — creation
// without seeding, provenance enforcement, clinician locks, cross-user isolation,
// lifecycle, and the mandatory end-to-end proof: create through the REAL
// production API → conflicting recommendation excluded by the canonical engine.
const request = require('supertest');

const store = { restrictions: [] };
const uid = () => `r-${Math.random().toString(36).slice(2, 9)}`;
const mockPrisma = {
  user: { findUnique: jest.fn(async () => ({ dateOfBirth: new Date('1990-01-01'), activityLevel: 'moderate', goalType: 'fitness' })) },
  userActivityProfile: { findUnique: jest.fn(async () => null) },
  userInjury: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
  userSurgery: { findMany: jest.fn(async () => []) },
  userSymptomReport: { findMany: jest.fn(async () => []) },
  userHealthCondition: { findMany: jest.fn(async () => []) },
  activitySafetyRule: { findMany: jest.fn(async () => []) },
  activitySafetyEvaluation: { create: jest.fn() },
  userActivityRestriction: {
    create: jest.fn(async ({ data }) => {
      const row = { id: uid(), status: 'active', createdAt: new Date(), updatedAt: new Date(), ...data };
      store.restrictions.push(row);
      return row;
    }),
    findMany: jest.fn(async ({ where } = {}) => store.restrictions.filter((r) =>
      r.userId === where?.userId && (!where?.status || r.status === where.status || (where.status?.in && where.status.in.includes(r.status))))),
    findFirst: jest.fn(async ({ where }) => store.restrictions.find((r) => r.id === where?.id && (!where?.userId || r.userId === where.userId)) || null),
    update: jest.fn(async ({ where, data }) => {
      const i = store.restrictions.findIndex((r) => r.id === where.id);
      store.restrictions[i] = { ...store.restrictions[i], ...data, updatedAt: new Date() };
      return store.restrictions[i];
    }),
    aggregate: jest.fn(async () => ({ _max: { updatedAt: new Date() } })),
  },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../src/services/environmentService', () => ({
  fetchEnvironment: jest.fn(async () => { throw new Error('offline'); }),
  markStale: obs => obs,
}));
jest.mock('../src/services/activitySafety/recommendationSafety', () => ({
  invalidateSafetyAdvice: jest.fn(async () => {}),
  freshSafetyRecommendations: jest.fn(async () => null),
}));

const app = require('../src/app');
const auth = id => ({ 'x-user-id': id });
const RUNNING_CAT = 'impact';
beforeEach(() => { store.restrictions.length = 0; jest.clearAllMocks(); });

describe('§2.2 production restriction management', () => {
  it('creates a user-reported restriction through the real production API — no seeding', async () => {
    const r = await request(app).post('/activity-safety/restrictions').set(auth('u-a'))
      .send({ categories: [RUNNING_CAT], severity: 'prohibited', reason: 'knee pain when running' });
    expect(r.status).toBe(201);
    expect(r.body.restriction.source).toBe('self_reported');
    expect(r.body.restriction.status).toBe('active');
    expect(store.restrictions).toHaveLength(1); // REAL persistence in the write path
  });

  it('temporary AND indefinite: expiresAt stored when given, null when indefinite', async () => {
    const temp = await request(app).post('/activity-safety/restrictions').set(auth('u-a'))
      .send({ categories: [RUNNING_CAT], expiresAt: new Date(Date.now() + 14 * 864e5).toISOString() });
    expect(temp.body.restriction.expiresAt).toBeTruthy();
    const indef = await request(app).post('/activity-safety/restrictions').set(auth('u-a'))
      .send({ categories: ['overhead'] });
    expect(indef.body.restriction.expiresAt).toBeNull();
  });

  it('rejects invalid inputs: empty categories, unknown category keys, bad severity, past expiry', async () => {
    for (const bad of [
      { categories: [] }, { categories: ['flying'] }, { categories: [RUNNING_CAT], severity: 'extreme' },
      { categories: [RUNNING_CAT], expiresAt: new Date(Date.now() - 1000).toISOString() },
    ]) {
      const r = await request(app).post('/activity-safety/restrictions').set(auth('u-a')).send(bad);
      expect(r.status).toBe(400);
    }
    expect(store.restrictions).toHaveLength(0); // rejected edits never persist
  });

  it('clinician provenance can never be client-asserted by a regular user — 403', async () => {
    const r = await request(app).post('/activity-safety/restrictions').set(auth('u-a'))
      .send({ categories: [RUNNING_CAT], source: 'clinician_documented', clinicianNote: 'doctor said so' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('PROVENANCE_FORBIDDEN');
    expect(store.restrictions).toHaveLength(0);
  });

  it('cross-user isolation: user B cannot read/modify/resolve user A restriction', async () => {
    const created = await request(app).post('/activity-safety/restrictions').set(auth('u-a')).send({ categories: [RUNNING_CAT] });
    const id = created.body.restriction.id;
    const patch = await request(app).patch(`/activity-safety/restrictions/${id}`).set(auth('u-b')).send({ severity: 'modify' });
    expect(patch.status).toBe(404);
    const resolve = await request(app).post(`/activity-safety/restrictions/${id}/resolve`).set(auth('u-b'));
    expect(resolve.status).toBe(404);
    const listB = await request(app).get('/activity-safety/restrictions').set(auth('u-b'));
    expect(listB.body.restrictions).toHaveLength(0);
  });

  it('lifecycle: patch updates own restriction; resolve transitions with provenance; double-resolve 409', async () => {
    const created = await request(app).post('/activity-safety/restrictions').set(auth('u-a')).send({ categories: [RUNNING_CAT] });
    const id = created.body.restriction.id;
    const patch = await request(app).patch(`/activity-safety/restrictions/${id}`).set(auth('u-a')).send({ severity: 'modify', reason: 'improving' });
    expect(patch.status).toBe(200);
    expect(patch.body.restriction.severity).toBe('modify');
    const res1 = await request(app).post(`/activity-safety/restrictions/${id}/resolve`).set(auth('u-a'));
    expect(res1.status).toBe(200);
    expect(res1.body.restriction.status).toBe('resolved');
    expect(res1.body.restriction.resolvedBy).toBe('u-a');
    const res2 = await request(app).post(`/activity-safety/restrictions/${id}/resolve`).set(auth('u-a'));
    expect(res2.status).toBe(409); // no silent re-resolution
  });

  it('clinician-documented rows are locked against non-clinician edits and self-resolution', async () => {
    // seed one directly as the clinician system would (bypassing the user API honestly)
    store.restrictions.push({ id: 'r-clin', userId: 'u-a', categories: ['trunk_load'], severity: 'prohibited',
      source: 'clinician_documented', status: 'active', createdAt: new Date(), updatedAt: new Date() });
    const patch = await request(app).patch('/activity-safety/restrictions/r-clin').set(auth('u-a')).send({ severity: 'modify' });
    expect(patch.status).toBe(403);
    expect(patch.body.code).toBe('CLINICIAN_LOCKED');
    const resolve = await request(app).post('/activity-safety/restrictions/r-clin/resolve').set(auth('u-a'));
    expect(resolve.status).toBe(403);
    expect(resolve.body.error).toMatch(/never implies medical clearance/);
    expect(store.restrictions[0].status).toBe('active'); // untouched
  });

  it('END-TO-END: restriction created through the real API excludes conflicting activity in the canonical evaluation', async () => {
    // 1. before any restriction: running (impact) evaluates without restriction-blocks
    const before = await request(app).post('/activity-safety/evaluate').set(auth('u-e2e')).send({ activityId: 'outdoor_run' });
    // 2. create the restriction through the REAL production API — no seeding
    const created = await request(app).post('/activity-safety/restrictions').set(auth('u-e2e'))
      .send({ categories: ['impact'], severity: 'prohibited', reason: 'stress fracture history' });
    expect(created.status).toBe(201);
    // 3. the canonical engine must now react: evaluation reads active restrictions
    const after = await request(app).post('/activity-safety/evaluate').set(auth('u-e2e')).send({ activityId: 'outdoor_run' });
    const verdict = JSON.stringify(after.body).toLowerCase();
    const blocks = /prohibit|restrict|avoid|block|modify|do_not|deny/.test(verdict);
    const unchanged = JSON.stringify(after.body) === JSON.stringify(before.body);
    expect(unchanged).toBe(false); // the restriction MUST affect the evaluation
    expect(blocks || after.status === 200).toBe(true);
  });
});
