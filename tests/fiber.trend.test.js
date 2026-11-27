// /fiber/trend — bounded query count and per-day grouping semantics.
// The endpoint previously ran one foodLog.findMany per requested day (up to
// 30); it must now issue a single bounded-range query while producing
// identical per-day confirmed/unknown/meals rows.
const request = require('supertest');
const express = require('express');

const mockFlags = {};
jest.mock('../src/services/featureFlags/service', () => ({
  isEnabled: async (key) => Boolean(mockFlags[key]),
}));

const mockStore = { user: null, macroGoal: null, conditions: [], foodLogs: [] };
const mockFoodLogFindMany = jest.fn(async ({ where }) => mockStore.foodLogs.filter((l) =>
  l.userId === where.userId && l.loggedAt >= where.loggedAt.gte && l.loggedAt < where.loggedAt.lt));
jest.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    user: { findUnique: async () => mockStore.user },
    macroGoal: { findUnique: async () => mockStore.macroGoal },
    userHealthCondition: { findMany: async () => mockStore.conditions },
    foodLog: { findMany: mockFoodLogFindMany },
  }),
}));

const fiberRouter = require('../src/routes/fiber');
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.userId = req.headers['x-user-id'] || null; next(); });
app.use('/fiber', fiberRouter);
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

const FLAGS = { fiber_intelligence_enabled: true, fiber_daily_goal_enabled: true };
const log = (loggedAt, fiberG, extra = {}) => ({ id: `l${Math.random()}`, userId: 'user-a', fiberG, loggedAt: new Date(loggedAt), ...extra });

beforeEach(() => {
  Object.keys(mockFlags).forEach((k) => delete mockFlags[k]);
  Object.assign(mockFlags, FLAGS);
  mockFoodLogFindMany.mockClear();
  mockStore.user = { id: 'user-a', dateOfBirth: new Date('1990-01-01'), gender: 'female', timeZone: 'UTC' };
  mockStore.macroGoal = { caloriesTarget: 2000, fiberTarget: 30 };
  mockStore.conditions = [];
  mockStore.foodLogs = [];
});

it('issues exactly one foodLog query regardless of window size', async () => {
  for (const days of [7, 30]) {
    mockFoodLogFindMany.mockClear();
    const res = await request(app).get(`/fiber/trend?days=${days}`).set('x-user-id', 'user-a');
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(days);
    expect(mockFoodLogFindMany).toHaveBeenCalledTimes(1);
    const range = mockFoodLogFindMany.mock.calls[0][0].where.loggedAt;
    expect((range.lt - range.gte) / 86400000).toBeGreaterThanOrEqual(days);
  }
});

it('groups logs into their local day with confirmed/unknown semantics preserved', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  mockStore.foodLogs = [
    log(`${yesterday}T09:00:00Z`, 5), log(`${yesterday}T13:00:00Z`, 7),
    log(`${yesterday}T19:00:00Z`, 4, { nutritionSnapshot: { nutrientUnknowns: ['fiberG'] } }),
    log(`${today}T08:00:00Z`, 10),
  ];
  const res = await request(app).get('/fiber/trend?days=2').set('x-user-id', 'user-a');
  expect(res.status).toBe(200);
  expect(res.body.days).toEqual([
    { date: yesterday, confirmedG: 12, estimatedG: 0, targetG: 28, unknownMeals: 1, mealsLogged: 3 },
    { date: today, confirmedG: 10, estimatedG: 0, targetG: 28, unknownMeals: 0, mealsLogged: 1 },
  ]);
});

it('estimated fiber surfaces as its own class — an all-estimated day is never indistinguishable from a zero-fiber day', async () => {
  const today = new Date().toISOString().slice(0, 10);
  mockStore.foodLogs = [
        log(`${today}T09:00:00Z`, 6, { nutritionSnapshot: { loggedSource: 'ai-estimate' } }), // estimate-provenance per ESTIMATED_SOURCE_RE
    log(`${today}T13:00:00Z`, 8), // confirmed
  ];
  const res = await request(app).get('/fiber/trend?days=1').set('x-user-id', 'user-a');
  const day = res.body.days[0];
  expect(day.estimatedG).toBe(6); // estimated class reported separately
  expect(day.confirmedG).toBe(8); // confirmed unaffected
  // consistency with the canonical engine: both classes are visible, neither masks the other
  expect(day.confirmedG + day.estimatedG).toBe(14);
});

it('does not count a log toward a day boundary it does not belong to', async () => {
  // 05:00 UTC falls on a different local date in Pacific (UTC-8). The same
  // instant must bucket to that local date, deterministic regardless of now.
  const today = new Date().toISOString().slice(0, 10);
  mockStore.user.timeZone = null;
  mockStore.foodLogs = [log(`${today}T05:00:00Z`, 6)];
  const utc = await request(app).get('/fiber/trend?days=3&tz=UTC').set('x-user-id', 'user-a');
  const pacific = await request(app).get('/fiber/trend?days=3&tz=America/Los_Angeles').set('x-user-id', 'user-a');
  const utcDay = utc.body.days.find((d) => d.confirmedG === 6)?.date;
  const pacDay = pacific.body.days.find((d) => d.confirmedG === 6)?.date;
  const expectedPacific = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  expect(utcDay).toBe(today);
  expect(pacDay).toBe(expectedPacific);
});
