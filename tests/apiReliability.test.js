const request = require('supertest');

const mockPrisma = {
  macroGoal: { findUnique: jest.fn(), upsert: jest.fn(), create: jest.fn() },
  waterLog: { findMany: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
const app = require('../src/app');
const { routeLabel, failureCategory } = require('../src/middleware/requestContext');
const { versionInfo } = require('../src/config/version');

beforeEach(() => { jest.clearAllMocks(); mockPrisma.waterLog.findMany.mockResolvedValue([]); });

describe('GET /health/version', () => {
  it('is public and exposes only build identity', async () => {
    const res = await request(app).get('/health/version');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['builtAt', 'commit', 'contract', 'environment', 'minClientContract', 'service', 'startedAt', 'version']);
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('accepts only a hex commit and trims it', () => {
    expect(versionInfo({ RAILWAY_GIT_COMMIT_SHA: 'fa8c6e0aabbccddeeff00112233445566778899a' }).commit).toBe('fa8c6e0aabbc');
    expect(versionInfo({ RAILWAY_GIT_COMMIT_SHA: 'postgres://secret' }).commit).toBeNull();
    expect(versionInfo({ NODE_ENV: 'production' }).environment).toBe('production');
  });
});

describe('correlation ids', () => {
  it('echoes a valid client id and the API contract', async () => {
    const res = await request(app).get('/health').set('x-correlation-id', 'mobile-abc12345');
    expect(res.headers['x-correlation-id']).toBe('mobile-abc12345');
    expect(res.headers['x-api-contract']).toBe(String(versionInfo().contract));
  });
  it('replaces an unsafe client id', async () => {
    const res = await request(app).get('/health').set('x-correlation-id', 'bad id; drop');
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('labels routes without identifiers and categorizes failures', () => {
    expect(routeLabel({ originalUrl: '/food-logs/3f2b8c1e-1111-4222-8333-444455556666?date=2026-11-02' })).toBe('/food-logs/:id');
    expect([401, 403, 404, 409, 429, 500, 503, 400].map(failureCategory)).toEqual(['auth', 'forbidden', 'not_found', 'conflict', 'rate_limited', 'server', 'unavailable', 'validation']);
  });
  it('missing routes return a coded 404', async () => {
    const res = await request(app).get('/definitely-missing').set('x-user-id', 'u-1');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.correlationId).toBeTruthy();
  });
});

describe('macro goals', () => {
  it('initializes a missing goal row with an upsert so concurrent first loads cannot collide', async () => {
    mockPrisma.macroGoal.findUnique.mockResolvedValue(null);
    mockPrisma.macroGoal.upsert.mockResolvedValue({ userId: 'u-1', caloriesTarget: 2200, proteinTarget: 150, carbsTarget: 250, fatTarget: 70, fiberTarget: 30, waterMlTarget: 2000 });
    const [a, b] = await Promise.all([1, 2].map(() => request(app).get('/macro-score/goals').set('x-user-id', 'u-1')));
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(mockPrisma.macroGoal.create).not.toHaveBeenCalled();
    expect(mockPrisma.macroGoal.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u-1' }, update: {} }));
  });
  it('database failure is a coded 500 without internal details', async () => {
    mockPrisma.macroGoal.findUnique.mockRejectedValue(new Error('Too many database connections'));
    const res = await request(app).get('/macro-score/goals').set('x-user-id', 'u-1');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL');
    expect(res.body.error).not.toMatch(/database/i);
  });
  it('rejects invalid targets with 400 and does not write', async () => {
    const res = await request(app).put('/macro-score/goals').set('x-user-id', 'u-1').send({ caloriesTarget: 'abc' });
    expect(res.status).toBe(400);
    expect(mockPrisma.macroGoal.upsert).not.toHaveBeenCalled();
  });
});

describe('client contract compatibility', () => {
  const express = require('express');
  const request = require('supertest');
  const { requestContext } = require('../src/middleware/requestContext');
  const { MIN_CLIENT_CONTRACT, API_CONTRACT_VERSION } = require('../src/config/version');
  const app = express().use(requestContext()).get('/x', (_req, res) => res.json({ ok: true }));
  it('advertises server and minimum client contracts', async () => {
    const res = await request(app).get('/x');
    expect(res.headers['x-api-contract']).toBe(String(API_CONTRACT_VERSION));
    expect(res.headers['x-min-client-contract']).toBe(String(MIN_CLIENT_CONTRACT));
  });
  it('keeps pre-versioning clients (no header) working', async () => {
    expect((await request(app).get('/x')).status).toBe(200);
  });
  it('rejects clients below the minimum with a coded 426', async () => {
    const res = await request(app).get('/x').set('x-client-contract', String(MIN_CLIENT_CONTRACT - 1));
    expect(res.status).toBe(426);
    expect(res.body.code).toBe('CLIENT_UPGRADE_REQUIRED');
    expect(res.body.correlationId).toBe(res.headers['x-correlation-id']);
  });
});

describe('coded error bodies from direct route responses', () => {
  const express = require('express');
  const request = require('supertest');
  const { requestContext } = require('../src/middleware/requestContext');
  const app = express().use(requestContext())
    .get('/bad', (_req, res) => res.status(400).json({ error: 'steps required' }))
    .get('/own', (_req, res) => res.status(409).json({ error: 'x', code: 'MEAL_ID_CONFLICT' }))
    .get('/ok', (_req, res) => res.json({ ok: true }));
  it('adds a default code and correlation id', async () => {
    const res = await request(app).get('/bad');
    expect(res.body).toEqual({ error: 'steps required', code: 'INVALID_REQUEST', correlationId: res.headers['x-correlation-id'] });
  });
  it('keeps an explicit code and leaves success bodies untouched', async () => {
    expect((await request(app).get('/own')).body.code).toBe('MEAL_ID_CONFLICT');
    expect((await request(app).get('/ok')).body).toEqual({ ok: true });
  });
});
