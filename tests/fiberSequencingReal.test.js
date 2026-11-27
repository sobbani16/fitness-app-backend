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
  { key: 'brownrice', name: `${P} brown rice cooked`, catName: `${P} brown rice cooked`, aliases: ['brown rice'], c: 112, p: 2.6, cb: 23, f: 0.9, fb: 1.8 },
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

  test('starch-led mixed-signal dish (aloo gobi) never takes the fiber-first slot', async () => {
    const r = await sequenceMeal([
      { name: 'aloo gobi', amountG: 150 },
      { name: 'chicken breast cooked', amountG: 150 },
      { name: 'white rice cooked', amountG: 200 },
    ]);
    const alooGobi = r.order.find(o => /aloo gobi/.test(o.component));
    expect(alooGobi.role).toBe('starch'); // potato-led dish — not a fiber-first vegetable
    expect(r.order[0].role).toBe('protein'); // nothing earns the veg slot in this meal
    expect(alooGobi.rank).toBeGreaterThan(r.order[0].rank);
  });

  test('veg-led mixed-signal names keep the veg role — positional dominance is not overcorrected', async () => {
    const r = await sequenceMeal([
      { name: 'cauliflower rice', amountG: 150 },
      { name: 'white rice cooked', amountG: 200 },
    ]);
    const cf = r.order.find(o => /cauliflower/.test(o.component));
    expect(cf.role).toBe('non_starchy_veg');
    expect(r.order[0].component).toMatch(/cauliflower/);
  });

  test('sambar classifies as legume and ranks before rice in a realistic South Indian meal', async () => {
    const r = await sequenceMeal([
      { name: 'white rice cooked', amountG: 200 },
      { name: 'sambar', amountG: 150 },
      { name: 'broccoli cooked', amountG: 100 },
    ]);
    const roles = r.order.map(o => o.role);
    expect(r.order.find(o => /sambar/.test(o.component)).role).toBe('legume');
    expect(roles).toEqual(['non_starchy_veg', 'legume', 'starch']);
  });

  test('legume-only fiber meal (no veg) uses the honest middle explanation, not a veg-first claim', async () => {
    const r = await sequenceMeal([
      { name: 'masoor dal red dry', amountG: 150 },
      { name: 'white rice cooked', amountG: 200 },
    ]);
    expect(r.order[0].role).toBe('legume'); // dal before rice
    expect(r.order[1].role).toBe('starch');
    expect(r.explanation.join(' ')).toMatch(/No non-starchy vegetable component stands out/i);
    expect(r.explanation.join(' ')).not.toMatch(/fiber-rich component/);
  });

  test('all-mixed multi-component meal is not separable', async () => {
    const r = await sequenceMeal([
      { name: 'chicken biryani', amountG: 300 },
      { name: 'veg sandwich', amountG: 150 },
    ]);
    expect(r.separable).toBe(false);
    expect(r.reason).toBe('mixed_dishes');
  });

  test('portionless veg still ranks first on per-100g density with fiber grams honestly null', async () => {
    const r = await sequenceMeal([
      { name: 'white rice cooked', amountG: 200 },
      { name: 'broccoli cooked' }, // no amountG
    ]);
    const veg = r.order[0];
    expect(veg.role).toBe('non_starchy_veg');
    expect(veg.fiberG).toBeNull(); // portion unknown — grams not invented
    expect(veg.fiberPer100g).toBeCloseTo(3.3, 2);
    expect(veg.knownFiber).toBe(false);
    expect(r.hasMeaningfulFiber).toBe(true); // density still evidences fiber
  });

  test('brown rice resolves to the brown-rice catalog row, not the white-rice row', async () => {
    const r = await sequenceMeal([
      { name: 'brown rice', amountG: 200 },
      { name: 'broccoli cooked', amountG: 100 },
    ]);
    const rice = r.order.find(o => /brown rice/.test(o.component));
    expect(rice.fiberPer100g).toBeCloseTo(1.8, 2); // brown-rice profile, not white 0.4
    expect(rice.fiberG).toBeCloseTo(3.6, 2);
  });

  test('plain rice alias resolution is stable — still the white-rice row', async () => {
    const r = await sequenceMeal([
      { name: 'rice', amountG: 200 },
      { name: 'broccoli cooked', amountG: 100 },
    ]);
    const rice = r.order.find(o => o.component === 'rice');
    expect(rice.fiberPer100g).toBeCloseTo(0.4, 2);
  });

  test('ingredientId direct resolution bypasses name matching entirely', async () => {
    const r = await sequenceMeal([
      { name: 'totally unrecognized display name', amountG: 100, ingredientId: ids.broccoli },
      { name: 'white rice cooked', amountG: 200 },
    ]);
    const first = r.order[0];
    expect(first.fiberPer100g).toBeCloseTo(3.3, 2); // resolved via id despite the unknown name
    expect(first.fiberG).toBeCloseTo(3.3, 2);
  });

  test('components beyond the 12-item cap are excluded rather than silently mis-ordered', async () => {
    const items = Array.from({ length: 13 }, (_, i) => ({ name: i === 12 ? 'broccoli cooked' : 'white rice cooked', amountG: 100 }));
    const r = await sequenceMeal(items);
    expect(r.order.length).toBe(12);
    expect(r.order.some(o => /broccoli/.test(o.component))).toBe(false); // 13th item never enters the order
  });

  test('disclaimers + evidence are always present and glucose claims absent', async () => {
    const r = await sequenceMeal([{ name: 'broccoli cooked', amountG: 100 }]);
    expect(r.disclaimers.length).toBeGreaterThan(0);
    expect(r.disclaimers.join(' ')).toMatch(/not a prescription/i);
    expect(r.disclaimers.join(' ')).toMatch(/does not guarantee/i);
    expect(r.disclaimers.join(' ')).not.toMatch(/will (lower|reduce|prevent)/i);
    expect(r.evidence.map(e => e.key)).toContain('MEAL_ORDERING');
  });

  // --- Card-listed realistic meals (pc-HUM-26 acceptance) -------------------

  test('idli + sambar sequences legume before starch — plain idli is a separable starch, not a mixed dish', async () => {
    const r = await sequenceMeal([
      { name: 'idli', amountG: 150 },
      { name: 'sambar', amountG: 150 },
    ]);
    expect(r.separable).toBe(true);
    const roles = r.order.map(o => o.role);
    expect(roles).toEqual(['legume', 'starch']);
    expect(r.explanation.join(' ')).not.toMatch(/can’t realistically be split/i);
  });

  test('dosa + chutney stays separable — plain dosa is one starch component', async () => {
    const r = await sequenceMeal([
      { name: 'dosa', amountG: 120 },
      { name: 'coconut chutney', amountG: 40 },
    ]);
    expect(r.separable).toBe(true);
    expect(r.order.find(o => /dosa/.test(o.component)).role).toBe('starch');
  });

  test('rajma + rice as separate components: legume ranks before starch', async () => {
    const r = await sequenceMeal([
      { name: 'white rice cooked', amountG: 200 },
      { name: 'rajma', amountG: 150 },
    ]);
    const roles = r.order.map(o => o.role);
    expect(roles).toEqual(['legume', 'starch']);
    expect(r.separable).toBe(true);
  });

  test('khichdi alone is an inseparable mixed dish', async () => {
    const r = await sequenceMeal([{ name: 'moong dal khichdi', amountG: 300 }]);
    expect(r.separable).toBe(false);
    expect(r.reason).toBe('mixed_dish_single');
  });

  test('upma alone is an inseparable mixed dish', async () => {
    const r = await sequenceMeal([{ name: 'vegetable upma', amountG: 250 }]);
    expect(r.separable).toBe(false);
  });

  test('pizza slice + side salad: partial mixed — only separable components are ordered', async () => {
    const r = await sequenceMeal([
      { name: 'pizza slice', amountG: 150 },
      { name: 'broccoli cooked', amountG: 150 },
    ]);
    expect(r.separable).toBe(true);
    expect(r.reason).toBe('partial_mixed');
    expect(r.explanation.join(' ')).toMatch(/can’t realistically be split/i);
    expect(r.order[0].role).toBe('non_starchy_veg'); // salad/veg advice applies to separable parts
  });

  test('pasta alone is inseparable; sandwich alone is inseparable', async () => {
    const pasta = await sequenceMeal([{ name: 'alfredo pasta', amountG: 300 }]);
    expect(pasta.separable).toBe(false);
    const sandwich = await sequenceMeal([{ name: 'grilled chicken sandwich', amountG: 250 }]);
    expect(sandwich.separable).toBe(false);
  });

  test('fully unknown-fiber meal: no invented fiber, honest suggestion only', async () => {
    const r = await sequenceMeal([
      { name: 'xqz-mystery-platter', amountG: 200 },
      { name: 'zqw-unknown-side', amountG: 100 },
    ]);
    expect(r.hasMeaningfulFiber).toBe(false);
    for (const o of r.order) expect(o.fiberG).toBeNull();
    expect(r.explanation.join(' ')).toMatch(/No meaningful fiber source/i);
  });

  // --- Allergy/restriction awareness (pc-HUM-26 acceptance) -----------------

  test('nut allergy: suggested addition never carries nut-allergen foods', async () => {
    // no-fiber meal forces a suggestedAddition; with tree-nut allergy the
    // almonds/trail-mix class must be excluded.
    const r = await sequenceMeal([
      { name: 'white rice cooked', amountG: 250 },
      { name: 'chicken breast cooked', amountG: 150 },
    ], { allergenTerms: new Set(['tree nut', 'nut', 'almond']) });
    expect(r.hasMeaningfulFiber).toBe(false);
    if (r.suggestedAddition) {
      expect(r.suggestedAddition.food || r.suggestedAddition.name || '').not.toMatch(/almond|nut/i);
    }
    const explanation = r.explanation.join(' ');
    expect(explanation).not.toMatch(/almonds/i);
  });

  test('gluten allergy: suggested addition never carries gluten-bearing foods', async () => {
    const r = await sequenceMeal([
      { name: 'white rice cooked', amountG: 250 },
      { name: 'chicken breast cooked', amountG: 150 },
    ], { allergenTerms: new Set(['gluten', 'wheat']) });
    if (r.suggestedAddition) {
      // specifically the gluten-bearing entries — millets/roti-named gluten-free items are fine
      expect((r.suggestedAddition.food || '').toLowerCase()).not.toMatch(/whole-wheat|whole-grain bread|oats/);
    }
  });

  test('suggestFoods filter is decisive: almonds present unfiltered, absent under nut allergy; gluten entries absent under gluten allergy', async () => {
    const { suggestFoods } = require('../src/services/fiber/suggestions');
    const unfiltered = suggestFoods({ limit: 30 });
    expect(unfiltered.some((x) => /almond/i.test(x.food))).toBe(true); // control: nuts reachable without restrictions
    const nutFree = suggestFoods({ limit: 30, allergenTerms: new Set(['tree nut', 'nut', 'almond']) });
    expect(nutFree.some((x) => /almond/i.test(x.food))).toBe(false);
    const gf = suggestFoods({ limit: 30, allergenTerms: new Set(['gluten', 'wheat']) });
    expect(gf.some((x) => /whole-wheat|whole-grain bread|^oats/i.test(x.food))).toBe(false);
    expect(gf.some((x) => /millets/i.test(x.food))).toBe(true); // gluten-free roti-named millets correctly survive
    const hummusFree = suggestFoods({ limit: 30, allergenTerms: new Set(['sesame']) });
    expect(hummusFree.some((x) => /hummus/i.test(x.food))).toBe(false);
  });

  test('dislike/never-recommend names are hard-filtered from suggestions', async () => {
    const r = await sequenceMeal([
      { name: 'white rice cooked', amountG: 250 },
      { name: 'chicken breast cooked', amountG: 150 },
    ], { avoidNames: new Set(['broccoli']) });
    if (r.suggestedAddition) {
      expect((r.suggestedAddition.food || '').toLowerCase()).not.toContain('broccoli');
    }
  });

  test('no medical-outcome promises across every outcome path', async () => {
    const meals = [
      [{ name: 'broccoli cooked', amountG: 150 }, { name: 'white rice cooked', amountG: 200 }], // fiber-first path
      [{ name: 'chicken biryani', amountG: 300 }], // inseparable path
      [{ name: 'white rice cooked', amountG: 250 }], // no-fiber path
      [{ name: 'xqz-mystery', amountG: 100 }], // unknown path
    ];
    for (const m of meals) {
      const r = await sequenceMeal(m);
      const text = [...r.explanation, ...r.disclaimers, ...(r.evidence || []).map(e => e.note)].join(' ');
      expect(text).not.toMatch(/will (lower|reduce|prevent|control|treat|cure)/i);
      expect(text).not.toMatch(/(prevents?|treats?|cures?|reverses?)/i);
      expect(text).not.toMatch(/diabetes|medication|insulin dose|medical treatment/i);
      expect(r.disclaimers.join(' ')).toMatch(/optional suggestion/i);
    }
  });

  test('evidence notes document uncertainty and applicability limits', async () => {
    const r = await sequenceMeal([{ name: 'broccoli cooked', amountG: 100 }]);
    const ordering = r.evidence.find(e => e.key === 'MEAL_ORDERING');
    expect(ordering.note).toMatch(/context-dependent|vary|not guaranteed/i);
    expect(ordering.note).toMatch(/some populations/i);
  });

});
