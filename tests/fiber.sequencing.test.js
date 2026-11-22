// Fiber-first meal sequencing — deterministic ordering rules.
// Invariants:
//   - Only non-starchy-veg components with meaningful fiber take the first slot.
//   - Fruit/nuts/legumes/whole grains are contextual — never auto-first.
//   - Mixed dishes are never split into fake ingredient sequences.
//   - Output is always optional + evidence-labeled; no glucose promises.
jest.mock('../src/lib/prisma', () => { const db = {
  ingredientCatalog: { findMany: jest.fn() },
  ingredient: { findUnique: jest.fn() },
}; return { getPrisma: () => db }; });
const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();
const { sequenceMeal, isMixedDish } = require('../src/services/fiber/sequencing');

const ING = (name, per100) => ({ id: `id-${name}`, name, caloriesPer100g: per100.c ?? 100, proteinPer100g: per100.p ?? 0, carbsPer100g: per100.cb ?? 0, fatPer100g: per100.f ?? 0, fiberPer100g: per100.fb ?? null });
const CATALOG = [
  { normalizedName: 'broccoli cooked', aliases: ['broccoli'], ingredient: ING('Broccoli, cooked', { c: 35, p: 2.4, cb: 7, f: 0.4, fb: 3.3 }) },
  { normalizedName: 'white rice cooked', aliases: ['rice', 'white rice'], ingredient: ING('White rice, cooked', { c: 130, p: 2.7, cb: 28, f: 0.3, fb: 0.4 }) },
  { normalizedName: 'chicken breast cooked', aliases: ['chicken', 'grilled chicken'], ingredient: ING('Chicken breast', { c: 165, p: 31, cb: 0, f: 3.6, fb: 0 }) },
  { normalizedName: 'dal cooked', aliases: ['dal', 'lentils'], ingredient: ING('Dal, cooked', { c: 116, p: 9, cb: 20, f: 0.4, fb: 7.9 }) },
  { normalizedName: 'apple', aliases: [], ingredient: ING('Apple', { c: 52, p: 0.3, cb: 14, f: 0.2, fb: 2.4 }) },
];

describe('fiber/sequencing.sequenceMeal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.ingredientCatalog.findMany.mockResolvedValue(CATALOG);
    prisma.ingredient.findUnique.mockResolvedValue(null);
  });

  it('orders fiber-rich veg → protein → starch', async () => {
    const r = await sequenceMeal([
      { name: 'white rice, cooked', amountG: 200 },
      { name: 'chicken breast cooked', amountG: 150 },
      { name: 'broccoli cooked', amountG: 150 },
    ]);
    expect(r.separable).toBe(true);
    expect(r.order[0].component).toBe('broccoli cooked');
    expect(r.order[0].role).toBe('non_starchy_veg');
    expect(r.order[1].role).toBe('protein');
    expect(r.order[2].role).toBe('starch');
    expect(r.hasMeaningfulFiber).toBe(true);
  });

  it('suggests a fiber addition when no meaningful source exists', async () => {
    const r = await sequenceMeal([
      { name: 'white rice, cooked', amountG: 200 },
      { name: 'chicken breast cooked', amountG: 150 },
    ]);
    expect(r.hasMeaningfulFiber).toBe(false);
    expect(r.suggestedAddition).toBeTruthy();
    expect(r.suggestedAddition.classes).toContain('non_starchy_veg');
    expect(r.explanation.join(' ')).toMatch(/fiber-rich side/i);
  });

  it('never splits a mixed dish into a fake sequence', async () => {
    for (const dish of ['chicken biryani', 'khichdi', 'veg pizza', 'club sandwich', 'hakka noodles']) {
      const r = await sequenceMeal([{ name: dish, amountG: 350 }]);
      expect(r.separable).toBe(false);
      expect(r.reason).toMatch(/mixed/);
    }
  });

  it('does not auto-rank fruit or whole grains first — contextual placement', async () => {
    const r = await sequenceMeal([
      { name: 'apple', amountG: 180 },
      { name: 'chicken breast cooked', amountG: 150 },
      { name: 'white rice, cooked', amountG: 200 },
      { name: 'broccoli cooked', amountG: 150 },
    ]);
    expect(r.order[0].component).toBe('broccoli cooked');
    const appleRank = r.order.find((o) => o.component === 'apple').rank;
    expect(appleRank).toBeGreaterThan(1);
  });

  it('legumes rank before starch, after veg', async () => {
    const r = await sequenceMeal([
      { name: 'white rice, cooked', amountG: 200 },
      { name: 'dal cooked', amountG: 150 },
      { name: 'broccoli cooked', amountG: 150 },
    ]);
    const roles = r.order.map((o) => o.role);
    expect(roles.indexOf('non_starchy_veg')).toBeLessThan(roles.indexOf('legume'));
    expect(roles.indexOf('legume')).toBeLessThan(roles.indexOf('starch'));
  });

  it('marks unknown fiber honestly — never fabricates a value', async () => {
    prisma.ingredientCatalog.findMany.mockResolvedValue([{ ...CATALOG[0], ingredient: { ...CATALOG[0].ingredient, fiberPer100g: null } }]);
    const r = await sequenceMeal([{ name: 'broccoli cooked', amountG: 150 }, { name: 'chicken breast cooked', amountG: 150 }]);
    const broc = r.order.find((o) => o.component === 'broccoli cooked');
    expect(broc.knownFiber).toBe(false);
    expect(broc.fiberG).toBeNull();
  });

  it('carries the optional-suggestion disclaimers and no glucose guarantee', async () => {
    const r = await sequenceMeal([{ name: 'broccoli cooked', amountG: 150 }, { name: 'white rice, cooked', amountG: 200 }]);
    expect(r.disclaimers.join(' ')).toMatch(/optional/i);
    // Affirmative glucose claims are banned in user-facing prose; hedged
    // framing ("not guaranteed") in disclaimers/evidence is required copy.
    expect(r.explanation.join(' ')).not.toMatch(/will (prevent|lower|reduce)|guaranteed|proven to/i);
  });

  it('handles a single-component meal without inventing separation', async () => {
    const r = await sequenceMeal([{ name: 'broccoli cooked', amountG: 150 }]);
    expect(r.order.length).toBe(1);
  });
});

