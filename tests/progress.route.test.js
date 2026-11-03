const express = require('express');
const request = require('supertest');
jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const app = express();
app.use((req, _res, next) => { if (req.headers.authorization === 'test-alice') req.userId = 'alice'; next(); });
app.use('/me/progress', require('../src/routes/progress'));
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
let db;
beforeEach(() => {
  db = Object.fromEntries(
    ['foodLog', 'weightEntry', 'waterLog', 'dailySteps', 'workoutSession', 'healthEnergyRecord']
      .map(name => [name, { findMany: jest.fn(async () => []) }]));
  db.user = { findUnique: jest.fn(async () => null) };
  getPrisma.mockReturnValue(db);
});
it('requires authenticated identity and scopes every query to it, ignoring supplied user IDs', async () => {
  const path = '/me/progress?from=2026-10-01&to=2026-10-07&userId=bob';
  // No identity at all → 401.
  expect((await request(app).get(path)).status).toBe(401);
  // A real session scopes every query — the spoofed ?userId param is ignored.
  const res = await request(app).get(path).set('authorization', 'test-alice').set('x-user-id', 'bob');
  expect(res.status).toBe(200); expect(res.body.entries).toHaveLength(7);
  for (const t of ['foodLog', 'weightEntry', 'waterLog', 'dailySteps', 'workoutSession', 'healthEnergyRecord'])
    expect(db[t].findMany.mock.calls[0][0].where.userId).toBe('alice');
  expect(res.body.entries[0].weightKg).toBeNull();
  // Session wins over the spoofed x-user-id header.
  expect(db.user.findUnique.mock.calls[0][0].where.id).toBe('alice');
});
it('rejects oversized windows before querying health records', async () => {
  expect((await request(app).get('/me/progress?from=2025-01-01&to=2026-01-01').set('authorization', 'test-alice')).status).toBe(400);
  expect(db.foodLog.findMany).not.toHaveBeenCalled();
});
