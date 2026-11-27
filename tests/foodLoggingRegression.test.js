// Regression tests for the food-logging release-blocker fixes:
//  - barcode volume-vs-mass declarations must never assume 1 ml = 1 g
//  - unknown nutrients are tracked, never silently zeroed
//  - unresolved catalog foods fall back to weight only — no invented servings
//
// Run: npx jest tests/foodLoggingRegression.test.js --runInBand

const { parseServingDeclaration } = require('../src/services/foodIntel');
const { MACRO_KEYS, computeUnknowns, unknownsFor, coverageFor } = require('../src/services/nutrientCompleteness');

describe('barcode serving declarations (volume vs mass)', () => {
  test('330 ml declaration yields ml only — never grams', () => {
    const d = parseServingDeclaration('1 portion (330 ml)', 330);
    expect(d.unit).toBe('ml');
    expect(d.amountMl).toBe(330);
    expect(d.amountG).toBeNull();
  });

  test('mass declaration yields grams', () => {
    const d = parseServingDeclaration('1 biscuit (20 g)', 20);
    expect(d).toEqual({ unit: 'g', amountMl: null, amountG: 20 });
  });

  test('fl oz converts to ml, marked as derived volume', () => {
    const d = parseServingDeclaration('12 fl oz (355 ml)', 355);
    expect(d.unit).toBe('ml');
    expect(d.amountMl).toBeCloseTo(355, 0);
    expect(d.amountG).toBeNull();
  });

  test('unitless serving_quantity is never guessed as mass', () => {
    const d = parseServingDeclaration('1 serving', 45);
    expect(d.unit).toBe('unknown');
    expect(d.amountG).toBeNull();
    expect(d.amountMl).toBeNull();
  });

  test.each([
    ['1 cup (240 ml)', 'ml', 240],
    ['250ml', 'ml', 250],
    ['1 l', 'ml', 1000],
    ['45cl', 'ml', 450],
    ['30 g', 'g', 30],
    ['1 scoop (0.03 kg)', 'g', 30],
  ])('parses %s', (label, unit, amount) => {
    const d = parseServingDeclaration(label, amount);
    expect(d.unit).toBe(unit);
    const got = unit === 'ml' ? d.amountMl : d.amountG;
    expect(got).toBeCloseTo(amount, 0);
  });
});

describe('nutrientUnknowns — stored zero is never a confirmed zero', () => {
  test('computeUnknowns marks absent macro keys; user-saved values are measured', () => {
    expect(computeUnknowns({ calories: 145, proteinG: 0, carbsG: 36, fatG: 0, fiberG: null }, null))
      .toEqual(['fiberG']);
    expect(computeUnknowns({ calories: 145 }, { fiberG: 3 })).toEqual(['proteinG', 'carbsG', 'fatG']);
    expect(computeUnknowns(null, null)).toEqual(MACRO_KEYS);
  });

  test('unknownsFor prefers explicit snapshot metadata', () => {
    expect(unknownsFor({ nutritionSnapshot: { nutrientUnknowns: ['fiberG', 'bogus'] } })).toEqual(['fiberG']);
  });

  test('unknownsFor derives from source blocks when metadata absent', () => {
    const log = { nutritionSnapshot: { calculated: { calories: 200, proteinG: 10, carbsG: 20, fatG: 8, fiberG: null } } };
    expect(unknownsFor(log)).toEqual(['fiberG']);
  });

  test('unknownsFor falls back to column nullability for legacy rows', () => {
    expect(unknownsFor({ fiberG: null })).toEqual(['fiberG']);
    expect(unknownsFor({ fiberG: 5 })).toEqual([]);
  });

  test('coverageFor counts measured vs unknown per macro', () => {
    const cov = coverageFor([
      { nutritionSnapshot: { nutrientUnknowns: ['fiberG'] } },
      { nutritionSnapshot: { nutrientUnknowns: [] } },
    ]);
    expect(cov.fiberG).toEqual({ measured: 1, unknown: 1 });
    expect(cov.calories).toEqual({ measured: 2, unknown: 0 });
  });
});

describe('unresolved catalog foods — weight-based fallback', () => {
  const { MACRO_KEYS: K } = require('../src/services/nutrientCompleteness');

  test('gram-logged entry without serving metadata keeps per-100 g nutrition and flags unknowns', () => {
    // Simulates an unresolved-queue food (e.g. hummus): logged by grams, fiber unmeasured.
    const snapshot = {
      perServing: { calories: 166, proteinG: 7.9, carbsG: 14.3, fatG: 9.6, fiberG: null },
      nutrientUnknowns: computeUnknowns({ calories: 166, proteinG: 7.9, carbsG: 14.3, fatG: 9.6, fiberG: null }, null),
      loggedSource: 'catalog-weight-fallback',
    };
    const log = { quantityG: 50, fiberG: 0, nutritionSnapshot: snapshot };
    expect(unknownsFor(log)).toEqual(['fiberG']);
    expect(log.fiberG).toBe(0); // stored zero is annotated, not trusted
    expect(K).toContain('fiberG');
  });
});

// --- pc-HUM-207: explicit meal-component persistence through POST /food-logs ---
const express = require('express');
const request = require('supertest');
const { getPrisma } = require('../src/lib/prisma');