describe('fiber/sequencing.isMixedDish', () => {
  it('detects common mixed dishes incl. Indian + international', () => {
    for (const d of ['biryani', 'khichdi', 'pizza', 'sandwich', 'fried rice', 'pulao', 'pasta', 'upma']) {
      expect(isMixedDish(d)).toBe(true);
    }
    for (const d of ['grilled chicken', 'steamed broccoli', 'white rice', 'dal']) {
      expect(isMixedDish(d)).toBe(false);
    }
  });
});

describe('fiber/sequencing — Stage 2 audit fixes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.ingredientCatalog.findMany.mockResolvedValue(CATALOG);
    prisma.ingredient.findUnique.mockResolvedValue(null);
  });

  it('dry-basis catalog entries never produce an eaten-portion fiberG', async () => {
    prisma.ingredientCatalog.findMany.mockResolvedValue([
      { normalizedName: 'toor dal', aliases: ['dal'], ingredient: ING('Toor/arhar dal, dry', { c: 335, p: 22, cb: 58, f: 1.5, fb: 15 }) },
      CATALOG[1],
    ]);
    const r = await sequenceMeal([{ name: 'toor dal', amountG: 150 }, { name: 'white rice', amountG: 200 }]);
    const dal = r.order.find((o) => o.component === 'toor dal');
    expect(dal.fiberG).toBeNull();            // NOT 22.5 g (dry × cooked portion)
    expect(dal.fiberBasis).toBe('dry_weight');
    expect(dal.knownFiber).toBe(false);
    expect(r.order[0].component).toBe('toor dal'); // ordering unaffected — legume still first
    expect(r.explanation.join(' ')).toMatch(/dry-weight/i);
  });

  it('a legume with unknown portion fiber still counts as fiber-bearing (no false "no fiber" + no bogus suggestion)', async () => {
    prisma.ingredientCatalog.findMany.mockResolvedValue([
      { normalizedName: 'toor dal', aliases: ['dal'], ingredient: ING('Toor/arhar dal, dry', { fb: 15 }) },
      CATALOG[1],
    ]);
    const r = await sequenceMeal([{ name: 'toor dal', amountG: 150 }, { name: 'white rice', amountG: 200 }]);
    expect(r.hasMeaningfulFiber).toBe(true);          // per-100 g density is real even when portion grams are unknown
    expect(r.suggestedAddition).toBeNull();
    expect(r.explanation.join(' ')).not.toMatch(/no meaningful fiber/i);
  });

  it('rajma/chole-style names classify as legume, not non-starchy vegetable', async () => {
    prisma.ingredientCatalog.findMany.mockResolvedValue([
      { normalizedName: 'rajma kidney beans cooked', aliases: ['rajma'], ingredient: ING('Rajma kidney beans, cooked', { c: 127, p: 8.7, cb: 22, f: 0.5, fb: 6.4 }) },
      CATALOG[1],
    ]);
    const r = await sequenceMeal([{ name: 'rajma kidney beans, cooked', amountG: 150 }, { name: 'rice', amountG: 200 }]);
    expect(r.order[0].role).toBe('legume');
    expect(r.order[0].roleLabel).toMatch(/legume/i);
  });

  it('green beans still classify as non-starchy vegetable', async () => {
    prisma.ingredientCatalog.findMany.mockResolvedValue([
      { normalizedName: 'green beans cooked', aliases: ['green beans'], ingredient: ING('Green beans, cooked', { fb: 2.7 }) },
      CATALOG[1],
    ]);
    const r = await sequenceMeal([{ name: 'green beans', amountG: 100 }, { name: 'rice', amountG: 200 }]);
    expect(r.order[0].role).toBe('non_starchy_veg');
  });
});
