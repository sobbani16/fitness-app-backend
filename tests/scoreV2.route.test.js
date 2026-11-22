jest.mock('../src/lib/prisma', () => {
  const db = {
    macroGoal: { findUnique: jest.fn(async () => null) },
    foodLog: { findMany: jest.fn(async () => []) },
    workoutSession: { findMany: jest.fn(async () => []) },
    sleepLog: { findMany: jest.fn(async () => []) },
    waterLog: { findMany: jest.fn(async () => []) },
    supplementDoseOccurrence: { count: jest.fn(async () => 0) },
    dailyScoreSnapshot: { upsert: jest.fn(async () => ({})) },
  };
  return { getPrisma: () => db };
});
jest.mock('../src/services/featureFlags/service', () => ({ isEnabled: jest.fn(async () => true) }));

const express = require('express');
const request = require('supertest');
const { getPrisma } = require('../src/lib/prisma');
const flags = require('../src/services/featureFlags/service');
const prisma = getPrisma();

const app = express();
app.use((req, _res, next) => { req.userId = req.headers['x-user-id'] || 'u1'; next(); });
app.use('/daily-progress', require('../src/routes/dailyProgress'));
app.use((err, _req, res, _next) => { console.error('ROUTE-ERR', err); res.status(err.status || 500).json({ error: err.message }); });

const NOW = new Date();
const FOOD_LOG = {
  calories: 700, proteinG: 60, carbsG: 80, fatG: 20, fiberG: 12,
  nutritionSnapshot: null,
  micronutrients: { addedSugarG: 10, saturatedFatG: 5, sodiumMg: 400, transFatG: 0 },
  loggedAt: NOW,
};
const GOAL = { caloriesTarget: 2000, proteinTarget: 100, carbsTarget: 250, fatTarget: 70, fiberTarget: 30, waterMlTarget: 2000, source: 'custom' };

beforeEach(() => { jest.clearAllMocks(); flags.isEnabled.mockResolvedValue(true); });

describe('GET /daily-progress/score-v2', () => {
  test('403 when health_score_v2 flag is off', async () => {
    flags.isEnabled.mockImplementation(async (key) => key !== 'health_score_v2');
    await request(app).get('/daily-progress/score-v2').set('x-user-id', 'u1').expect(403);
  });

  test('empty day: no crash; recorded-zero activity makes it partial_data', async () => {
    const res = await request(app).get('/daily-progress/score-v2').set('x-user-id', 'u1').expect(200);
    expect(res.body.score.state).toBe('partial_data'); // 0 workouts is recorded zero, not missing
    expect(res.body.score.composite).toBe(0);
    expect(res.body.targetSource).toBe('fda_dv_reference');
    expect(res.body.score.components.nutrition.parts.protein.state).toBe('no_data');
  });

  test('uses real WorkoutSession fields (workoutType/durationMinutes) — regression for crash', async () => {
    prisma.workoutSession.findMany.mockResolvedValueOnce([
      { workoutType: 'strength', durationMinutes: 45, startedAt: NOW },
      { workoutType: 'running', durationMinutes: 30, startedAt: NOW },
    ]);
    const res = await request(app).get('/daily-progress/score-v2').set('x-user-id', 'u1').expect(200);
    const activity = res.body.score.components.activity;
    expect(activity.parts.weeklyMovementMin?.state ?? activity.state).not.toBe('no_data');
    expect(activity.earned).toBeGreaterThan(0);
  });

  test('MacroGoal overrides FDA-DV references', async () => {
    prisma.macroGoal.findUnique.mockResolvedValueOnce(GOAL);
    prisma.foodLog.findMany.mockResolvedValueOnce([FOOD_LOG]);
    const res = await request(app).get('/daily-progress/score-v2').set('x-user-id', 'u1').expect(200);
    expect(res.body.targetSource).toBe('macro_goal:custom');
    // 60g protein vs 100g goal → 7.2/12 partial; vs DV 50 it would be capped "reliable".
    const protein = res.body.score.components.nutrition.parts.protein;
    expect(protein.points).toBeCloseTo(7.2, 1);
    expect(protein.state).toBe('partial_data');
    // energy band derived from caloriesTarget ±20% → 700 in [1600,2400]? No: 700 < 1600 → below range.
    const energy = res.body.score.components.nutrition.energy;
    expect(energy.state).toBe('partial_data');
    expect(energy.reason).toContain('Below range');
  });

  test('falls back to FDA-DV references without a MacroGoal', async () => {
    prisma.foodLog.findMany.mockResolvedValueOnce([FOOD_LOG]);
    const res = await request(app).get('/daily-progress/score-v2').set('x-user-id', 'u1').expect(200);
    const protein = res.body.score.components.nutrition.parts.protein;
    expect(protein.points).toBe(12); // 60g ≥ 50g DV → capped reliable
    expect(protein.state).toBe('reliable');
    // no MacroGoal → no energy band → energy stays no_data
    expect(res.body.score.components.nutrition.energy.state).toBe('no_data');
  });

  test('wires logged micronutrients into foodQuality; unknown stays no_data', async () => {
    prisma.foodLog.findMany.mockResolvedValueOnce([FOOD_LOG]);
    const res = await request(app).get('/daily-progress/score-v2').set('x-user-id', 'u1').expect(200);
    const fq = res.body.score.components.foodQuality;
    expect(fq.earned).toBeGreaterThan(0); // sugar/satfat/sodium within refs + trans 0 → no PHO flag
    expect(fq.parts.addedSugar.state).toBe('reliable');
  });

  test('positive trans-fat reading flags the PHO path and zeroes foodQuality', async () => {
    prisma.foodLog.findMany.mockResolvedValueOnce([{ ...FOOD_LOG, micronutrients: { ...FOOD_LOG.micronutrients, transFatG: 0.8 } }]);
    const res = await request(app).get('/daily-progress/score-v2').set('x-user-id', 'u1').expect(200);
    const fq = res.body.score.components.foodQuality;
    expect(fq.earned).toBe(0);
    expect(fq.reason).toContain('Partially hydrogenated');
  });

  test('missing micronutrients → foodQuality no_data, never zero', async () => {
    prisma.foodLog.findMany.mockResolvedValueOnce([{ ...FOOD_LOG, micronutrients: null }]);
    const res = await request(app).get('/daily-progress/score-v2').set('x-user-id', 'u1').expect(200);
    expect(res.body.score.components.foodQuality.earned).toBe(0);
    expect(res.body.score.components.foodQuality.parts.addedSugar.state).toBe('no_data');
  });
});
