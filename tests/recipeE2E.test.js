// E2E (mocked-provider): profile → constraints → generate → validate →
// save-generated → customize → revalidate. Scenario E2E-001.
jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn() }));
jest.mock('../src/lib/prisma', () => { const db = {
  userAllergy: { findMany: jest.fn() },
  userHealthCondition: { findMany: jest.fn(async () => []) },
  foodPreference: { findMany: jest.fn(async () => []) },
  userPlanningPreferences: { findUnique: jest.fn(async () => null) },
  foodInventory: { findMany: jest.fn(async () => []) },
  macroGoal: { findUnique: jest.fn(async () => null) },
  ingredientCatalog: { findMany: jest.fn() },
  recipe: { findMany: jest.fn(async () => []), findFirst: jest.fn(), create: jest.fn() },
  recipeIngredient: { createMany: jest.fn() },
  ingredientAttribute: { findMany: jest.fn(async () => []) },
  safetyAuditLog: { create: jest.fn(async () => ({})) },
}; return { getPrisma: () => db }; });

const request = require('supertest');
const app = require('../src/app');
const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();
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
  cat('c_pb', 'peanut butter', { category: 'Spreads', allergens: ['peanuts'], ingredientId: 'i_pb' }),
  cat('c_cil', 'cilantro', { ingredientId: 'i_cil' }),
];

const GOOD = {
  name: 'Tomato Rice', description: 'Simple bowl', servings: 2, estimatedMinutes: 20, mealType: 'dinner',
  ingredients: [
    { ingredientName: 'rice', amountG: 150, unit: 'g', optional: false },
    { ingredientName: 'tomato', amountG: 100, unit: 'g', optional: false },
  ],
  instructions: ['Cook rice until tender.', 'Chop tomato and fold through the cooked rice.'],
  missingIngredients: [], substitutions: [],
};

