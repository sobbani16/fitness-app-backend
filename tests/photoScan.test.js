jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn(), aiEnabled: jest.fn(() => true) }));

const request = require('supertest');
const app = require('../src/app');
const { getPrisma } = require('../src/lib/prisma');
const { askJSON } = require('../src/services/aiProvider');
const { sanitizeDetectedFoods } = require('../src/services/foodDetector');
const { matchDetectedFood, coverage } = require('../src/services/photoRecipeMatcher');
const { computeMealNutrition } = require('../src/services/mealNutrition');

jest.setTimeout(30000);

const uid = `ps-user-${Date.now()}`;
const prisma = getPrisma();
const T = Date.now();
let ingRice, ingChicken, ingOil, recipe;

const aiFlat = { identifiable: true, foodName: 'Rice and curry', caloriesPer100g: 130, suggestedPortionGrams: 300, protein: 6, carbs: 20, fat: 4, confidence: 0.55, uncertainty: 'Portion unclear.' };
const aiStructured = {
  ...aiFlat, foodName: 'Chicken biryani plate',
  detectedFoods: [
    {
      foodName: `Ps Biryani ${T}`, foodCategory: 'rice dish', cuisineCandidates: ['Indian', 'Hyderabadi'],
      preparationCandidates: ['layered', 'steamed'],
      visibleIngredients: [{ name: `sk rice ${T}`, confidence: 0.9 }, { name: `sk chicken ${T}`, confidence: 0.8 }],
      possibleHiddenIngredients: [`sk oil ${T}`, 'salt', 'spices'], portionGrams: 350, portionNote: 'single serving',
      uncertainty: 'oil and spice quantities invisible',
    },
    {
      foodName: 'Side salad', foodCategory: 'salad', cuisineCandidates: [], preparationCandidates: ['raw'],
      visibleIngredients: [{ name: 'lettuce', confidence: 0.7 }], possibleHiddenIngredients: ['dressing'],
      portionGrams: 60, portionNote: '', uncertainty: 'dressing unknown',
    },
  ],
  needsClarification: ['Was the chicken cooked in oil or ghee?'],
};

beforeAll(async () => {
  await prisma.user.create({ data: { id: uid, email: `${uid}@t.dev` } }).catch(() => {});
  const mkCat = async (name, per100) => {
    const cat = await prisma.ingredientCatalog.create({ data: {
      id: `psc_${name.replace(/\W+/g, '_')}_${T}`, name, normalizedName: name,
      aliases: [], category: 'Protein', preparation: 'cooked',
      status: 'GENERIC_COMPOSITION', usable: true, verificationLevel: 'GENERIC_COMPOSITION',
      sourceRecord: { id: name },
      ingredient: { create: { name, normalizedName: name, source: 'humai-catalog', ...per100 } },
    } });
    return prisma.ingredient.findUnique({ where: { catalogId: cat.id } });
  };
  ingRice = await mkCat(`sk rice ${T}`, { caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3, fiberPer100g: 0.4 });
  ingChicken = await mkCat(`sk chicken ${T}`, { caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, fiberPer100g: null });
  ingOil = await mkCat(`sk oil ${T}`, { caloriesPer100g: 884, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 100, fiberPer100g: 0 });
  recipe = await prisma.recipe.create({ data: {
    recipeName: `Ps Biryani ${T}`, creatorId: 'system', isSystem: true, cuisine: 'Indian', region: 'Hyderabadi',
    servings: 2, reviewStatus: 'RESEARCH_DRAFT', sourceKey: `PS-${T}-a`,
    calories: 550, proteinG: 30, carbsG: 60, fatG: 18,
    ingredients: { create: [
      { ingredientId: ingRice.id, ingredientName: ingRice.name, amountG: 300 },
      { ingredientId: ingChicken.id, ingredientName: ingChicken.name, amountG: 200 },
      { ingredientId: ingOil.id, ingredientName: ingOil.name, amountG: 20 },
      { ingredientName: 'Spice blend', amountG: 10, optional: true },
    ] },
  } });
});

