// §4/§8: optimistic concurrency on injury/symptom PATCH — a stale write must
// 409 instead of silently clobbering a concurrent update.
const request = require('supertest');
const express = require('express');

jest.mock('../src/services/featureFlags/service', () => ({ isEnabled: async () => true }));
jest.mock('../src/services/activitySafety/invalidate', () => ({ invalidateSafetyAdvice: async () => ({}) }), { virtual: true });

const state = {
  injury: { id: 'inj-1', userId: 'u1', version: 3, status: 'current' },
  symptom: { id: 'sym-1', userId: 'u1', version: 5, severity: 'mild' },
};
const mkUpdateMany = (row) => async ({ where, data }) => {
  if (where.id !== row.id || where.userId !== row.userId) return { count: 0 };
  if (where.version !== undefined && where.version !== row.version) return { count: 0 };
  if (data.version && data.version.increment) row.version += data.version.increment;
  return { count: 1 };
};
jest.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    userInjury: {
      updateMany: mkUpdateMany(state.injury),
      findFirst: async ({ where }) => (where.id === state.injury.id && where.userId === state.injury.userId ? { version: state.injury.version } : null),
    },
    userSymptomReport: {
      updateMany: mkUpdateMany(state.symptom),
      findFirst: async ({ where }) => (where.id === state.symptom.id && where.userId === state.symptom.userId ? { version: state.symptom.version } : null),
    },
  }),
}));

const loadApp = () => {
  const router = require('../src/routes/activitySafety');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = 'u1'; next(); });
  app.use('/', router);
  return app;
};
const app = loadApp();

describe('optimistic concurrency (version guard)', () => {
  it('injury PATCH with correct version succeeds and increments', async () => {
    const before = state.injury.version;
    const r = await request(app).patch('/injuries/inj-1').send({ painLevel: 4, version: before });
    expect(r.status).toBe(200);
    expect(state.injury.version).toBe(before + 1);
  });

  it('injury PATCH with stale version → 409 with currentVersion, no write', async () => {
    const before = state.injury.version;
    const r = await request(app).patch('/injuries/inj-1').send({ painLevel: 9, version: before - 1 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('stale_version');
    expect(r.body.currentVersion).toBe(before);
    expect(state.injury.version).toBe(before);
  });

  it('injury PATCH without version still succeeds (legacy clients)', async () => {
    const r = await request(app).patch('/injuries/inj-1').send({ painLevel: 2 });
    expect(r.status).toBe(200);
  });

  it('symptom PATCH with stale version → 409', async () => {
    const before = state.symptom.version;
    const r = await request(app).patch('/symptoms/sym-1').send({ severity: 'severe', version: before - 1 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('stale_version');
    expect(state.symptom.version).toBe(before);
  });

  it('symptom PATCH with correct version increments', async () => {
    const before = state.symptom.version;
    const r = await request(app).patch('/symptoms/sym-1').send({ severity: 'moderate', version: before });
    expect(r.status).toBe(200);
    expect(state.symptom.version).toBe(before + 1);
  });

  it('stale version on nonexistent record → 404 not 409', async () => {
    const r = await request(app).patch('/injuries/nope').send({ painLevel: 1, version: 1 });
    expect(r.status).toBe(404);
  });
});
