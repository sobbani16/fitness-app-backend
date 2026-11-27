// HUM-42 §4: behavioral error-matrix verification for PATCH /activity-safety/injuries/:id.
// Structural mount coverage exists elsewhere — this probes live behavior per matrix row.
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
  userSymptomReport: { findMany: jest.fn(async () => []), create: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
  userHealthCondition: { findMany: jest.fn(async () => []) },
  activitySafetyRule: { findMany: jest.fn(async () => []) },
  activitySafetyEvaluation: { create: jest.fn() },
  activitySafetyFeedback: { create: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../src/services/environmentService', () => ({
  fetchEnvironment: jest.fn(async () => { throw new Error('offline'); }),
  markStale: obs => obs,
}));

const app = require('../src/app');
const setFlag = (k, v) => { process.env[envOverrideName(k)] = v; flags.resetCache(); };
const AUTH = { 'x-user-id': 'user-a' };

beforeEach(() => {
  jest.clearAllMocks();
  ['activity_safety_engine', 'health_aware_recommendations'].forEach(k => setFlag(k, 'true'));
  mockPrisma.userInjury.findFirst.mockImplementation(async () => ({ source: 'self_reported' }));
  mockPrisma.userInjury.updateMany.mockImplementation(async () => ({ count: 1 }));
});

const patch = (id, body, headers = AUTH) => request(app).patch(`/activity-safety/injuries/${id}`).set(headers).send(body);

describe('§4 error matrix — PATCH /injuries/:id', () => {
  it('400 unsupported_fields — silently-discarded writes are rejected loudly', async () => {
    const res = await patch('inj-1', { clinicianNotes: 'forge' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_fields');
    expect(mockPrisma.userInjury.updateMany).not.toHaveBeenCalled();
  });
  it('400 invalid_field — painLevel outside 0-10', async () => {
    const res = await patch('inj-1', { painLevel: 11 });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('painLevel');
  });
  it('400 invalid_field — bad status enum', async () => {
    const res = await patch('inj-1', { status: 'cured' });
    expect(res.status).toBe(400);
  });
  it('400 no_editable_fields — empty mutation rejected', async () => {
    const res = await patch('inj-1', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_editable_fields');
  });
  it('401 — unauthenticated requests never reach the handler', async () => {
    // With the test bypass on, auth is skipped entirely — probe the REAL
    // middleware path by disabling it: no bearer token must 401 before any
    // handler or prisma write executes.
    const prev = process.env.AUTH_TEST_BYPASS;
    process.env.AUTH_TEST_BYPASS = 'false';
    try {
      const res = await patch('inj-1', { painLevel: 3 }, {});
      expect(res.status).toBe(401);
      expect(mockPrisma.userInjury.updateMany).not.toHaveBeenCalled();
    } finally { process.env.AUTH_TEST_BYPASS = prev; }
  });
  it('404 — unknown or cross-user injury id', async () => {
    mockPrisma.userInjury.findFirst.mockImplementation(async () => null);
    const res = await patch('inj-x', { painLevel: 3 });
    expect(res.status).toBe(404);
  });
  it('409 clinician_fields_locked — locked restriction fields refuse self-report edits', async () => {
    mockPrisma.userInjury.findFirst.mockImplementation(async () => ({ source: 'clinician_documented' }));
    const res = await patch('inj-1', { prohibitedCategories: ['weight_bearing_lower'], version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('clinician_fields_locked');
    expect(mockPrisma.userInjury.updateMany).not.toHaveBeenCalled();
  });
  it('409 — stale version write rejected, no update applied', async () => {
    mockPrisma.userInjury.updateMany.mockImplementation(async () => ({ count: 0 }));
    const res = await patch('inj-1', { painLevel: 3, version: 1 });
    expect(res.status).toBe(409);
  });
  it('500 — prisma failure surfaces as a server error, never a silent success', async () => {
    mockPrisma.userInjury.updateMany.mockImplementation(async () => { throw new Error('db down'); });
    const res = await patch('inj-1', { painLevel: 3 });
    expect(res.status).toBe(500);
  });
  it('429 — write limiter behaviorally fires after the configured cap', async () => {
    // Probe the exported limiter unit in isolation: mounting the full app in
    // production mode would 401 at auth before ever reaching the limiter.
    // The skip closure reads NODE_ENV per-request, so production re-enables.
    const express2 = require('express');
    const mini = express2();
    mini.use(express2.json());
    const limiter = require('../src/routes/activitySafety').__safetyWriteLimiter;
    mini.patch('/x', limiter, (_req, res) => res.json({ ok: true }));
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      let last;
      for (let i = 0; i < 31; i++) last = await request(mini).patch('/x').set('x-user-id', 'user-a').send({});
      expect(last.status).toBe(429);
    } finally { process.env.NODE_ENV = prevEnv; }
  }, 30000);
});