const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

describe('detectFood structured output', () => {
  beforeEach(() => askJSON.mockResolvedValue(aiStructured));

  it('returns detectionVersion 2, structured foods and clarification prompts', async () => {
    const res = await request(app).post('/meals/detect').set('x-user-id', uid).send({ imageDataUrl: photo, hasPhoto: true });
    expect(res.status).toBe(200);
    expect(res.body.detectionVersion).toBe(2);
    expect(res.body.detectedFoods).toHaveLength(2);
    expect(res.body.needsClarification[0]).toMatch(/oil or ghee/i);
    const biryani = res.body.detectedFoods[0];
    expect(biryani.possibleHiddenIngredients).toContain(`sk oil ${T}`);
    // Deterministic local recipe match — no second AI call.
    expect(biryani.recipeMatches[0]).toMatchObject({ recipeId: recipe.id, name: `Ps Biryani ${T}`, reviewStatus: 'RESEARCH_DRAFT', nutritionLevel: 'ESTIMATED' });
    expect(biryani.recipeMatches[0].ingredients.map((i) => i.name)).toContain(ingOil.name);
    expect(biryani.recipeMatches[0].visuallyConfirmedIngredients).toEqual(expect.arrayContaining([`sk rice ${T}`]));
    expect(askJSON).toHaveBeenCalledTimes(1);
  });

  it('v1 provider output stays backward compatible', async () => {
    askJSON.mockResolvedValue(aiFlat);
    const res = await request(app).post('/meals/detect').set('x-user-id', uid).send({ description: 'rice and curry' });
    expect(res.status).toBe(200);
    expect(res.body.detectionVersion).toBe(1);
    expect(res.body.detectedFoods).toBeUndefined();
  });

  it('feature gate rejects when disabled', async () => {
    const { resetCache } = require('../src/services/featureFlags/service');
    process.env.FF_FOOD_PHOTO_SCANNING = 'false';
    resetCache();
    askJSON.mockClear();
    const res = await request(app).post('/meals/detect').set('x-user-id', uid).send({ imageDataUrl: photo, hasPhoto: true });
    delete process.env.FF_FOOD_PHOTO_SCANNING;
    resetCache();
    expect(res.status).toBe(403);
    expect(askJSON).not.toHaveBeenCalled();
  });
});

describe('sanitizeDetectedFoods', () => {
  it('drops malformed entries, clamps counts and bounds quantities', () => {
    const foods = [
      { foodName: 'x'.repeat(500), portionGrams: 999999, visibleIngredients: [{ name: 'ok', confidence: 5 }] },
      ...Array.from({ length: 8 }, (_, i) => ({ foodName: `dish ${i}`, portionGrams: 100 })),
      { foodName: '' }, null,
    ];
    const out = sanitizeDetectedFoods(foods);
    expect(out).toHaveLength(6);
    expect(out[0].portionGrams).toBeNull();
    expect(out[0].visibleIngredients[0].confidence).toBe(1);
    expect(out[0].foodName).toHaveLength(200);
    expect(out.every((f) => f.foodName)).toBe(true);
  });
  it('non-array input yields empty', () => expect(sanitizeDetectedFoods('x')).toEqual([]));
});

