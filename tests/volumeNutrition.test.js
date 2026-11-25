// Volume → mass resolution (HUM-49 Workstream C): density-guarded only.
// No 1ml=1g shortcut, no fabricated mass — missing density refuses, every
// conversion records its provenance.
const { calculate } = require('../src/services/ingredientNutrition');

const MILK = {
  id: 'i-milk', name: 'Whole milk', source: 'usda', densityGPerMl: 1.03,
  caloriesPer100g: 61, proteinPer100g: 3.2, carbsPer100g: 4.8, fatPer100g: 3.3, fiberPer100g: 0,
  catalog: null, servings: [
    { id: 'sv-g', label: '100 g', grams: 100, ml: null, estimated: false, sourceRecord: {} },
    { id: 'sv-cup', label: '1 cup (240 ml)', grams: 0, ml: 240, estimated: false, sourceRecord: {} },
  ],
};
const OIL_NO_DENSITY = { ...MILK, id: 'i-oil', name: 'Olive oil', densityGPerMl: null };
const db = (item) => ({ ingredient: { findUnique: async () => item } });

it('grams path is unchanged', async () => {
  const r = await calculate('i-milk', { grams: 200 }, db(MILK));
  expect(r.grams).toBe(200);
  expect(r.nutrition.calories).toBeCloseTo(122, 1);
  expect(r.provenance.nutritionBasis).toBe('PER_100_G');
  expect(r.provenance.conversion).toBe('direct grams');
});

it('gram serving path is unchanged', async () => {
  const r = await calculate('i-milk', { servingId: 'sv-g', count: 2 }, db(MILK));
  expect(r.grams).toBe(200);
  expect(r.serving.id).toBe('sv-g');
});

it('volume serving converts via food-specific density and records it', async () => {
  const r = await calculate('i-milk', { servingId: 'sv-cup', count: 1 }, db(MILK));
  expect(r.grams).toBeCloseTo(247.2, 3); // 240 ml × 1.03
  expect(r.densityGPerMl).toBe(1.03);
  expect(r.serving.ml).toBe(240);
  expect(r.provenance.conversion).toContain('1.03 g/ml');
  expect(r.nutrition.calories).toBeCloseTo(61 * 2.472, 1);
});

it('explicit volumeMl converts with density', async () => {
  const r = await calculate('i-milk', { volumeMl: 100 }, db(MILK));
  expect(r.grams).toBeCloseTo(103, 3);
  expect(r.nutrition.calories).toBeCloseTo(61 * 1.03, 1);
});

it('refuses volume without density — no fabricated mass', async () => {
  await expect(calculate('i-oil', { servingId: 'sv-cup', count: 1 }, db(OIL_NO_DENSITY)))
    .rejects.toMatchObject({ status: 400, message: 'volume_requires_density' });
  await expect(calculate('i-oil', { volumeMl: 50 }, db(OIL_NO_DENSITY)))
    .rejects.toMatchObject({ status: 400, message: 'volume_requires_density' });
});

it('never applies a 1ml=1g implicit fallback', async () => {
  // density 1.03 must actually be applied — a silent 1.0 would give 240g.
  const r = await calculate('i-milk', { servingId: 'sv-cup', count: 1 }, db(MILK));
  expect(r.grams).not.toBe(240);
});

it('rejects invalid volumes', async () => {
  await expect(calculate('i-milk', { volumeMl: -5 }, db(MILK))).rejects.toMatchObject({ status: 400 });
  await expect(calculate('i-milk', { volumeMl: 'x' }, db(MILK))).rejects.toMatchObject({ status: 400 });
});
