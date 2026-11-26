// HUM-49 Workstream C baseline: POST /foodLogs with volumeMl for a beverage
// whose nutrition is natively per-100-mL (no density). Records ACTUAL route
// behavior + write count vs REQUIRED behavior (138.6 kcal, mass unknown).
const request = require('supertest');
const express = require('express');

const mockBev = () => ({
  id: 'i-bev', name: 'Orange juice (per-100ml declared)', source: 'usda', densityGPerMl: null,
  caloriesPer100g: 42, proteinPer100g: 0.7, carbsPer100g: 10, fatPer100g: 0.2, fiberPer100g: 0.2,
  catalog: null, servings: [{ id: 'sv-330', label: '1 can (330 ml)', grams: 0, ml: 330, estimated: false, sourceRecord: {} }],
});
const mockBevD = () => ({ ...mockBev(), id: 'i-bev-d', densityGPerMl: 1.04 });

const creates = [];
jest.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    ingredient: { findUnique: async ({ where }) => (where.id === 'i-bev' ? mockBev() : where.id === 'i-bev-d' ? mockBevD() : null) },
    foodLog: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }) => { creates.push(data); return { id: data.id, ...data }; },
    },
  }),
}));
jest.mock('../src/services/nutrients/foodIntelligence', () => ({
  safe: async () => null,
  ingredient: async () => null,
}), { virtual: false });

const router = require('../src/routes/foodLogs');
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.userId = 'user-a'; req.headers['x-user-id'] = 'user-a'; next(); });
app.use('/foodLogs', router);
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

beforeEach(() => { creates.length = 0; });
const post = (body) => request(app).post('/foodLogs').send({
  id: 'log-' + Math.random().toString(36).slice(2, 12), mealType: 'breakfast', loggedAt: new Date().toISOString(), ...body,
});

describe('POST /foodLogs volume baseline (Workstream C evidence)', () => {
  it('ACTUAL: per-100-mL beverage without density — request rejected, ZERO writes, 138.6 kcal never recorded', async () => {
    const res = await post({ ingredientId: 'i-bev', foodName: 'Orange juice', volumeMl: 330, calories: 138.6, proteinG: 2.3, carbsG: 33, fatG: 0.7, fiberG: 0.7 });
    // REQUIRED per spec C2: 201 with calories=138.6, quantityG legitimately unknown.
    // ACTUAL behavior recorded here as baseline:
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/volume_requires_density/);
    expect(creates.length).toBe(0); // no write occurs — the beverage is unloggable with nutrition
  });

  it('CONTROL: same beverage with valid density — write occurs, converted mass + nutrition persisted', async () => {
    const res = await post({ ingredientId: 'i-bev-d', foodName: 'Orange juice', volumeMl: 330, calories: 144, proteinG: 2.4, carbsG: 34.3, fatG: 0.7, fiberG: 0.7 });
    expect(res.status).toBeLessThan(300);
    expect(creates.length).toBe(1);
    expect(creates[0].quantityG).toBeCloseTo(343.2, 0); // 330 × 1.04 — mass CONVERTED, documented in snapshot
    expect(creates[0].nutritionSnapshot.volumeMl).toBe(330);
    expect(creates[0].nutritionSnapshot.densityGPerMl).toBe(1.04);
  });

  it('schema constraint evidence: write path seeds quantityG=0 placeholder before resolution (mass is non-nullable)', async () => {
    // The route source seeds data.quantityG = 0 when volumeMl is supplied
    // (foodLogs.js:51) because FoodLog.quantityG is required non-null — a
    // volume-only log cannot exist without SOME mass value. Overwritten on
    // successful conversion; the write never happens at all on refusal.
    const src = require('fs').readFileSync(require('path').join(__dirname, '../src/routes/foodLogs.js'), 'utf8');
    expect(src).toMatch(/k==='quantityG'\s*&&\s*b\[k\]==null\s*&&\s*b\.volumeMl!=null/);
    const schema = require('fs').readFileSync(require('path').join(__dirname, '../prisma/schema.prisma'), 'utf8');
    const foodLogBlock = schema.slice(schema.indexOf('model FoodLog'));
    expect(foodLogBlock.slice(0, 2000)).toMatch(/quantityG\s+Float[^?]/); // non-nullable — no quantityG?
  });
});
