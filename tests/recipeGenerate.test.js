// Phase 4+8: AI recipe generation through the deterministic validation
// pipeline — candidates are validated independently; retry budget is bounded;
// verified-recipe fallback; NO_ELIGIBLE_RECIPE is a first-class outcome.
jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn() }));
jest.mock('../src/lib/prisma', () => { const db = {
  userAllergy: { findMany: jest.fn(async () => []) },
  userHealthCondition: { findMany: jest.fn(async () => []) },
  foodPreference: { findMany: jest.fn(async () => []) },
  userPlanningPreferences: { findUnique: jest.fn(async () => null) },
  foodInventory: { findMany: jest.fn(async () => []) },
  macroGoal: { findUnique: jest.fn(async () => null) },
  ingredientCatalog: { findMany: jest.fn() },
  recipe: { findMany: jest.fn(async () => []) },
  ingredientAttribute: { findMany: jest.fn(async () => []) },
}; return { getPrisma: () => db }; });

const request = require('supertest');
const app = require('../src/app');
const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();
const { generateRecipes } = require('../src/services/recipes/generate');
const { askJSON } = require('../src/services/aiProvider');

jest.setTimeout(30000);

const ing = (id, name) => ({ id, name, caloriesPer100g: 100, proteinPer100g: 5, carbsPer100g: 20, fatPer100g: 2, fiberPer100g: 2, attributes: [] });
const cat = (id, name, { aliases = [], category = 'Vegetable', allergens = null, ingredientId = null } = {}) => ({
  id, identityKey: name.replace(/\s+/g, '_'), name, normalizedName: name, aliases, category,
  sourceRecord: allergens ? { allergens } : null, usable: true,
  ingredient: ingredientId ? ing(ingredientId, name) : null,
});

const CATALOG = [
  cat('c_rice', 'rice', { category: 'Grain', ingredientId: 'i_rice' }),
  cat('c_tom', 'tomato', { ingredientId: 'i_tom' }),
  cat('c_chick', 'chicken breast', { aliases: ['chicken'], category: 'Animal protein', ingredientId: 'i_chick' }),
  cat('c_pb', 'peanut butter', { category: 'Spreads', allergens: ['peanuts'], ingredientId: 'i_pb' }),
];

const cand = (name, lines, instructions) => ({
  name, description: `${name} description`, servings: 2, estimatedMinutes: 20, mealType: 'dinner',
  ingredients: lines, instructions, missingIngredients: [], substitutions: [],
});

const GOOD_CANDIDATE = cand('Tomato Rice', [
  { ingredientName: 'rice', amountG: 150, unit: 'g', optional: false },
  { ingredientName: 'tomato', amountG: 100, unit: 'g', optional: false },
], ['Cook rice until tender.', 'Chop tomato and fold through.']);

const PEANUT_CANDIDATE = cand('Peanut Bowl', [
  { ingredientName: 'rice', amountG: 150, unit: 'g', optional: false },
  { ingredientName: 'peanut butter', amountG: 30, unit: 'g', optional: false },
], ['Cook rice.', 'Stir in peanut butter.']);

function profile({ allergies = [], prefs = [], restrictions = null } = {}) {
  prisma.userAllergy.findMany.mockResolvedValue(allergies.map((name) => ({ allergy: { name } })));
  prisma.foodPreference.findMany.mockResolvedValue(prefs);
  prisma.userPlanningPreferences.findUnique.mockResolvedValue(restrictions ? { dietaryRestrictions: restrictions } : null);
  prisma.ingredientCatalog.findMany.mockResolvedValue(CATALOG);
}

