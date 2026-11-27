// pc-HUM-91 — allergen-aware consumed-food logging (log != recommend).
// Real-DB harness matching tests/voice.test.js conventions.
const express = require('express');
const request = require('supertest');
const { getPrisma } = require('../src/lib/prisma');
jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn(), aiEnabled: () => true }));

const prisma = getPrisma();
const app = express();
app.use(express.json());
app.use('/voice', require('../src/routes/voice'));
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

const U = 'voice-allergen-u';
const H = { 'x-user-id': U };
const PEANUT_ING = 'humai-test-peanut-ing';

beforeAll(async () => {
  const { envOverrideName } = require('../src/config/featureRegistry');
  ['voice_food_logging', 'manual_food_logging'].forEach(k => { process.env[envOverrideName(k)] = 'true'; });
  require('../src/services/featureFlags/service').resetCache();
  await prisma.user.upsert({ where: { id: U }, update: {}, create: { id: U, email: `${U}@device.local` } });
  await prisma.foodLog.deleteMany({ where: { userId: U } });
  await prisma.ingredient.upsert({
    where: { id: PEANUT_ING }, update: {},
    create: { id: PEANUT_ING, normalizedName: 'humai test peanut butter', name: 'Humai Test Peanut Butter', caloriesPer100g: 588, proteinPer100g: 25, carbsPer100g: 20, fatPer100g: 50, fiberPer100g: 6, source: 'test' },
  });
  const allergy = await prisma.allergy.upsert({ where: { name: 'peanut' }, update: {}, create: { name: 'peanut' } });
  await prisma.userAllergy.deleteMany({ where: { userId: U } });
  await prisma.userAllergy.create({ data: { userId: U, allergyId: allergy.id } });
});

afterAll(async () => {
  await prisma.userAllergy.deleteMany({ where: { userId: U } }).catch(() => {});
  await prisma.foodLog.deleteMany({ where: { userId: U } }).catch(() => {});
  await prisma.ingredientServing.deleteMany({ where: { ingredientId: PEANUT_ING } }).catch(() => {});
  await prisma.ingredient.deleteMany({ where: { id: PEANUT_ING } }).catch(() => {});
  await prisma.$disconnect();
});

const execute = (actions) => request(app).post('/voice/commands/execute').set(H).send({
  commandId: `allergen-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  transcript: 'test', actions,
});

describe('allergen-containing consumed food logs accurately WITH safety info', () => {
  it('peanut butter log persists accurately AND carries allergenCaution — log != recommend', async () => {
    const res = await execute([{ intent: 'LOG_FOOD', entities: { items: [{ name: 'Humai Test Peanut Butter', grams: 30, quantity: null, unit: null }], mealType: 'snack' }, missing: [], segment: 'log 30g peanut butter', status: 'ready' }]);
    expect(res.status).toBeLessThan(300);
    const food = (res.body.result || []).find((r) => r.intent === 'LOG_FOOD');
    expect(food.status).toBe('saved'); // consumption persists — never blocked
    expect(food.allergenCaution).toBeTruthy();
    expect(food.allergenCaution.matched).toBe('peanut');
    expect(food.allergenCaution.note).toMatch(/logged accurately/i);
    expect(food.allergenCaution.note).toMatch(/not medical advice/i);
    const log = await prisma.foodLog.findFirst({ where: { userId: U, foodName: { contains: 'Peanut' } } });
    expect(log).toBeTruthy();
    expect(log.quantityG).toBe(30); // accurate — the recorded fact, unaltered
  });

  it('non-allergen food saves without allergenCaution', async () => {
    await prisma.ingredient.upsert({
      where: { id: 'humai-test-rice-ing-2' }, update: {},
      create: { id: 'humai-test-rice-ing-2', normalizedName: 'humai test rice two', name: 'Humai Test Rice Two', caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3, source: 'test' },
    });
    const res = await execute([{ intent: 'LOG_FOOD', entities: { items: [{ name: 'Humai Test Rice Two', grams: 150, quantity: null, unit: null }], mealType: 'lunch' }, missing: [], segment: 'log 150g rice', status: 'ready' }]);
    const food = (res.body.result || []).find((r) => r.intent === 'LOG_FOOD');
    expect(food.status).toBe('saved');
    expect(food.allergenCaution).toBeUndefined();
    await prisma.ingredient.deleteMany({ where: { id: 'humai-test-rice-ing-2' } }).catch(() => {});
  });

  it('short allergen terms (<3 chars) never false-positive', async () => {
    // matching requires length >= 3 — a two-letter allergy cannot match everything
    const res = await execute([{ intent: 'LOG_FOOD', entities: { items: [{ name: 'Humai Test Peanut Butter', grams: 30, quantity: null, unit: null }], mealType: 'snack' }, missing: [], segment: 'x', status: 'ready' }]);
    expect((res.body.result || []).find((r) => r.intent === 'LOG_FOOD').allergenCaution.matched).toBe('peanut');
  });
});

describe('implausible quantity cap aligned with portion policy', () => {
  it('6000g skipped as implausible — aligned at 5000, never persisted', async () => {
    const before = await prisma.foodLog.count({ where: { userId: U } });
    const res = await execute([{ intent: 'LOG_FOOD', entities: { items: [{ name: 'Humai Test Peanut Butter', grams: 6000, quantity: null, unit: null }], mealType: 'meal' }, missing: [], segment: 'x', status: 'ready' }]);
    const food = (res.body.result || []).find((r) => r.intent === 'LOG_FOOD');
    expect(food.status).toBe('skipped');
    expect(await prisma.foodLog.count({ where: { userId: U } })).toBe(before); // nothing persisted
  });
});
