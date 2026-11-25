// Retained realistic-meal sequencing validation — pc-HUM-26.
// Unlike tests/fiber.sequencing.test.js (mocked prisma), this suite resolves
// components through the REAL prisma layer on the disposable fitness_test DB:
// it seeds an n4s26-scoped catalog (Ingredient + IngredientCatalog rows with
// realistic per-100g profiles), runs sequenceMeal end-to-end, and removes all
// fixtures in afterAll. No suite-order dependencies.
const { getPrisma } = require('../src/lib/prisma');
const { sequenceMeal, isMixedDish } = require('../src/services/fiber/sequencing');
const prisma = getPrisma();

const P = 'n4s26';
// Realistic per-100g profiles (USDA-consistent orders of magnitude).
const SEED = [
  { key: 'broccoli', name: `${P} broccoli cooked`, catName: `${P} broccoli cooked`, aliases: ['broccoli'], c: 35, p: 2.4, cb: 7, f: 0.4, fb: 3.3 },
  { key: 'spinach', name: `${P} spinach cooked`, catName: `${P} spinach cooked`, aliases: ['palak'], c: 23, p: 3, cb: 3.8, f: 0.3, fb: 2.4 },
  { key: 'chicken', name: `${P} chicken breast cooked`, catName: `${P} chicken breast cooked`, aliases: ['grilled chicken'], c: 165, p: 31, cb: 0, f: 3.6, fb: 0 },
  { key: 'rice', name: `${P} white rice cooked`, catName: `${P} white rice cooked`, aliases: ['rice', 'chawal'], c: 130, p: 2.7, cb: 28, f: 0.3, fb: 0.4 },
  { key: 'daldry', name: `${P} masoor dal, dry`, catName: `${P} masoor dal red dry`, aliases: ['masoor dal', 'red lentils dry'], c: 352, p: 24.6, cb: 63, f: 1.1, fb: 10.7 },
  { key: 'apple', name: `${P} apple raw`, catName: `${P} apple raw`, aliases: ['apple'], c: 52, p: 0.3, cb: 14, f: 0.2, fb: 2.4 },
  { key: 'yogurt', name: `${P} curd plain`, catName: `${P} curd plain`, aliases: ['dahi', 'curd'], c: 61, p: 3.5, cb: 4.7, f: 3.3, fb: 0 },
  { key: 'roti', name: `${P} whole wheat roti`, catName: `${P} whole wheat roti`, aliases: ['roti', 'chapati'], c: 297, p: 11, cb: 46, f: 7, fb: 9.4 },
];
const ids = {};

beforeAll(async () => {
  for (const s of SEED) {
    const cat = await prisma.ingredientCatalog.create({ data: { id: `${P}-cat-${s.key}`, name: s.catName, normalizedName: s.catName, aliases: s.aliases, category: 'test', preparation: 'cooked', status: 'active', usable: true, sourceRecord: { fixture: P } } });
    const ing = await prisma.ingredient.create({ data: { name: s.name, normalizedName: s.name.toLowerCase(), caloriesPer100g: s.c, proteinPer100g: s.p, carbsPer100g: s.cb, fatPer100g: s.f, fiberPer100g: s.fb, catalogId: cat.id, source: 'test-fixture' } });
    ids[s.key] = ing.id;
  }
});

afterAll(async () => {
  await prisma.ingredient.deleteMany({ where: { name: { startsWith: P } } });
  await prisma.ingredientCatalog.deleteMany({ where: { normalizedName: { startsWith: P } } });
  await prisma.$disconnect();
});