describe('E2E: generate → save → customize under an allergy profile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.userAllergy.findMany.mockResolvedValue([{ allergy: { name: 'Peanuts' } }]);
    prisma.ingredientCatalog.findMany.mockResolvedValue(CATALOG);
  });

  test('full flow: clean candidate validates, saves as RESEARCH_DRAFT, customize revalidates', async () => {
    // 1. generate
    askJSON.mockResolvedValueOnce({ candidates: [GOOD], notes: '' });
    const gen = await request(app).post('/recipes/generate')
      .set('x-user-id', 'u-allergic')
      .send({ items: [{ name: 'rice' }, { name: 'tomato' }], servings: 2 });
    expect(gen.status).toBe(200);
    expect(gen.body.candidates).toHaveLength(1);
    expect(gen.body.candidates[0].validation.status).toBe('PASS');

    // 2. save-generated — server revalidates; persists as RESEARCH_DRAFT
    prisma.recipe.create.mockResolvedValueOnce({
      id: 'saved1', recipeName: 'Tomato Rice · ai-abcdef12', servings: 2, reviewStatus: 'RESEARCH_DRAFT', sourceKey: 'ai:u-allergic:x',
    });
    const save = await request(app).post('/recipes/save-generated')
      .set('x-user-id', 'u-allergic')
      .send({ candidate: GOOD });
    expect(save.status).toBe(201);
    expect(save.body.recipe.reviewStatus).toBe('RESEARCH_DRAFT');
    const createArg = prisma.recipe.create.mock.calls[0][0].data;
    expect(createArg.creatorId).toBe('u-allergic');
    expect(createArg.reviewStatus).toBe('RESEARCH_DRAFT');
    expect(createArg.nutritionSource.kind).toBe('AI_GENERATED_VALIDATED');
    expect(createArg.ingredients.create).toHaveLength(2);
    expect(createArg.ingredients.create[0].ingredientId).toBe('i_rice');

    // 3. customize — AI proposes a peanut add: rejected by profile allergy
    prisma.recipe.findFirst.mockResolvedValueOnce({
      id: 'saved1', recipeName: 'Tomato Rice · ai-abcdef12', servings: 2, isSystem: false, reviewStatus: 'RESEARCH_DRAFT',
      allergens: [], finishedYieldG: null, portionG: null,
      ingredients: [
        { ingredientId: 'i_rice', ingredientName: 'rice', amountG: 150, optional: false },
        { ingredientId: 'i_tom', ingredientName: 'tomato', amountG: 100, optional: false },
      ],
      instructions: [{ step: 1, text: 'Cook rice.' }],
    });
    askJSON.mockResolvedValueOnce({ changes: [{ action: 'add', ingredientName: 'peanut butter', amountG: 30 }], notes: '' });
    const cust = await request(app).post('/recipes/saved1/customize')
      .set('x-user-id', 'u-allergic')
      .send({ request: 'make it creamy' });
    expect(cust.status).toBe(200);
    expect(cust.body.rejected[0].reason).toMatch(/allergies/i);
    expect(cust.body.proposedLines.some((l) => /peanut/i.test(l.ingredientName))).toBe(false);
    expect(cust.body.provenance.revalidated).toBe(true);
    expect(cust.body.validation).toBeDefined();
  });

  test('save-generated refuses a FAIL candidate (posted status never trusted)', async () => {
    const bad = { ...GOOD, name: 'Peanut Rice', ingredients: [{ ingredientName: 'peanut butter', amountG: 30, unit: 'g', optional: false }] };
    const res = await request(app).post('/recipes/save-generated')
      .set('x-user-id', 'u-allergic')
      .send({ candidate: bad });
    expect(res.status).toBe(422);
    expect(res.body.violations.some((v) => v.ruleId.startsWith('ALLERGEN'))).toBe(true);
    expect(prisma.recipe.create).not.toHaveBeenCalled();
  });

  // ISO-001: a second user with no allergy must not see user A's restrictions,
  // and saved recipes must be creator-scoped — not shared by recipeName.
  test('cross-user isolation: per-user constraints and owner-scoped saves', async () => {
    // User B has no allergy; user A's peanut allergy must not leak into B's run.
    let allergyRows = [{ allergy: { name: 'Peanuts' } }];
    prisma.userAllergy.findMany.mockImplementation(async (args) =>
      args?.where?.userId === 'u-allergic' ? allergyRows : []);

    askJSON.mockResolvedValueOnce({ candidates: [GOOD], notes: '' });
    const genB = await request(app).post('/recipes/generate')
      .set('x-user-id', 'u-clean')
      .send({ items: [{ name: 'rice' }, { name: 'tomato' }], servings: 2 });
    expect(genB.status).toBe(200);
    expect(genB.body.candidates[0].validation.status).toBe('PASS');

    // B saves a recipe — creatorId is B's, not A's; name is disambiguated, not shared.
    prisma.recipe.create.mockResolvedValueOnce({ id: 'savedB', recipeName: 'Tomato Rice · ai-99999999', servings: 2, reviewStatus: 'RESEARCH_DRAFT', sourceKey: 'ai:u-clean:y' });
    const saveB = await request(app).post('/recipes/save-generated')
      .set('x-user-id', 'u-clean')
      .send({ candidate: GOOD });
    expect(saveB.status).toBe(201);
    expect(prisma.recipe.create.mock.calls[0][0].data.creatorId).toBe('u-clean');
    expect(prisma.recipe.create.mock.calls[0][0].data.sourceKey).toContain('u-clean');

    // A's allergy still applies to A — isolation is per-user, not global state.
    const bad = { ...GOOD, ingredients: [{ ingredientName: 'peanut butter', amountG: 30, unit: 'g', optional: false }] };
    const saveA = await request(app).post('/recipes/save-generated')
      .set('x-user-id', 'u-allergic')
      .send({ candidate: bad });
    expect(saveA.status).toBe(422);
  });
});
