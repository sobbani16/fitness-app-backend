// /test-fixtures/safety-state — fixture security matrix (HUM-28 §6.3).
// Proves: prod boot guard, env-flag gating, synthetic-domain check alone is
// insufficient (QA_FIXTURE_WRITER role required), input bounds, cross-user
// isolation, per-caller rate limiting.
const request = require('supertest');
const express = require('express');

process.env.SAFETY_STATE_FIXTURE = '1';
delete process.env.RAILWAY_ENVIRONMENT_NAME;

const mockFlags = { activity_safety_engine: true };
jest.mock('../src/services/featureFlags/service', () => ({ isEnabled: async (k) => Boolean(mockFlags[k]) }));

const mockStore = { email: null, privileged: false, created: [] };
jest.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    user: {
      findUnique: async () => (mockStore.email ? { email: mockStore.email } : null),
      update: async () => ({}),
    },
    userRole: { findFirst: async () => (mockStore.privileged ? { id: 'r1' } : null) },
    healthCondition: { upsert: async ({ where }) => ({ id: 'c-' + where.name }) },
    userHealthCondition: { create: async ({ data }) => { mockStore.created.push(['condition', data.userId]); }, deleteMany: async () => ({ count: 0 }) },
    userActivityRestriction: { create: async ({ data }) => { mockStore.created.push(['restriction', data.userId]); }, deleteMany: async () => ({ count: 0 }) },
    userSurgery: { create: async ({ data }) => { mockStore.created.push(['surgery', data.userId]); }, deleteMany: async () => ({ count: 0 }) },
    userInjury: { deleteMany: async () => ({ count: 0 }) },
    userSymptomReport: { deleteMany: async () => ({ count: 0 }) },
    userActivityProfile: { upsert: async () => ({}), updateMany: async () => ({ count: 0 }) },
    $transaction: async (ops) => Promise.all(ops),
  }),
}));
jest.mock('../src/services/auditService', () => ({ log: async () => ({}) }));

const loadApp = () => {
  const router = require('../src/routes/safetyFixtures');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = req.headers['x-user-id'] || null; next(); });
  app.use('/test-fixtures/safety-state', router);
  return app;
};
const app = loadApp();
const as = (id) => (id ? { 'x-user-id': id } : {});

beforeEach(() => { mockStore.email = 'qa@staging.test'; mockStore.privileged = true; mockStore.created = []; });

describe('boot and flag guards', () => {
  it('throws at require time under production env', () => {
    jest.isolateModules(() => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
      expect(() => require('../src/routes/safetyFixtures')).toThrow(/never load in production/);
      delete process.env.RAILWAY_ENVIRONMENT_NAME;
    });
  });
  it('throws under NODE_ENV=production when Railway env is absent', () => {
    jest.isolateModules(() => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      expect(() => require('../src/routes/safetyFixtures')).toThrow(/never load in production/);
      process.env.NODE_ENV = prev;
    });
  });
});

describe('authorization', () => {
  it('denies non-synthetic users', async () => {
    mockStore.email = 'real.user@gmail.com';
    const res = await request(app).post('/test-fixtures/safety-state').set(as('u1')).send({ conditions: ['x'] });
    expect(res.status).toBe(403); expect(res.body.error).toBe('synthetic_users_only');
  });
  it('denies synthetic users WITHOUT fixture privilege — domain alone is not enough', async () => {
    mockStore.privileged = false;
    const res = await request(app).post('/test-fixtures/safety-state').set(as('u1')).send({ conditions: ['x'] });
    expect(res.status).toBe(403); expect(res.body.error).toBe('fixture_privilege_required');
  });
  it('allows synthetic + privileged callers', async () => {
    const res = await request(app).post('/test-fixtures/safety-state').set(as('syn-1')).send({ conditions: ['celiac'] });
    expect(res.status).toBe(200); expect(res.body.applied.conditions).toBe(1);
    expect(mockStore.created).toEqual([['condition', 'syn-1']]);
  });
});

describe('input validation and isolation', () => {
  it.each([
    [{ conditions: 'not-an-array' }], [{ conditions: Array(26).fill('x') }],
    [{ restrictions: Array(30).fill({}) }], [{ surgeries: 'bad' }],
    [{ conditions: [123] }], [{ conditions: ['x'.repeat(200)] }],
  ])('rejects malformed payload %j with 400', async (payload) => {
    const res = await request(app).post('/test-fixtures/safety-state').set(as('u1')).send(payload);
    expect(res.status).toBe(400);
    expect(mockStore.created).toHaveLength(0);
  });
  it('cannot target another user — writes bind to the caller id only', async () => {
    const res = await request(app).post('/test-fixtures/safety-state').set(as('syn-1')).send({ userId: 'victim', conditions: ['gout'] });
    expect(res.status).toBe(200);
    expect(mockStore.created).toEqual([['condition', 'syn-1']]);
  });
});

describe('rate limiting', () => {
  it('429s after 30 writes per minute per caller', async () => {
    for (let i = 0; i < 30; i++) {
      const r = await request(app).post('/test-fixtures/safety-state').set(as('rl-user')).send({});
      expect(r.status).toBe(200);
    }
    const over = await request(app).post('/test-fixtures/safety-state').set(as('rl-user')).send({});
    expect(over.status).toBe(429);
    // A different caller is unaffected.
    const other = await request(app).post('/test-fixtures/safety-state').set(as('rl-other')).send({});
    expect(other.status).toBe(200);
  });
});
