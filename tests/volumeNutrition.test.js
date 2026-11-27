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

it('volume without density resolves volume-natively — mass null, NEVER fabricated (decision #144/#155)', async () => {
  const r1 = await calculate('i-oil', { servingId: 'sv-cup', count: 1 }, db(OIL_NO_DENSITY));
  expect(r1.grams).toBeNull(); // unknown mass — never 1ml=1g
  expect(r1.volumeMl).toBe(240);
  expect(r1.nutritionBasis).toBe('PER_100_ML');
  expect(r1.nutrition.calories).toBeCloseTo(61 * 2.4, 1); // declared basis × volume
  const r2 = await calculate('i-oil', { volumeMl: 50 }, db(OIL_NO_DENSITY));
  expect(r2.grams).toBeNull();
  expect(r2.nutrition.calories).toBeCloseTo(61 * 0.5, 1);
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

// ── Workstream C baseline evidence: native per-100-mL nutrition ─────────────
// A beverage whose SOURCE declares nutrition per 100 mL cannot be represented
// in the per-100g-canonical model without a density conversion. Required per
// spec C2: 330 mL → 138.6 kcal with UNKNOWN mass (no conversion needed when
// the basis is already volume-compatible). This suite records what the
// current resolver ACTUALLY does — baseline evidence, not the fix.
const BEVERAGE = {
  id: 'i-bev', name: 'Orange juice (per-100ml declared)', source: 'usda', densityGPerMl: null,
  caloriesPer100g: 42, proteinPer100g: 0.7, carbsPer100g: 10, fatPer100g: 0.2, fiberPer100g: 0.2,
  catalog: null, servings: [
    { id: 'sv-330', label: '1 can (330 ml)', grams: 0, ml: 330, estimated: false, sourceRecord: {} },
  ],
};
const BEVERAGE_DENSITY = { ...BEVERAGE, id: 'i-bev-d', densityGPerMl: 1.04 };

describe('baseline: native per-100-mL nutrition (Workstream C evidence)', () => {
  it('APPROVED: 330 ml → 138.6 kcal with unknown mass — volume-native resolution (decisions #111/#144/#155)', async () => {
    // Spec C2 realized: kcal computable directly on the volume basis —
    // 42 kcal/100ml × 3.3 = 138.6 kcal, mass legitimately unknown.
    const r = await calculate('i-bev', { volumeMl: 330 }, db(BEVERAGE));
    expect(r.nutrition.calories).toBeCloseTo(138.6, 1);
    expect(r.grams).toBeNull();
    expect(r.nutritionBasis).toBe('PER_100_ML');
    expect(r.provenance.conversion).toMatch(/volume-native/);
    const rs = await calculate('i-bev', { servingId: 'sv-330', count: 1 }, db(BEVERAGE));
    expect(rs.nutrition.calories).toBeCloseTo(138.6, 1);
    expect(rs.grams).toBeNull();
  });
  it('CONTROL: identical beverage WITH valid density computes correctly through conversion', async () => {
    const r = await calculate('i-bev-d', { volumeMl: 330 }, db(BEVERAGE_DENSITY));
    expect(r.grams).toBeCloseTo(343.2, 1); // 330 × 1.04 — conversion documented
    expect(r.nutrition.calories).toBeCloseTo(42 * 3.432, 1);
    expect(r.provenance.conversion).toContain('1.04 g/ml');
  });
});

// ── Workstream C: explicit-basis calculation (calculateDeclared) ────────────
const { calculateDeclared } = require('../src/services/nutrition');

const JUICE_ML = { basis: 'PER_100_ML', nutrients: { calories: 42, proteinG: 0.7, carbsG: 10, fatG: 0.2, fiberG: null } };

describe('calculateDeclared — explicit mass/volume/serving bases', () => {
  it('330 mL at 42 kcal per 100 mL → 138.6 kcal with UNKNOWN mass', () => {
    const r = calculateDeclared(JUICE_ML, { volumeMl: 330 });
    expect(r.nutrition.calories).toBeCloseTo(138.6, 4);
    expect(r.massG).toBeNull(); // never fabricated, never zero-stand-in
    expect(r.basis).toBe('PER_100_ML');
    expect(r.referenceQuantity).toBe(100);
  });
  it('64 g at 247 kcal per 100 g → 158.08 kcal, mass known', () => {
    const r = calculateDeclared({ basis: 'PER_100_G', nutrients: { calories: 247 } }, { grams: 64 });
    expect(r.nutrition.calories).toBeCloseTo(158.08, 4);
    expect(r.massG).toBe(64);
  });
  it('2 servings at 120 kcal per serving → 240 kcal, mass unknown without documented serving mass', () => {
    const r = calculateDeclared({ basis: 'PER_SERVING', nutrients: { calories: 120 } }, { servingCount: 2 });
    expect(r.nutrition.calories).toBeCloseTo(240, 4);
    expect(r.massG).toBeNull();
  });
  it('fractional servings scale correctly; documented serving mass yields mass', () => {
    const r = calculateDeclared({ basis: 'PER_SERVING', nutrients: { calories: 120 } }, { servingCount: 0.5, servingMassG: 55 });
    expect(r.nutrition.calories).toBeCloseTo(60, 4);
    expect(r.massG).toBeCloseTo(27.5, 4);
  });
  it('unknown nutrients remain null — distinct from measured zero', () => {
    const r = calculateDeclared(JUICE_ML, { volumeMl: 330 });
    expect(r.nutrition.fiberG).toBeNull();
    const z = calculateDeclared({ basis: 'PER_100_ML', nutrients: { fiberG: 0 } }, { volumeMl: 100 });
    expect(z.nutrition.fiberG).toBe(0); // measured zero survives as zero
  });
  it('unit mismatches are rejected — no implicit conversion', () => {
    expect(() => calculateDeclared(JUICE_ML, { grams: 100 })).toThrow(/unit_mismatch/);
    expect(() => calculateDeclared({ basis: 'PER_100_G', nutrients: {} }, { volumeMl: 100 })).toThrow(/unit_mismatch/);
    expect(() => calculateDeclared({ basis: 'PER_SERVING', nutrients: {} }, { grams: 50 })).toThrow(/unit_mismatch/);
  });
  it('invalid amounts and unsupported bases are rejected', () => {
    expect(() => calculateDeclared(JUICE_ML, { volumeMl: -5 })).toThrow(/invalid volumeMl/);
    expect(() => calculateDeclared(JUICE_ML, { volumeMl: NaN })).toThrow(/invalid volumeMl/);
    expect(() => calculateDeclared({ basis: 'PER_GRAM', nutrients: {} }, { grams: 1 })).toThrow(/unsupported_basis/);
    expect(() => calculateDeclared(JUICE_ML, {})).toThrow(/missing volumeMl/);
  });
});
