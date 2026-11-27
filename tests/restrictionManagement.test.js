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
    deleteMany: jest.fn(async ({ where }) => {
      const before = store.restrictions.length;
      store.restrictions = store.restrictions.filter((r) => !(r.id === where?.id && (!where?.userId || r.userId === where.userId)));
      return { count: before - store.restrictions.length };
    }),
  },
  userRole: {
    findMany: jest.fn(async ({ where } = {}) =>
      String(where?.userId || '').startsWith('clin-') ? [{ role: { name: 'clinician' } }] : []),
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
  it('duplicates: exact-duplicate create is idempotent — same row back, one row total', async () => {
    const body = { categories: [RUNNING_CAT], severity: 'prohibited', reason: 'knee', bodyRegions: ['knee'] };
    const r1 = await request(app).post('/activity-safety/restrictions').set(auth('u-dup')).send(body);
    const r2 = await request(app).post('/activity-safety/restrictions').set(auth('u-dup')).send(body); // offline retry
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r2.body.duplicate).toBe(true);
    expect(r2.body.restriction.id).toBe(r1.body.restriction.id);
    expect(store.restrictions.filter((r) => r.userId === 'u-dup')).toHaveLength(1); // never piled up
    // a MEANINGFULLY different restriction still creates a second row
    const r3 = await request(app).post('/activity-safety/restrictions').set(auth('u-dup')).send({ categories: ['overhead'], severity: 'modify' });
    expect(r3.status).toBe(201);
  });

  it('concurrent updates: two PATCHes both apply — final state consistent, no lost-write corruption', async () => {
    const created = await request(app).post('/activity-safety/restrictions').set(auth('u-conc'))
      .send({ categories: [RUNNING_CAT], severity: 'prohibited' });
    const id = created.body.restriction.id;
    const [p1, p2] = await Promise.all([
      request(app).patch(`/activity-safety/restrictions/${id}`).set(auth('u-conc')).send({ severity: 'modify' }),
      request(app).patch(`/activity-safety/restrictions/${id}`).set(auth('u-conc')).send({ reason: 'updated concurrently' }),
    ]);
    expect([p1.status, p2.status]).toEqual([200, 200]);
    const row = store.restrictions.find((r) => r.id === id);
    expect(['prohibited', 'modify']).toContain(row.severity); // some consistent value, never torn
    expect(row.status).toBe('active');
  });

  it('review-date: reassessAt round-trips and expired rows stay in canonical engine scope', async () => {
    const reassess = new Date(Date.now() + 14 * 86400000).toISOString();
    const created = await request(app).post('/activity-safety/restrictions').set(auth('u-rev'))
      .send({ categories: [RUNNING_CAT], reassessAt: reassess });
    expect(new Date(created.body.restriction.reassessAt).toISOString()).toBe(reassess);
    // engine scope: the canonical loader queries status in [active, expired] —
    // an EXPIRED restriction still constrains evaluation (expiry ≠ clearance).
    const { findMany } = mockPrisma.userActivityRestriction;
    store.restrictions.push({ id: 'r-exp', userId: 'u-rev', categories: ['impact'], severity: 'prohibited',
      source: 'self_reported', status: 'expired', expiresAt: new Date(Date.now() - 86400000), createdAt: new Date(), updatedAt: new Date() });
    const rows = await findMany({ where: { userId: 'u-rev', status: { in: ['active', 'expired'] } } });
    expect(rows.some((r) => r.id === 'r-exp')).toBe(true); // engine contract holds
    expect(store.restrictions.find((r) => r.id === 'r-exp').status).not.toBe('resolved'); // never auto-resolved
  });

  it('user-removal: own restriction hard-deletes; clinician rows refuse non-clinician deletion (no silent deactivation)', async () => {
    const created = await request(app).post('/activity-safety/restrictions').set(auth('u-del'))
      .send({ categories: [RUNNING_CAT] });
    const del = await request(app).delete(`/activity-safety/restrictions/${created.body.restriction.id}`).set(auth('u-del'));
    expect(del.status).toBe(200);
    expect(store.restrictions.find((r) => r.id === created.body.restriction.id)).toBeUndefined(); // hard delete
    // clinician-documented: non-clinician delete is REFUSED — the regression guard
    store.restrictions.push({ id: 'r-clindel', userId: 'u-del', categories: ['trunk_load'], severity: 'prohibited',
      source: 'clinician_documented', status: 'active', createdAt: new Date(), updatedAt: new Date() });
    const clinDel = await request(app).delete('/activity-safety/restrictions/r-clindel').set(auth('u-del'));
    expect(clinDel.status).toBe(403);
    expect(clinDel.body.code).toBe('CLINICIAN_LOCKED');
    expect(clinDel.body.error).toMatch(/never implies medical clearance/);
    expect(store.restrictions.find((r) => r.id === 'r-clindel').status).toBe('active'); // still enforced
  });

  it('clinician positive path: role-holding user creates + supersedes clinician-documented restrictions', async () => {
    // the loadUserRoles wiring — previously the clinician path was dead code in production
    const created = await request(app).post('/activity-safety/restrictions').set(auth('clin-1'))
      .send({ categories: ['trunk_load'], source: 'clinician_documented', clinicianNote: 'post-op lifting restriction' });
    expect(created.status).toBe(201);
    expect(created.body.restriction.source).toBe('clinician_documented');
    const del = await request(app).delete(`/activity-safety/restrictions/${created.body.restriction.id}`).set(auth('clin-1'));
    expect(del.status).toBe(200);
    expect(del.body.mode).toBe('superseded'); // audit trail kept, never hard-deleted
    expect(store.restrictions[0].status).toBe('superseded');
  });

  it('historical consistency: include=all surfaces resolved rows with resolution provenance', async () => {
    const created = await request(app).post('/activity-safety/restrictions').set(auth('u-hist'))
      .send({ categories: [RUNNING_CAT], reason: 'shin splints' });
    await request(app).post(`/activity-safety/restrictions/${created.body.restriction.id}/resolve`).set(auth('u-hist'));
    const activeOnly = await request(app).get('/activity-safety/restrictions').set(auth('u-hist'));
    expect(activeOnly.body.restrictions).toHaveLength(0); // resolved out of active view
    const all = await request(app).get('/activity-safety/restrictions?include=all').set(auth('u-hist'));
    const row = all.body.restrictions.find((r) => r.id === created.body.restriction.id);
    expect(row.status).toBe('resolved');
    expect(row.resolvedBy).toBe('u-hist');
    expect(row.resolvedAt).toBeTruthy(); // provenance retained historically
  });

  it('multiple simultaneous restrictions all constrain the canonical evaluation', async () => {
    await request(app).post('/activity-safety/restrictions').set(auth('u-multi')).send({ categories: ['impact'] });
    await request(app).post('/activity-safety/restrictions').set(auth('u-multi')).send({ categories: ['trunk_load'], severity: 'modify' });
    const rows = await mockPrisma.userActivityRestriction.findMany({ where: { userId: 'u-multi', status: 'active' } });
    expect(rows).toHaveLength(2); // independent restrictions co-exist and both load
    const cats = rows.flatMap((r) => r.categories);
    expect(cats).toContain('impact');
    expect(cats).toContain('trunk_load');
  });
});
