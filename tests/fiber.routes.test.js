// Fiber API — flag gating, authorization scoping, and response contracts.
const request = require('supertest');
const express = require('express');

const mockFlags = {};
jest.mock('../src/services/featureFlags/service', () => ({
  isEnabled: async (key) => Boolean(mockFlags[key]),
}));

const mockStore = { user: null, macroGoal: null, conditions: [], allergies: [], foodPrefs: [], foodLogs: [], suppLogs: [], checks: [] };
jest.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    user: { findUnique: async () => mockStore.user },
    macroGoal: { findUnique: async () => mockStore.macroGoal, upsert: async ({ create }) => create },
    userHealthCondition: { findMany: async () => mockStore.conditions },
    userAllergy: { findMany: async () => mockStore.allergies },
    foodPreference: { findMany: async () => mockStore.foodPrefs },
    foodLog: { findMany: async () => { mockStore.foodLogFindManyCalls = (mockStore.foodLogFindManyCalls || 0) + 1; return mockStore.foodLogs; }, findFirst: async ({ where }) => mockStore.foodLogs.find((l) => l.id === where.id && l.userId === where.userId) || null },
    userRole: { findFirst: async ({ where }) => (mockStore.roles || []).some((r) => where.role.name.in.includes(r)) ? { id: 'r1' } : null },
    supplementLog: { findMany: async () => mockStore.suppLogs },
    weeklyNutritionPlan: { findFirst: async () => null },
    fiberDailyRecommendation: { upsert: async () => ({}) },
    supplement: { findUnique: async () => null, findFirst: async () => null },
    supplementProduct: { findUnique: async () => null },
    supplementInteractionRule: { findMany: async () => [] },
    fiberSupplementCheck: { create: async ({ data }) => ({ id: 'c1', ...data }), findFirst: async () => null, update: async () => ({}) },
    ingredient: { findFirst: async () => null, findMany: async () => [], findUnique: async () => null },
    ingredientCatalog: { findMany: async () => [] },
  }),
}));

const fiberRouter = require('../src/routes/fiber');

const USER = 'user-a';
const app = express();
app.use(express.json());
// Tests bypass auth: emulate the global authenticate contract — verified id only.
app.use((req, _res, next) => { req.userId = req.headers['x-user-id'] || null; next(); });
app.use('/fiber', fiberRouter);
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

const ALL_ON = { fiber_intelligence_enabled: true, fiber_daily_goal_enabled: true, fiber_meal_sequencing_enabled: true, fiber_supplement_suggestions_enabled: true };

beforeEach(() => {
  Object.keys(mockFlags).forEach((k) => delete mockFlags[k]);
  mockStore.user = { id: USER, dateOfBirth: new Date('1990-01-01'), gender: 'female', timeZone: 'UTC', goalType: null };
  mockStore.macroGoal = { caloriesTarget: 2000, fiberTarget: 30 };
  mockStore.conditions = []; mockStore.allergies = []; mockStore.foodPrefs = []; mockStore.foodLogs = []; mockStore.suppLogs = []; mockStore.roles = [];
});

describe('flag enforcement (all fiber flags default OFF)', () => {
  it.each([
    ['GET', '/fiber/daily'],
    ['GET', '/fiber/target'],
    ['PUT', '/fiber/target'],
    ['GET', '/fiber/trend'],
    ['POST', '/fiber/sequence'],
    ['POST', '/fiber/supplement-check'],
    ['GET', '/fiber/supplement-education'],
  ])('%s %s → 403 FEATURE_DISABLED when flags off', async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path).set('x-user-id', USER).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });
  it('parent flag on but sub-flag off still rejects', async () => {
    mockFlags.fiber_intelligence_enabled = true;
    const res = await request(app).get('/fiber/daily').set('x-user-id', USER);
    expect(res.status).toBe(403);
    const res2 = await request(app).post('/fiber/sequence').set('x-user-id', USER).send({ items: [{ name: 'rice', amountG: 200 }] });
    expect(res2.status).toBe(403);
  });
});

describe('authorization scoping', () => {
  beforeEach(() => Object.assign(mockFlags, ALL_ON));
  it('sequences only the caller’s own food logs', async () => {
    mockStore.foodLogs = [{ id: 'log-1', userId: 'other-user', nutritionSnapshot: { components: [{ foodName: 'rice' }] } }];
    const res = await request(app).post('/fiber/sequence').set('x-user-id', USER).send({ foodLogId: 'log-1' });
    expect(res.status).toBe(404);
  });
  it('rejects unknown users on /fiber/daily', async () => {
    mockStore.user = null;
    const res = await request(app).get('/fiber/daily').set('x-user-id', 'ghost');
    expect(res.status).toBe(404);
  });
});

