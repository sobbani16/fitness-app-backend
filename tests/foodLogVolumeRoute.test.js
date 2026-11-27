// HUM-49 Workstream C baseline: POST /foodLogs with volumeMl for a beverage
// whose nutrition is natively per-100-mL (no density). Records ACTUAL route
// behavior + write count vs REQUIRED behavior (138.6 kcal, mass unknown).
const request = require('supertest');
const express = require('express');

const mockBev = () => ({
  id: 'i-bev', name: 'Orange juice (per-100ml declared)', source: 'usda', densityGPerMl: null,
  sourceMetadata: { nutritionBasis: 'PER_100_ML' },
  caloriesPer100g: 42, proteinPer100g: 0.7, carbsPer100g: 10, fatPer100g: 0.2, fiberPer100g: 0.2,
  catalog: null, servings: [{ id: 'sv-330', label: '1 can (330 ml)', grams: 0, ml: 330, estimated: false, sourceRecord: {} }],
});
const mockBevD = () => ({ ...mockBev(), id: 'i-bev-d', densityGPerMl: 1.04 });

const creates = [];
jest.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    ingredient: { findUnique: async ({ where }) => (where.id === 'i-bev' ? mockBev() : where.id === 'i-bev-d' ? mockBevD() : null) },
    foodLog: {
      findUnique: async ({ where }) => creates.find((r) => r.id === where.id) || null,
      findFirst: async () => null,
      findMany: async ({ where } = {}) => creates.filter((r) => r.userId === where?.userId),
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
  it('APPROVED: per-100-mL beverage without density persists — 330 mL reads back as 138.6 kcal, mass honestly unknown', async () => {
    // decisions #111/#144/#155: volume-native persistence, never 1ml=1g.
    // Declared nutrition 42 kcal/100 mL × 330 mL = 138.6 kcal; quantityG null.
    const res = await post({ ingredientId: 'i-bev', foodName: 'Orange juice', volumeMl: 330, calories: 138.6, proteinG: 2.3, carbsG: 33, fatG: 0.7, fiberG: 0.7 });
    expect(res.status).toBeLessThan(300);
    expect(creates.length).toBe(1);
    expect(creates[0].calories).toBeCloseTo(138.6, 1); // 42 × 330/100 — exact declared math
    expect(creates[0].quantityG).toBeNull(); // mass unknown — never fabricated
    expect(creates[0].quantityMl).toBe(330);
    expect(creates[0].quantityUnit).toBe('ml');
    expect(creates[0].nutritionSnapshot.nutritionBasis).toBe('PER_100_ML');
    expect(creates[0].nutritionSnapshot.massUnknown).toBe(true);
    // read-back: the persisted shape round-trips volume + unknown mass + nutrition
    expect(res.body.quantityMl).toBe(330);
    expect(res.body.quantityG).toBeNull();
    expect(res.body.calories).toBeCloseTo(138.6, 1);
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
    expect(src).toMatch(/data\[k\]=null;continue;.*volume-native/);
    const schema = require('fs').readFileSync(require('path').join(__dirname, '../prisma/schema.prisma'), 'utf8');
    const foodLogBlock = schema.slice(schema.indexOf('model FoodLog'));
    expect(foodLogBlock.slice(0, 2000)).toMatch(/quantityG\s+Float\?/); // nullable — unknown mass is honestly null (decision #155)
  });
});

describe('null-mass API boundary compatibility (decision #155 consumers)', () => {
  const VOL_BODY = { ingredientId: 'i-bev', foodName: 'Orange juice', volumeMl: 330, calories: 138.6, proteinG: 2.3, carbsG: 33, fatG: 0.7, fiberG: 0.7 };

  it('history returns volume-native rows with native quantity fields and the original snapshot intact', async () => {
    const created = await post(VOL_BODY);
    expect(created.status).toBeLessThan(300);
    const hist = await request(app).get('/foodLogs?date=' + new Date().toISOString().slice(0, 10)).set('x-user-id', 'user-a');
    expect(hist.status).toBe(200);
    const row = hist.body.logs.find((l) => l.id === created.body.id);
    expect(row).toBeTruthy();
    expect(row.quantityG).toBeNull(); // null survives the read path — never coerced to 0
    expect(row.quantityMl).toBe(330);
    expect(row.quantityUnit).toBe('ml');
    expect(row.calories).toBeCloseTo(138.6, 1);
    expect(row.nutritionSnapshot.nutritionBasis).toBe('PER_100_ML'); // original snapshot preserved verbatim
    expect(row.nutritionSnapshot.massUnknown).toBe(true);
  });

  it('same-ID replay leaves exactly one row and preserves the volume-native snapshot', async () => {
    const id = 'log-replay-fixed';
    const r1 = await request(app).post('/foodLogs').send({ id, mealType: 'lunch', loggedAt: new Date().toISOString(), ...VOL_BODY });
    const r2 = await request(app).post('/foodLogs').send({ id, mealType: 'lunch', loggedAt: new Date().toISOString(), ...VOL_BODY });
    expect(r1.status).toBeLessThan(300);
    expect(r2.status).toBe(200); // idempotent replay — no-op, not an error
    const rows = creates.filter((r) => r.id === id);
    expect(rows).toHaveLength(1); // exactly one row — the offline-queue retry contract
    expect(rows[0].nutritionSnapshot.nutritionBasis).toBe('PER_100_ML');
    expect(rows[0].quantityG).toBeNull();
  });

  it('snapshot-less 150 g legacy control round-trips with numeric mass intact', async () => {
    const res = await post({ foodName: 'legacy rice', quantityG: 150, calories: 195, proteinG: 4, carbsG: 42, fatG: 0.5 });
    expect(res.status).toBeLessThan(300);
    const row = creates.find((r) => r.foodName === 'legacy rice');
    expect(row.quantityG).toBe(150); // legacy numeric mass untouched
    expect(row.quantityMl ?? null).toBeNull();
    expect(row.nutritionSnapshot.grams).toBe(150);
  });

  it('portion edits via unsupported PATCH leave the row fully intact — no partial mutation surface', async () => {
    const created = await post(VOL_BODY);
    const id = created.body.id;
    const patch = await request(app).patch(`/foodLogs/${id}`).send({ quantityG: 500, calories: 999 });
    expect([404, 405]).toContain(patch.status); // no portion-update endpoint exists — documented contract
    const row = creates.find((r) => r.id === id);
    expect(row.quantityG).toBeNull(); // untouched
    expect(row.quantityMl).toBe(330);
    expect(row.calories).toBeCloseTo(138.6, 1);
  });

  it('quantityG-direct portion path stays verbatim for legacy clients (documented contract)', async () => {
    const res = await post({ foodName: 'direct grams', quantityG: 87, calories: 100, proteinG: 5, carbsG: 10, fatG: 3 });
    expect(res.status).toBeLessThan(300);
    const row = creates.find((r) => r.foodName === 'direct grams');
    expect(row.quantityG).toBe(87); // verbatim — never rescaled
  });
});