describe('realistic meals through the real catalog', () => {
  test('veg + protein + rice plate orders fiber-veg → protein → starch with real fiber math', async () => {
    const r = await sequenceMeal([
      { name: 'white rice cooked', amountG: 200 },
      { name: 'chicken breast cooked', amountG: 150 },
      { name: 'broccoli cooked', amountG: 150 },
    ]);
    expect(r.separable).toBe(true);
    expect(r.order.map(o => o.role)).toEqual(['non_starchy_veg', 'protein', 'starch']);
    // Broccoli resolved through catalog alias → 3.3 g/100g × 150 g = 4.95 g
    const veg = r.order[0];
    expect(veg.knownFiber).toBe(true);
    expect(veg.fiberG).toBeCloseTo(4.95, 2);
    expect(r.hasMeaningfulFiber).toBe(true);
  });

  test('dry-weight legume catalog row is not multiplied into a cooked portion', async () => {
    const r = await sequenceMeal([
      { name: 'masoor dal red dry', amountG: 150 },
      { name: 'spinach cooked', amountG: 150 },
      { name: 'whole wheat roti', amountG: 60 },
    ]);
    const dal = r.order.find(o => /masoor/.test(o.component));
    expect(dal.fiberG).toBeNull(); // dry basis held back, not 10.7×1.5=16
    expect(dal.fiberBasis).toBe('dry_weight');
    expect(r.explanation.join(' ')).toMatch(/dry-weight/i);
    // ordering still places the verified veg first, dal (legume) before starch
    expect(r.order[0].role).toBe('non_starchy_veg');
    expect(r.order[1].role).toBe('legume');
    expect(r.order[2].role).toBe('starch');
  });

  test('realistic thali-ish meal: roti (high fiber) still ranks last as starch', async () => {
    const r = await sequenceMeal([
      { name: 'whole wheat roti', amountG: 90 },
      { name: 'palak', amountG: 100 },
      { name: 'dahi', amountG: 100 },
    ]);
    expect(r.order.map(o => o.role)).toEqual(['non_starchy_veg', 'dairy', 'starch']);
    // fiber does not rescue a starch from the last slot — the rule is by role
    expect(r.order[2].component).toMatch(/roti/);
    expect(r.order[2].fiberG).toBeCloseTo(8.46, 2);
  });

  test('single mixed dish is not split', async () => {
    const r = await sequenceMeal([{ name: 'chicken biryani', amountG: 350 }]);
    expect(r.separable).toBe(false);
    expect(r.reason).toBe('mixed_dish_single');
  });

  test('partially mixed meal sequences only the separable components', async () => {
    const r = await sequenceMeal([
      { name: 'veg sandwich', amountG: 180 },
      { name: 'broccoli cooked', amountG: 120 },
      { name: 'apple raw', amountG: 150 },
    ]);
    expect(r.separable).toBe(true);
    expect(r.reason).toBe('partial_mixed');
    expect(r.explanation.join(' ')).toMatch(/realistically be split/i);
    expect(r.order[0].role).toBe('non_starchy_veg');
  });

  test('unresolved component is unclassified, never auto-first', async () => {
    const r = await sequenceMeal([
      { name: 'mystery flakes', amountG: 50 },
      { name: 'spinach cooked', amountG: 100 },
    ]);
    const unk = r.order.find(o => /mystery/.test(o.component));
    expect(unk.role).toBe('unknown');
    expect(r.order[0].role).toBe('non_starchy_veg');
    expect(unk.fiberG).toBeNull();
  });

  test('meal with no meaningful fiber still gets an honest suggestion, not an invented order claim', async () => {
    const r = await sequenceMeal([
      { name: 'white rice cooked', amountG: 200 },
      { name: 'dahi', amountG: 100 },
    ]);
    // rice 0.4 fb and curd 0 fb — no fiber-bearing component
    expect(r.hasMeaningfulFiber).toBe(false);
    expect(r.explanation.join(' ')).toMatch(/No meaningful fiber source/i);
  });

  test('disclaimers + evidence are always present and glucose claims absent', async () => {
    const r = await sequenceMeal([{ name: 'broccoli cooked', amountG: 100 }]);
    expect(r.disclaimers.length).toBeGreaterThan(0);
    expect(r.disclaimers.join(' ')).toMatch(/not a prescription/i);
    expect(r.disclaimers.join(' ')).toMatch(/does not guarantee/i);
    expect(r.disclaimers.join(' ')).not.toMatch(/will (lower|reduce|prevent)/i);
    expect(r.evidence.map(e => e.key)).toContain('MEAL_ORDERING');
  });
});
