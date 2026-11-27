// pc-HUM-91 key acceptance: "rice yesterday" persists with yesterday's date.
const express = require('express');
const request = require('supertest');
const { getPrisma } = require('../src/lib/prisma');
jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn(), aiEnabled: () => true }));

const prisma = getPrisma();
const app = express();
app.use(express.json());
app.use('/voice', require('../src/routes/voice'));
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

const U = 'voice-date-u';
const H = { 'x-user-id': U };
const RICE = 'humai-test-rice-date-ing';

beforeAll(async () => {
  const { envOverrideName } = require('../src/config/featureRegistry');
  ['voice_food_logging', 'manual_food_logging'].forEach(k => { process.env[envOverrideName(k)] = 'true'; });
  require('../src/services/featureFlags/service').resetCache();
  await prisma.user.upsert({ where: { id: U }, update: {}, create: { id: U, email: `${U}@device.local` } });
  await prisma.foodLog.deleteMany({ where: { userId: U } });
  await prisma.ingredient.upsert({
    where: { id: RICE }, update: {},
    create: { id: RICE, normalizedName: 'humai test date rice', name: 'Humai Test Date Rice', caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3, source: 'test' },
  });
});

afterAll(async () => {
  await prisma.foodLog.deleteMany({ where: { userId: U } }).catch(() => {});
  await prisma.ingredientServing.deleteMany({ where: { ingredientId: RICE } }).catch(() => {});
  await prisma.ingredient.deleteMany({ where: { id: RICE } }).catch(() => {});
  await prisma.$disconnect();
});

const execute = (entities) => request(app).post('/voice/commands/execute').set(H).send({
  commandId: `date-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  transcript: 'test',
  actions: [{ intent: 'LOG_FOOD', entities, missing: [], segment: 'x', status: 'ready' }],
});
const baseItems = [{ name: 'Humai Test Date Rice', grams: 150, quantity: null, unit: null }];

describe('relative-day voice logging — key acceptance', () => {
  it('"rice yesterday" persists with loggedAt on yesterday, verified math intact', async () => {
    const res = await execute({ items: baseItems, mealType: 'dinner', dateHint: 'yesterday' });
    expect(res.status).toBeLessThan(300);
    expect((res.body.result || []).find((r) => r.intent === 'LOG_FOOD').status).toBe('saved');
    const log = await prisma.foodLog.findFirst({ where: { userId: U }, orderBy: { loggedAt: 'desc' } });
    expect(log).toBeTruthy();
    const dayMs = 24 * 60 * 60 * 1000;
    expect(Date.now() - log.loggedAt.getTime()).toBeGreaterThan(dayMs - 60000); // yesterday, not today
    expect(Date.now() - log.loggedAt.getTime()).toBeLessThan(dayMs + 60000);
    expect(log.calories).toBeCloseTo(195, 0); // 150 g × 130/100 — verified math unaltered
  });

  it('no dateHint falls back to now — log never fails over a missing hint', async () => {
    const res = await execute({ items: baseItems, mealType: 'lunch', dateHint: null });
    expect((res.body.result || []).find((r) => r.intent === 'LOG_FOOD').status).toBe('saved');
    const log = await prisma.foodLog.findFirst({ where: { userId: U, mealType: 'lunch' }, orderBy: { loggedAt: 'desc' } });
    expect(Date.now() - log.loggedAt.getTime()).toBeLessThan(60000); // today
  });

  it('arbitrary injected date strings are never trusted — fall back to now', async () => {
    const res = await execute({ items: baseItems, mealType: 'snack', dateHint: '2020-01-01; DROP TABLE' });
    expect((res.body.result || []).find((r) => r.intent === 'LOG_FOOD').status).toBe('saved');
    const log = await prisma.foodLog.findFirst({ where: { userId: U, mealType: 'snack' }, orderBy: { loggedAt: 'desc' } });
    expect(Date.now() - log.loggedAt.getTime()).toBeLessThan(60000); // injection ignored, logged now
  });
});