describe('response contracts', () => {
  beforeEach(() => Object.assign(mockFlags, ALL_ON));
  it('GET /fiber/daily returns the five-way fiber taxonomy', async () => {
    mockStore.foodLogs = [
      { id: 'a', foodName: 'Dal', mealType: 'lunch', fiberG: 8, nutritionSnapshot: null, loggedAt: new Date() },
      { id: 'b', foodName: 'Unknown dish', mealType: 'dinner', fiberG: null, nutritionSnapshot: null, loggedAt: new Date() },
    ];
    const res = await request(app).get('/fiber/daily').set('x-user-id', USER);
    expect(res.status).toBe(200);
    expect(res.body.status).toMatchObject({ confirmedG: 8, unknownMeals: 1 });
    expect(res.body.status).toHaveProperty('estimatedG');
    expect(res.body.status).toHaveProperty('plannedG');
    expect(res.body.status).toHaveProperty('supplementG');
    expect(res.body.target.targetG).toBe(28); // 2000 kcal → 28 g
    expect(res.body.perLog.map((l) => l.state).sort()).toEqual(['confirmed', 'unknown']);
    expect(res.body).toHaveProperty('inputsHash');
    expect(res.body.safety.verdict).toBe('ok');
  });
  it('PUT /fiber/target stores override with provenance; clearing nulls basis', async () => {
    mockStore.roles = ['CLINICAL_REVIEWER'];
    const res = await request(app).put('/fiber/target').set('x-user-id', USER).send({ targetG: 22, note: 'GI doc', clinicianDirected: true });
    expect(res.status).toBe(200);
    expect(res.body.fiberTargetBasis).toBe('clinician');
    const res2 = await request(app).put('/fiber/target').set('x-user-id', USER).send({ targetG: null });
    expect(res2.status).toBe(200);
    expect(res2.body.fiberTargetBasis).toBeNull();
  });
  it('PUT /fiber/target downgrades clinician-directed provenance for members', async () => {
    mockStore.roles = ['MEMBER'];
    const res = await request(app).put('/fiber/target').set('x-user-id', USER).send({ targetG: 22, clinicianDirected: true });
    expect(res.status).toBe(200);
    expect(res.body.fiberTargetBasis).toBe('custom'); // members cannot attest clinician provenance
  });
  it('PUT /fiber/target rejects out-of-range values', async () => {
    const res = await request(app).put('/fiber/target').set('x-user-id', USER).send({ targetG: 500 });
    expect(res.status).toBe(400);
  });
  it('POST /fiber/sequence validates items and never forces mixed dishes', async () => {
    const bad = await request(app).post('/fiber/sequence').set('x-user-id', USER).send({ items: [{ name: '', amountG: 100 }] });
    expect(bad.status).toBe(400);
    const mixed = await request(app).post('/fiber/sequence').set('x-user-id', USER).send({ items: [{ name: 'chicken biryani', amountG: 350 }] });
    expect(mixed.status).toBe(200);
    expect(mixed.body.separable).toBe(false);
    const ok = await request(app).post('/fiber/sequence').set('x-user-id', USER).send({ items: [{ name: 'white rice, cooked', amountG: 200 }, { name: 'grilled chicken', amountG: 120 }, { name: 'broccoli cooked', amountG: 100 }] });
    expect(ok.status).toBe(200);
    expect(ok.body.order[0].role).toBe('non_starchy_veg');
    expect(ok.body.order.map((o) => o.role)).toContain('starch');
    expect(JSON.stringify(ok.body.disclaimers)).toMatch(/optional/i);
  });
  it('GET /fiber/trend returns per-day rows with honest unknowns', async () => {
    const res = await request(app).get('/fiber/trend?days=3').set('x-user-id', USER);
    expect(res.status).toBe(200);
    expect(res.body.days.length).toBe(3);
    expect(res.body.days[0]).toHaveProperty('targetG', 28);
    expect(res.body.days[0]).toHaveProperty('unknownMeals');
  });
  it('GET /fiber/trend issues ONE foodLog query for the whole window (HUM-P6-016)', async () => {
    const yesterday = new Date(Date.now() - 86400000);
    mockStore.foodLogs = [
      { id: 't1', foodName: 'Oats', mealType: 'breakfast', fiberG: 4, nutritionSnapshot: null, loggedAt: yesterday },
    ];
    mockStore.foodLogFindManyCalls = 0;
    const res = await request(app).get('/fiber/trend?days=7').set('x-user-id', USER);
    expect(res.status).toBe(200);
    expect(mockStore.foodLogFindManyCalls).toBe(1); // was: one sequential query per day
    expect(res.body.days).toHaveLength(7);
    const hit = res.body.days.find((d) => d.confirmedG === 4);
    expect(hit).toBeTruthy();
    expect(hit.mealsLogged).toBe(1);
  });
});
