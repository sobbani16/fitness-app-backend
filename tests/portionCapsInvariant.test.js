// HUM-34 §8 invariant: caps never silently rewrite input — out-of-range
// nutrition quantities, serving counts, and volumes are REJECTED with 400,
// never clamped/rewritten into a different value than the user entered.
const request = require('supertest');
const express = require('express');

const creates = [];
jest.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    ingredient: { findUnique: async () => null },
    foodLog: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }) => { creates.push(data); return { id: data.id, ...data }; },
    },
  }),
}));
jest.mock('../src/services/nutrients/foodIntelligence', () => ({ safe: async () => null, ingredient: async () => null, profilesForIngredient: async () => [] }));

const router = require('../src/routes/foodLogs');
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.userId = 'user-a'; req.headers['x-user-id'] = 'user-a'; next(); });
app.use('/foodLogs', router);
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

const base = { id: 'cap-test-1', foodName: 'Test food', mealType: 'lunch', quantityG: 100, calories: 200, proteinG: 10, carbsG: 20, fatG: 5 };
beforeEach(() => { creates.length = 0; });

describe('§8 caps invariant — rejection, never silent rewrite', () => {
  it.each([
    ['quantityG over cap', { quantityG: 100001 }],
    ['quantityG negative', { quantityG: -5 }],
    ['calories over cap', { calories: 100001 }],
    ['proteinG negative', { proteinG: -1 }],
    ['fiberG over cap', { fiberG: 200000 }],
    ['quantityG non-finite', { quantityG: NaN }],
  ])('%s → 400, zero writes, no clamping', async (_name, patch) => {
    const res = await request(app).post('/foodLogs').send({ ...base, ...patch });
    expect(res.status).toBe(400);
    expect(creates.length).toBe(0); // nothing written — input never silently rewritten
  });

  it('at-cap boundary values are accepted exactly as entered (100000 not rewritten to 99999)', async () => {
    const res = await request(app).post('/foodLogs').send({ ...base, id: 'cap-test-2', calories: 100000 });
    expect(res.status).toBeLessThan(300);
    expect(creates.length).toBe(1);
    expect(creates[0].calories).toBe(100000); // exact — not clamped
  });

  it('serving count over 1000 rejected by the resolver, not clamped', async () => {
    const { calculate } = require('../src/services/ingredientNutrition');
    const item = { id: 'i1', name: 'x', caloriesPer100g: 100, servings: [{ id: 'sv', label: '1 piece', grams: 50, ml: null, estimated: false }] };
    const db = { ingredient: { findUnique: async () => item } };
    await expect(calculate('i1', { servingId: 'sv', count: 1001 }, db)).rejects.toMatchObject({ status: 400 });
    await expect(calculate('i1', { servingId: 'sv', count: -2 }, db)).rejects.toMatchObject({ status: 400 });
  });

  it('volume over cap rejected, not clamped', async () => {
    const { quantity } = require('../src/services/nutrition');
    expect(() => quantity(100001)).toThrow(/Invalid quantity/);
    expect(() => quantity(-1)).toThrow(/Invalid quantity/);
  });
});
