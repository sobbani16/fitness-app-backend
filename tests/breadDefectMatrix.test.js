// HUM-49 Workstream A2: the bread defect matrix on current main.
// Bread is the canonical serving-conversion hazard: white bread carries 8
// slice/cup variants spanning 8-45g, and a resolution that picks the wrong
// sibling silently distorts nutrition 3x. This matrix pins every row.
// Requires DATABASE_URL (real catalog fixture) — skipped otherwise.
require('dotenv').config();
const HAS_DB = !!process.env.DATABASE_URL;
const { getPrisma } = require('../src/lib/prisma');
const { calculate } = require('../src/services/ingredientNutrition');

(HAS_DB ? describe : describe.skip)('bread defect matrix (A2)', () => {
  let bread, servings;
  // hermetic fixture mirroring the real white-bread serving spread — the test
  // DB is isolated, so the matrix seeds its own catalog rows and cleans up.
  const SPREAD = [
    ['1 slice, thin', 17], ['1 slice crust not eaten', 11], ['1 cup, cubes', 42],
    ['1 slice, large', 27], ['1 slice', 22], ['1 cup, crumbs', 45],
    ['1 slice, very thin', 13], ['1 slice thin, crust not eaten', 8],
  ];
  beforeAll(async () => {
    const p = getPrisma();
    await p.ingredientServing.deleteMany({ where: { ingredient: { name: 'matrix white bread' } } }).catch(() => null);
    await p.ingredient.deleteMany({ where: { name: 'matrix white bread' } }).catch(() => null);
    bread = await p.ingredient.create({
      data: {
        name: 'matrix white bread', normalizedName: 'matrix white bread', caloriesPer100g: 265, proteinPer100g: 9, carbsPer100g: 49, fatPer100g: 3.2, fiberPer100g: 2.7,
        servings: { create: SPREAD.map(([label, grams], i) => ({ id: 'matrix-serving-' + i, label, grams, sourceRecord: { matrix: true } })) },
      },
      include: { servings: true },
    });
    servings = Object.fromEntries(bread.servings.map((s) => [s.label, s]));
  });
  afterAll(async () => {
    const p = getPrisma();
    if (bread) {
      await p.ingredientServing.deleteMany({ where: { ingredientId: bread.id } }).catch(() => null);
      await p.ingredient.delete({ where: { id: bread.id } }).catch(() => null);
    }
  });

  it('every serving id resolves to ITS OWN grams — no sibling cross-contamination', async () => {
    for (const s of bread.servings) {
      const r = await calculate(bread.id, { servingId: s.id, count: 1 });
      expect(r.grams).toBeCloseTo(s.grams, 4);
    }
  });

  it('nutrition scales exactly with grams across the 8g-45g serving spread', async () => {
    const thin = await calculate(bread.id, { servingId: servings['1 slice, very thin'].id, count: 1 });
    const cup = await calculate(bread.id, { servingId: servings['1 cup, crumbs'].id, count: 1 });
    // per-gram calories must be identical regardless of which serving label carried them
    expect(thin.nutrition.calories / thin.grams).toBeCloseTo(cup.nutrition.calories / cup.grams, 4);
  });

  it('count scaling is exact — 2 slices is precisely double 1 slice', async () => {
    const one = await calculate(bread.id, { servingId: servings['1 slice'].id, count: 1 });
    const two = await calculate(bread.id, { servingId: servings['1 slice'].id, count: 2 });
    expect(two.grams).toBeCloseTo(one.grams * 2, 4);
    expect(two.nutrition.calories).toBeCloseTo(one.nutrition.calories * 2, 4);
  });

  it('direct grams path matches serving path for equal weight', async () => {
    const byServing = await calculate(bread.id, { servingId: servings['1 slice'].id, count: 2 });
    const byGrams = await calculate(bread.id, { grams: byServing.grams });
    expect(byGrams.nutrition.calories).toBeCloseTo(byServing.nutrition.calories, 2);
  });

  it('no-quantity errors instead of fabricating', async () => {
    await expect(calculate(bread.id, {})).rejects.toThrow();
  });

  it('volume logging without density → 400 guard, never fabricated mass', async () => {
    await expect(calculate(bread.id, { volumeMl: 100 })).rejects.toMatchObject({ status: 400 });
  });

  it('bogus serving id → 400, never silent fallback to a sibling', async () => {
    await expect(calculate(bread.id, { servingId: 'bogus-id', count: 1 })).rejects.toMatchObject({ status: 400 });
  });
});