describe('generateRecipes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('clean candidates pass validation and carry recomputed nutrition', async () => {
    profile();
    askJSON.mockResolvedValue({ candidates: [GOOD_CANDIDATE], notes: '' });
    const out = await generateRecipes({ userId: 'u1', items: [{ name: 'rice' }, { name: 'tomato' }] });
    expect(out.status).toBe('ok');
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].validation.status).toBe('PASS');
    expect(out.candidates[0].nutrition.perServing.calories).toBeGreaterThan(0);
    expect(out.candidates[0].provenance.source).toBe('ai_generated');
    expect(askJSON).toHaveBeenCalledTimes(1);
  });

  test('allergic user: AI-proposed allergen is rejected, clean sibling survives', async () => {
    profile({ allergies: ['Peanuts'] });
    askJSON.mockResolvedValue({ candidates: [PEANUT_CANDIDATE, GOOD_CANDIDATE], notes: '' });
    const out = await generateRecipes({ userId: 'u1', items: [{ name: 'rice' }] });
    expect(out.status).toBe('ok');
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].name).toBe('Tomato Rice');
    expect(out.rejected[0].ruleIds.join(' ')).toMatch(/ALLERGEN/);
  });

  test('total failure triggers ONE correction attempt, then usable result', async () => {
    profile({ allergies: ['Peanuts'] });
    askJSON
      .mockResolvedValueOnce({ candidates: [PEANUT_CANDIDATE], notes: '' })
      .mockResolvedValueOnce({ candidates: [GOOD_CANDIDATE], notes: '' });
    const out = await generateRecipes({ userId: 'u1', items: [{ name: 'rice' }] });
    expect(askJSON).toHaveBeenCalledTimes(2);
    expect(out.meta.retries).toBe(1);
    expect(out.status).toBe('ok');
    expect(out.candidates[0].name).toBe('Tomato Rice');
    // Failed ruleIds are fed back into the correction prompt.
    expect(askJSON.mock.calls[1][3]).toMatch(/ALLERGEN/);
  });

  test('persistent failure falls back to a VERIFIED recipe, never unvalidated AI output', async () => {
    profile({ allergies: ['Peanuts'] });
    askJSON.mockResolvedValue({ candidates: [PEANUT_CANDIDATE], notes: '' });
    prisma.recipe.findMany.mockResolvedValue([{
      id: 'r_ver', recipeName: 'Verified Rice', isSystem: true, reviewStatus: 'VERIFIED', allergens: [],
      ingredients: [{ ingredientId: 'i_rice', ingredientName: 'rice', amountG: 150, optional: false }],
    }]);
    const out = await generateRecipes({ userId: 'u1', items: [{ name: 'rice' }] });
    expect(out.status).toBe('ok');
    expect(out.candidates).toHaveLength(0);
    expect(out.fallback).toHaveLength(1);
    expect(out.fallback[0].source).toBe('verified_fallback');
    expect(out.rejected.length).toBeGreaterThan(0);
  });

  test('provider outage + no eligible recipe → no_eligible_recipe with reason', async () => {
    profile({ allergies: ['Peanuts'] });
    const err = new Error('down'); err.status = 503;
    askJSON.mockRejectedValue(err);
    prisma.recipe.findMany.mockResolvedValue([]);
    const out = await generateRecipes({ userId: 'u1', items: [{ name: 'rice' }] });
    expect(out.status).toBe('no_eligible_recipe');
    expect(out.reason).toMatch(/not relaxed/i);
    expect(out.meta.providerError.status).toBe(503);
  });

  test('exclusions are hard — AI proposal containing excluded food is rejected, not relaxed', async () => {
    profile({ prefs: [{ foodName: 'tomato', preference: 'NEVER_RECOMMEND' }] });
    askJSON.mockResolvedValue({ candidates: [GOOD_CANDIDATE], notes: '' });
    prisma.recipe.findMany.mockResolvedValue([]);
    const out = await generateRecipes({ userId: 'u1', items: [{ name: 'rice' }] });
    expect(out.candidates).toHaveLength(0);
    expect(out.rejected[0].ruleIds).toContain('EXCLUDED_TERM');
  });
});

describe('POST /recipes/generate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('flag-gated route returns validated candidates', async () => {
    profile();
    askJSON.mockResolvedValue({ candidates: [GOOD_CANDIDATE], notes: '' });
    const res = await request(app).post('/recipes/generate')
      .set('x-user-id', 'u1')
      .send({ items: [{ name: 'rice' }, { name: 'tomato' }], servings: 2 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.candidates[0].nutrition.perServing.calories).toBeGreaterThan(0);
  });

  test('missing userId → 401', async () => {
    const res = await request(app).post('/recipes/generate').send({});
    expect(res.status).toBe(401);
  });
});
