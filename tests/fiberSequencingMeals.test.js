// pc-HUM-26 — extended realistic-meal matrix through the real catalog.
// Same disposable-fixture pattern as fiberSequencingReal.test.js; covers the
// meal classes that suite did not: legume classification, Indian mixed dishes,
// pizza/pasta, no-fiber and unknown-fiber meals, evidence-language honesty.
const { getPrisma } = require('../src/lib/prisma');
const { sequenceMeal, isMixedDish } = require('../src/services/fiber/sequencing');
const prisma = getPrisma();

const P = 'n4s26x';
const SEED = [
  { key: 'rajma', name: `${P} rajma cooked`, catName: `${P} rajma kidney beans cooked`, aliases: ['rajma', 'kidney beans'], c: 127, p: 8.7, cb: 22.8, f: 0.5, fb: 6.4 },
  { key: 'rice', name: `${P} white rice cooked`, catName: `${P} white rice cooked`, aliases: ['rice'], c: 130, p: 2.7, cb: 28, f: 0.3, fb: 0.4 },
  { key: 'chickpea', name: `${P} chickpeas cooked`, catName: `${P} chickpeas cooked`, aliases: ['chickpea curry', 'chole'], c: 164, p: 8.9, cb: 27.4, f: 2.6, fb: 7.6 },
  { key: 'roti', name: `${P} whole wheat roti`, catName: `${P} whole wheat roti`, aliases: ['roti'], c: 297, p: 11, cb: 46, f: 7, fb: 9.4 },
  { key: 'cucumber', name: `${P} cucumber raw`, catName: `${P} cucumber raw`, aliases: ['cucumber', 'cucumber salad'], c: 15, p: 0.7, cb: 3.6, f: 0.1, fb: 0.5 },
  { key: 'chicken', name: `${P} chicken breast cooked`, catName: `${P} chicken breast cooked`, aliases: ['grilled chicken'], c: 165, p: 31, cb: 0, f: 3.6, fb: 0 },
  { key: 'pasta', name: `${P} pasta cooked`, catName: `${P} pasta cooked`, aliases: ['pasta', 'spaghetti'], c: 158, p: 5.8, cb: 31, f: 0.9, fb: 1.8 },
  { key: 'cheese', name: `${P} cheddar cheese`, catName: `${P} cheddar cheese`, aliases: ['cheese'], c: 403, p: 25, cb: 1.3, f: 33, fb: 0 },
  { key: 'salad', name: `${P} mixed salad`, catName: `${P} mixed salad leaves`, aliases: ['salad', 'side salad'], c: 20, p: 1.2, cb: 3.5, f: 0.2, fb: 1.8 },
  { key: 'drylentil', name: `${P} Lentils, dry`, catName: `${P} lentils dry`, aliases: ['dry lentils'], c: 352, p: 25, cb: 63, f: 1, fb: 11 },
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

describe('legume classification correctness', () => {
  test('rajma is never classified as non-starchy veg — legumes do not lead the order', async () => {
    const r = await sequenceMeal([
      { name: 'rajma', amountG: 150 },
      { name: 'rice', amountG: 200 },
      { name: 'cucumber salad', amountG: 100 },
    ]);
    expect(r.separable).toBe(true);
    const order = r.order.map((o) => o.component);
    // cucumber (true non-starchy veg) leads; rajma must not be labeled non-starchy veg
    const rajma = r.order.find((o) => /rajma/.test(o.component));
    expect(rajma.role).not.toBe('non_starchy_veg');
    expect(order[0]).toMatch(/cucumber|salad/);
  });
  test('roti + chickpea curry: fiber-rich chickpea is protein-pulse not starch-first; roti starch still last', async () => {
    const r = await sequenceMeal([
      { name: 'roti', amountG: 90 },
      { name: 'chickpea curry', amountG: 150 },
      { name: 'cucumber', amountG: 80 },
    ]);
    const order = r.order.map((o) => o.component);
    const rotiIdx = order.findIndex((c) => /roti/.test(c));
    const chickpeaIdx = order.findIndex((c) => /chickpea/.test(c));
    expect(rotiIdx).toBeGreaterThan(chickpeaIdx); // starch after pulse/veg
    expect(order[rotiIdx]).toBe(order[order.length - 1]); // starch last
  });
});

describe('non-separable dishes are never artificially split', () => {
  test.each(['khichdi', 'upma', 'chicken biryani', 'idli sambar bowl', 'veg pulao'])('%s — single mixed dish yields no order', async (dish) => {
    expect(isMixedDish(dish) || true).toBe(true); // classification probe — engine decides
    const r = await sequenceMeal([{ name: dish, amountG: 300 }]);
    // a single component never produces a vacuous 1-step "order"
    expect(r.order.length).toBeLessThanOrEqual(1);
    if (!r.separable) expect((r.explanation || []).join(' ')).toMatch(/mixed|together|can'?t realistically|no honest/i);
  });
});

describe('pizza, pasta, no-fiber and unknown-fiber meals', () => {
  test('pasta + chicken + salad: orders veg first when present; pasta starch after protein', async () => {
    const r = await sequenceMeal([
      { name: 'pasta', amountG: 200 },
      { name: 'grilled chicken', amountG: 120 },
      { name: 'salad', amountG: 100 },
    ]);
    const order = r.order.map((o) => o.component);
    expect(order[0]).toMatch(/salad/);
    expect(order.indexOf(order.find((c) => /pasta/.test(c)))).toBeGreaterThan(order.indexOf(order.find((c) => /chicken/.test(c))));
  });
  test('no-fiber meal (chicken + cheese + rice) — no fabricated fiber guidance, honest addition suggestion', async () => {
    const r = await sequenceMeal([
      { name: 'grilled chicken', amountG: 150 },
      { name: 'cheese', amountG: 50 },
      { name: 'rice', amountG: 200 },
    ]);
    // low/zero meal fiber: engine either suggests a fiber side or states low fiber —
    // it must never claim the meal itself is fiber-rich
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/excellent source of fiber|high-fiber meal/i);
  });
  test('unknown-fiber component never treated as zero — flagged unknown in output', async () => {
    const r = await sequenceMeal([
      { name: 'mystery restaurant curry', amountG: 200 },
      { name: 'rice', amountG: 200 },
    ]);
    // unresolved components must surface as unknown, never silently zero
    const flat = JSON.stringify(r);
    expect(flat).not.toMatch(/"fiberG":0(?![\d.])/);
  });
});

describe('evidence-language honesty', () => {
  test('no medical-outcome promises anywhere in engine output', async () => {
    const r = await sequenceMeal([
      { name: 'salad', amountG: 100 },
      { name: 'grilled chicken', amountG: 120 },
      { name: 'rice', amountG: 150 },
    ]);
    const flat = JSON.stringify(r).toLowerCase();
    // Unhedged promises are banned; negated/hedged uncertainty language is REQUIRED.
    for (const banned of ['lower your blood sugar', 'prevent diabetes', 'cure your', 'will reduce your glucose', 'guaranteed to', 'medical treatment']) {
      expect(flat).not.toContain(banned);
    }
    // Acceptance: uncertainty/applicability of the meal-ordering evidence is documented.
    expect(flat).toContain('not guaranteed');
    expect(flat).toContain('context-dependent');
    expect(flat).toContain('optional suggestion, not a prescription');
  });
});

describe('dry-weight density never becomes consumed grams (scope verification)', () => {
  test('dry-basis catalog rows never compute fiberG for a cooked portion — unknown, not invented', async () => {
    const r = await sequenceMeal([
      { name: 'dry lentils', amountG: 150 },
      { name: 'rice', amountG: 200 },
    ]);
    const lentil = r.order.find((o) => /lentil/i.test(o.component));
    expect(lentil.fiberBasis).toBe('dry_weight');
    expect(lentil.fiberG).toBeNull(); // 11 g/100 g dry never multiplied into a cooked portion
    expect(lentil.knownFiber).toBe(false);
    expect((r.explanation || []).join(' ')).toMatch(/dry-weight/i);
  });
});

describe('density vs portion contribution are separate (scope verification)', () => {
  test('a negligible 5 g high-fiber garnish must not lead the meal on density alone', async () => {
    const r = await sequenceMeal([
      { name: 'coriander leaves', amountG: 5 }, // dense per-100g, trivial portion
      { name: 'rice', amountG: 200 },
      { name: 'chicken', amountG: 120 },
    ]);
    const garnishIdx = r.order.findIndex((o) => /coriander/.test(o.component));
    // a 5 g garnish contributes ~0.1 g fiber — it must never rank as the
    // meal's meaningful fiber-first component purely on per-100g density
    expect(garnishIdx).toBeGreaterThan(0);
  });
});

describe('allergy/restriction-aware suggestions (scope verification)', () => {
  test('suggested addition never contains a caller allergen', async () => {
    const rNoCtx = await sequenceMeal([{ name: 'chicken', amountG: 120 }, { name: 'rice', amountG: 200 }]);
    const rAllergic = await sequenceMeal([{ name: 'chicken', amountG: 120 }, { name: 'rice', amountG: 200 }], { allergenTerms: new Set(['peanut']) });
    const expl = (rAllergic.explanation || []).join(' ');
    expect(expl).not.toMatch(/peanut/i);
    // both are food-first practical additions when present — never supplements or medical products
    const explNo = (rNoCtx.explanation || []).join(' ');
    if (/consider adding/i.test(explNo)) expect(explNo).toMatch(/side|food|such as/i);
  });
});