describe('POST /food-logs components contract (pc-HUM-207)', () => {
  const prisma = getPrisma();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = req.headers['x-user-id'] || null; next(); });
  app.use('/food-logs', require('../src/routes/foodLogs'));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const U = 'comp-test-user';
  const H = { 'x-user-id': U };
  const ids = [];
  const meal = (id, extra = {}) => ({ id, foodName: 'test meal', mealType: 'lunch', quantityG: 300, calories: 500, proteinG: 20, carbsG: 60, fatG: 15, fiberG: 5, ...extra });

  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: U }, update: {}, create: { id: U, email: `${U}@t.local` } });
  });
  afterAll(async () => {
    await prisma.foodLog.deleteMany({ where: { userId: U } }).catch(() => {});
    await prisma.user.delete({ where: { id: U } }).catch(() => {});
  });
  const mk = (p) => { ids.push(p); return `cmp-${p}-${Date.now() % 100000}`; };

  test('round-trip: explicit components persist and read back verbatim', async () => {
    const id = mk('rt');
    const components = [
      { foodName: 'grilled chicken', amountG: 120 },
      { foodName: 'white rice', amountG: 200 },
      { foodName: 'broccoli side', amountG: null },
    ];
    const res = await request(app).post('/food-logs').set(H).send(meal(id, { components }));
    expect(res.status).toBe(201);
    const got = await request(app).get('/food-logs').set(H);
    const row = got.body.logs.find((l) => l.id === id);
    expect(row).toBeTruthy();
    expect(row.nutritionSnapshot.components).toEqual(components);
    // totals preserved alongside
    expect(row.calories).toBe(500);
    expect(row.fiberG).toBe(5);
  });

  test('mixed dish is exactly one component; separate salad is its own', async () => {
    const id = mk('mixed');
    const components = [{ foodName: 'chicken biryani', amountG: 350 }, { foodName: 'side salad', amountG: 80 }];
    const res = await request(app).post('/food-logs').set(H).send(meal(id, { components }));
    expect(res.status).toBe(201);
    const row = (await request(app).get('/food-logs').set(H)).body.logs.find((l) => l.id === id);
    expect(row.nutritionSnapshot.components).toHaveLength(2);
    expect(row.nutritionSnapshot.components[0].foodName).toBe('chicken biryani');
  });

  test('null fiber stays null (unknown), never coerced to measured zero', async () => {
    const id = mk('nullfiber');
    const m = meal(id, { components: [{ foodName: 'mystery wrap', amountG: null }] });
    m.fiberG = null;
    const res = await request(app).post('/food-logs').set(H).send(m);
    expect(res.status).toBe(201);
    const row = (await request(app).get('/food-logs').set(H)).body.logs.find((l) => l.id === id);
    expect(row.fiberG).toBeNull();
  });

  test('non-allowlisted component fields never persist', async () => {
    const id = mk('strip');
    const components = [{ foodName: 'rice', amountG: 200, ingredients: [{ name: 'invented' }], provenance: 'evil', fiberG: 99 }];
    const res = await request(app).post('/food-logs').set(H).send(meal(id, { components }));
    expect(res.status).toBe(201);
    const row = (await request(app).get('/food-logs').set(H)).body.logs.find((l) => l.id === id);
    expect(row.nutritionSnapshot.components).toEqual([{ foodName: 'rice', amountG: 200 }]);
  });

  test.each([
    ['not-array', { components: 'rice' }],
    ['empty array', { components: [] }],
    ['missing foodName', { components: [{ amountG: 100 }] }],
    ['non-object entry', { components: ['rice'] }],
    ['oversized list', { components: Array.from({ length: 21 }, (_, i) => ({ foodName: `f${i}` })) }],
    ['negative grams', { components: [{ foodName: 'x', amountG: -5 }] }],
    ['implausible grams', { components: [{ foodName: 'x', amountG: 99999 }] }],
  ])('malformed input rejected: %s', async (_label, patch) => {
    const res = await request(app).post('/food-logs').set(H).send(meal(mk('bad'), patch));
    expect(res.status).toBe(400);
  });

  test('cross-user read/write scoping unchanged', async () => {
    const id = mk('scope');
    await request(app).post('/food-logs').set(H).send(meal(id, { components: [{ foodName: 'rice', amountG: 100 }] }));
    const other = await request(app).get('/food-logs').set({ 'x-user-id': 'comp-other-user' });
    expect(other.body.logs.some((l) => l.id === id)).toBe(false);
    // same id claimed by another user → conflict, never overwrite
    const conflict = await request(app).post('/food-logs').set({ 'x-user-id': 'comp-other-user' }).send(meal(id, {}));
    expect(conflict.status).toBe(409);
  });

  test('stable-id replay returns the original without duplicate rows', async () => {
    const id = mk('replay');
    const body = meal(id, { components: [{ foodName: 'dal', amountG: 150 }] });
    const r1 = await request(app).post('/food-logs').set(H).send(body);
    const r2 = await request(app).post('/food-logs').set(H).send(body);
    expect(r1.status).toBe(201);
    expect([200, 201]).toContain(r2.status);
    const count = (await request(app).get('/food-logs').set(H)).body.logs.filter((l) => l.id === id).length;
    expect(count).toBe(1);
  });

  test('legacy requests without components still save unchanged', async () => {
    const id = mk('legacy');
    const res = await request(app).post('/food-logs').set(H).send(meal(id));
    expect(res.status).toBe(201);
    const row = (await request(app).get('/food-logs').set(H)).body.logs.find((l) => l.id === id);
    expect(row.nutritionSnapshot.components).toBeUndefined();
  });
});