describe('photoRecipeMatcher', () => {
  it('ranks exact dish name with coverage reasons and draft label', async () => {
    const matches = await matchDetectedFood({
      foodName: `Ps Biryani ${T}`, cuisineCandidates: ['indian'],
      visibleIngredients: [{ name: `sk rice ${T}` }, { name: `sk chicken ${T}` }],
    }, uid);
    expect(matches[0].recipeId).toBe(recipe.id);
    expect(matches[0].reasons.join(' ')).toMatch(/exact dish name/);
    expect(matches[0].reasons.join(' ')).toMatch(/research draft/i);
    expect(matches[0].visuallyConfirmedIngredients).toContain(`sk rice ${T}`);
  });

  it('returns no candidates for unrelated dishes and never sees other users’ recipes', async () => {
    expect(await matchDetectedFood({ foodName: 'zznope' }, uid)).toEqual([]);
    await prisma.user.create({ data: { id: 'ps-other', email: 'ps-other@t.dev' } }).catch(() => {});
    const mine = await prisma.recipe.create({ data: { recipeName: `Ps Private ${T}`, creatorId: 'ps-other', isSystem: false } });
    const out = await matchDetectedFood({ foodName: `Ps Private ${T}` }, uid);
    expect(out.find((m) => m.recipeId === mine.id)).toBeUndefined();
    const own = await matchDetectedFood({ foodName: `Ps Private ${T}` }, 'ps-other');
    expect(own[0]?.recipeId).toBe(mine.id);
  });

  it('coverage matches normalized/plural-ish labels without fabricating hits', () => {
    const lines = [{ ingredientName: 'Basmati Rice' }, { ingredientName: 'Ghee' }];
    expect(coverage(lines, ['basmati rice', 'unobtainium']).covered).toEqual(['basmati rice']);
    expect(coverage(lines, []).ratio).toBe(0);
  });
});

describe('computeMealNutrition', () => {
  it('computes totals from per-100g lines including oil edits; fiber stays honest', async () => {
    const res = await computeMealNutrition(uid, { items: [
      { ingredientId: ingRice.id, amountG: 150 },
      { name: `sk oil ${T}`, amountG: 10 },
    ] });
    // rice 150g → 195cal; oil 10g → 88.4cal
    expect(res.totals.calories).toBe(283);
    expect(res.lines.find((l) => l.name === ingOil.name).fat_g).toBe(10);
    expect(res.fiberComplete).toBe(true); // rice + oil both have source-known fiber
    expect(res.unresolved).toEqual([]);
  });

  it('halving oil halves fat contribution', async () => {
    const a = await computeMealNutrition(uid, { items: [{ ingredientId: ingOil.id, amountG: 20 }] });
    const b = await computeMealNutrition(uid, { items: [{ ingredientId: ingOil.id, amountG: 10 }] });
    expect(a.totals.fat_g).toBeCloseTo(b.totals.fat_g * 2, 1);
  });

  it('keeps null fiber honest and reports unresolved names', async () => {
    const res = await computeMealNutrition(uid, { items: [
      { ingredientId: ingChicken.id, amountG: 100 }, { name: 'unobtainium spice', amountG: 5 },
    ] });
    expect(res.lines[0].fiber_g).toBeNull();
    expect(res.lines[0].fiberKnown).toBe(false);
    expect(res.unresolved).toEqual([{ name: 'unobtainium spice', amountG: 5 }]);
    expect(res.provenance).toMatch(/partial/);
  });

  it('rejects invalid payloads', async () => {
    const cases = [
      { items: [] },
      { items: [{ ingredientId: ingRice.id, amountG: 0 }] },
      { items: [{ ingredientId: ingRice.id, amountG: 99999 }] },
      { items: [{ ingredientId: 'nope-id', amountG: 10 }] },
      { items: Array.from({ length: 51 }, () => ({ name: 'x', amountG: 1 })) },
    ];
    for (const body of cases) await expect(computeMealNutrition(uid, body)).rejects.toMatchObject({ status: 400 });
  });

  it('endpoint computes without touching AI quota or provider', async () => {
    askJSON.mockClear();
    const res = await request(app).post('/meals/ingredient-nutrition').set('x-user-id', uid)
      .send({ items: [{ ingredientId: ingChicken.id, amountG: 100 }] });
    expect(res.status).toBe(200);
    expect(res.body.totals.calories).toBe(165);
    expect(askJSON).not.toHaveBeenCalled();
  });
});
