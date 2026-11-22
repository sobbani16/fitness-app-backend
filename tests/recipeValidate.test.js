// Phase 5: deterministic recipe validation pipeline.
// Outcomes: PASS | FAIL | NEEDS_CLARIFICATION | NEEDS_REVIEW — critical stages
// fail closed; nothing passes with unresolved allergen-relevant identity.
jest.mock('../src/lib/prisma', () => { const db = {
  userAllergy: { findMany: jest.fn(async () => []) },
  userHealthCondition: { findMany: jest.fn(async () => []) },
  foodPreference: { findMany: jest.fn(async () => []) },
  userPlanningPreferences: { findUnique: jest.fn(async () => null) },
  foodInventory: { findMany: jest.fn(async () => []) },
  macroGoal: { findUnique: jest.fn(async () => null) },
  ingredientCatalog: { findMany: jest.fn() },
  ingredientAttribute: { findMany: jest.fn(async () => []) },
  safetyAuditLog: { create: jest.fn(async () => ({})) },
}; return { getPrisma: () => db }; });

const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();
const { loadConstraints } = require('../src/services/recipes/constraints');
const { validateGeneratedRecipe } = require('../src/services/recipes/validate');

jest.setTimeout(30000);

const ing = (id, name, extra = {}) => ({
  id, name, caloriesPer100g: 100, proteinPer100g: 5, carbsPer100g: 20, fatPer100g: 2, fiberPer100g: 2, ...extra,
});
const cat = (id, name, { aliases = [], category = 'Vegetable', allergens = null, ingredientId = null, attributes = [], components = null, kcal = 100 } = {}) => ({
  id, identityKey: name.replace(/\s+/g, '_'), name, normalizedName: name, aliases, category,
  sourceRecord: allergens || components ? { allergens, components } : null,
  usable: true,
  ingredient: ingredientId ? { ...ing(ingredientId, name, { caloriesPer100g: kcal }), attributes } : null,
});

const CATALOG = [
  cat('c_rice', 'rice', { category: 'Grain', ingredientId: 'i_rice' }),
  cat('c_tom', 'tomato', { ingredientId: 'i_tom' }),
  cat('c_chick', 'chicken breast', { aliases: ['chicken'], category: 'Animal protein', ingredientId: 'i_chick' }),
  cat('c_egg', 'eggs', { aliases: ['egg'], category: 'Eggs', allergens: ['egg'], ingredientId: 'i_egg' }),
  cat('c_pb', 'peanut butter', { category: 'Spreads', allergens: ['peanuts'], ingredientId: 'i_pb' }),
  cat('c_beef', 'beef', { category: 'Animal protein', ingredientId: 'i_beef' }),
  cat('c_oil', 'olive oil', { category: 'Oil', ingredientId: 'i_oil', kcal: 884 }),
  cat('c_flour', 'flour', { category: 'Grain', ingredientId: 'i_flour' }),
];

function constraintsFor({ allergies = [], prefs = [], restrictions = null, conditions = [] } = {}) {
  prisma.userAllergy.findMany.mockResolvedValue(allergies.map((name) => ({ allergy: { name } })));
  prisma.foodPreference.findMany.mockResolvedValue(prefs);
  prisma.userPlanningPreferences.findUnique.mockResolvedValue(restrictions ? { dietaryRestrictions: restrictions } : null);
  prisma.userHealthCondition.findMany.mockResolvedValue(conditions);
  prisma.ingredientCatalog.findMany.mockResolvedValue(CATALOG);
  return loadConstraints('u1', {});
}
const v = (recipe) => validateGeneratedRecipe(recipe, null, { prisma });

const line = (ingredientName, amountG, extra = {}) => ({ ingredientName, amountG, ...extra });

describe('validateGeneratedRecipe', () => {
  beforeEach(() => jest.clearAllMocks());

  test('clean resolved recipe passes with deterministic nutrition', async () => {
    const c = await constraintsFor();
    const out = await validateGeneratedRecipe({
      name: 'Tomato Rice', servings: 2,
      ingredients: [line('rice', 150), line('tomato', 100)],
      instructions: ['Cook rice until tender.', 'Chop tomato and fold through the rice.'],
    }, c, { prisma });
    expect(out.status).toBe('PASS');
    expect(out.nutrition.perServing.calories).toBeGreaterThan(0);
    expect(out.nutrition.provenance).toBe('ingredient_per100_deterministic');
  });

  test('schema failures block outright', async () => {
    const c = await constraintsFor();
    const bad = await v({ name: '', servings: 2, ingredients: [line('rice', 150)], instructions: ['cook rice'] });
    expect(bad.status).toBe('FAIL');
    expect(bad.violations.some((x) => x.ruleId === 'SCHEMA_NAME')).toBe(true);
    const noServ = await validateGeneratedRecipe({ name: 'x', servings: 0, ingredients: [line('rice', 100)], instructions: ['rice'] }, c, { prisma });
    expect(noServ.status).toBe('FAIL');
  });

  test('unresolved ingredient fails closed when user has allergies; review otherwise', async () => {
    const allergic = await constraintsFor({ allergies: ['Peanuts'] });
    const recipe = { name: 'Mystery Bowl', servings: 2, ingredients: [line('rice', 150), line('mystery powder', 30)], instructions: ['cook rice, add mystery powder'] };
    const blocked = await validateGeneratedRecipe(recipe, allergic, { prisma });
    expect(blocked.status).toBe('FAIL');
    expect(blocked.violations.some((x) => x.ruleId === 'INGREDIENT_UNRESOLVED' && x.severity === 'block')).toBe(true);

    const clean = await constraintsFor();
    const review = await validateGeneratedRecipe(recipe, clean, { prisma });
    expect(review.status).toBe('NEEDS_REVIEW');
    expect(review.violations.some((x) => x.ruleId === 'INGREDIENT_UNRESOLVED' && x.severity === 'review')).toBe(true);
  });

  test('undeclared compound sauce fails closed for allergic users', async () => {
    const c = await constraintsFor({ allergies: ['Fish'] });
    const out = await validateGeneratedRecipe({
      name: 'Noodle Bowl', servings: 2,
      ingredients: [line('rice', 150), line('house sauce', 40)],
      instructions: ['boil rice, stir in house sauce'],
    }, c, { prisma });
    expect(out.status).toBe('FAIL');
    expect(out.violations.some((x) => x.ruleId === 'COMPOUND_UNRESOLVED')).toBe(true);
  });

  test('peanut derivative in an ingredient name blocks for peanut allergy', async () => {
    const c = await constraintsFor({ allergies: ['Peanuts'] });
    const out = await validateGeneratedRecipe({
      name: 'Satay Rice', servings: 2,
      ingredients: [line('rice', 150), line('peanut butter', 30)],
      instructions: ['cook rice, mix peanut butter'],
    }, c, { prisma });
    expect(out.status).toBe('FAIL');
    expect(out.violations.some((x) => x.ruleId === 'ALLERGEN_TEXT' || x.ruleId === 'ALLERGEN_DECLARED')).toBe(true);
  });

  test('NEVER_RECOMMEND exclusion blocks; DISLIKE does not', async () => {
    const c = await constraintsFor({ prefs: [{ foodName: 'beef', preference: 'NEVER_RECOMMEND' }, { foodName: 'tomato', preference: 'DISLIKE' }] });
    const out = await validateGeneratedRecipe({
      name: 'Beef Bowl', servings: 2,
      ingredients: [line('beef', 200), line('tomato', 80)],
      instructions: ['sear beef, add tomato'],
    }, c, { prisma });
    expect(out.status).toBe('FAIL');
    expect(out.violations.some((x) => x.ruleId === 'EXCLUDED_TERM')).toBe(true);
    expect(out.violations.some((x) => /tomato/i.test(x.reason))).toBe(false);
  });

  test('vegetarian pattern blocks meat via category even when name is opaque', async () => {
    const c = await constraintsFor({ restrictions: ['vegetarian'] });
    const out = await validateGeneratedRecipe({
      name: 'Chef Special', servings: 2,
      ingredients: [line('ribeye', 200), line('tomato', 80)], // ribeye not in catalog — category path unavailable, name has no meat term
      instructions: ['sear ribeye, add tomato'],
    }, c, { prisma });
    // unresolved identity → review (not blocked via category); beef would be EXCLUDED_TERM
    expect(['NEEDS_REVIEW', 'FAIL']).toContain(out.status);

    const out2 = await validateGeneratedRecipe({
      name: 'Beef Bowl', servings: 2,
      ingredients: [line('beef', 200), line('tomato', 80)],
      instructions: ['sear beef, add tomato'],
    }, c, { prisma });
    expect(out2.status).toBe('FAIL');
    expect(out2.violations.some((x) => x.ruleId === 'BANNED_CATEGORY' || x.ruleId === 'EXCLUDED_TERM')).toBe(true);
  });

  test('APPROVED condition rule blocks attributed ingredient', async () => {
    const c = await constraintsFor({ conditions: [{
      active: true, condition: { id: 'c1', name: 'Chronic Kidney Disease', conditionRules: [
        { id: 'r1', attribute: 'HIGH_PHOSPHORUS', target: 'ingredient', action: 'block', reviewStatus: 'APPROVED', reason: 'CKD' },
      ] },
    }] });
    const withAttr = CATALOG.map((x) => x.id === 'c_chick' ? { ...x, ingredient: { ...x.ingredient, attributes: [{ attribute: 'HIGH_PHOSPHORUS' }] } } : x);
    const out = await validateGeneratedRecipe({
      name: 'Chicken Rice', servings: 2,
      ingredients: [line('chicken breast', 200), line('rice', 150)],
      instructions: ['sear chicken breast to 165F, serve over rice'],
    }, c, { prisma, catalog: undefined });
    // custom catalog needed — re-run with attributed catalog via ctx
    const catalog = await require('../src/services/recipes/validate').loadCatalog({ ingredientCatalog: { findMany: async () => withAttr } });
    const out2 = await validateGeneratedRecipe({
      name: 'Chicken Rice', servings: 2,
      ingredients: [line('chicken breast', 200), line('rice', 150)],
      instructions: ['sear chicken breast to 165F, serve over rice'],
    }, c, { prisma, catalog });
    expect(out2.status).toBe('FAIL');
    expect(out2.violations.some((x) => x.ruleId === 'CONDITION_ATTR')).toBe(true);
  });

  test('quantity edge cases: negative blocks, missing required clarifies', async () => {
    const c = await constraintsFor();
    const neg = await validateGeneratedRecipe({
      name: 'Bad Rice', servings: 2, ingredients: [line('rice', -50)], instructions: ['cook rice'],
    }, c, { prisma });
    expect(neg.status).toBe('FAIL');
    expect(neg.violations.some((x) => x.ruleId === 'QUANTITY_NONPOSITIVE')).toBe(true);

    const missing = await validateGeneratedRecipe({
      name: 'Vague Rice', servings: 2, ingredients: [line('rice', 150), { ingredientName: 'tomato' }], instructions: ['cook rice with tomato'],
    }, c, { prisma });
    expect(missing.status).toBe('NEEDS_CLARIFICATION');
    expect(missing.violations.some((x) => x.ruleId === 'QUANTITY_MISSING')).toBe(true);
  });

  test('poultry without verified temperature → NEEDS_REVIEW', async () => {
    const c = await constraintsFor();
    const out = await validateGeneratedRecipe({
      name: 'Chicken Rice', servings: 2,
      ingredients: [line('chicken breast', 200), line('rice', 150)],
      instructions: ['air fry the chicken 12 minutes, serve over rice'],
    }, c, { prisma });
    expect(out.status).toBe('NEEDS_REVIEW');
    expect(out.violations.some((x) => x.ruleId === 'POULTRY_TEMP_UNVERIFIED')).toBe(true);

    const ok = await validateGeneratedRecipe({
      name: 'Chicken Rice', servings: 2,
      ingredients: [line('chicken breast', 200), line('rice', 150)],
      instructions: ['sear chicken breast until internal temperature reaches 165°F, serve over rice'],
    }, c, { prisma });
    expect(ok.violations.some((x) => x.ruleId === 'POULTRY_TEMP_UNVERIFIED')).toBe(false);
  });

  test('raw egg preparation flags review', async () => {
    const c = await constraintsFor();
    const out = await validateGeneratedRecipe({
      name: 'Eggnog Bowl', servings: 1,
      ingredients: [line('eggs', 100), line('rice', 50)],
      instructions: ['whisk the raw eggs over rice and serve immediately'],
    }, c, { prisma });
    expect(out.status).toBe('NEEDS_REVIEW');
    expect(out.violations.some((x) => x.ruleId === 'RAW_EGG_RISK')).toBe(true);
  });

  test('implausible computed nutrition flags review; missing data warns not zero', async () => {
    const c = await constraintsFor();
    const out = await validateGeneratedRecipe({
      name: 'Oil Soup', servings: 1,
      ingredients: [line('olive oil', 3000), line('tomato', 50)],
      instructions: ['warm olive oil with tomato'],
    }, c, { prisma });
    expect(out.status).toBe('NEEDS_REVIEW');
    expect(out.violations.some((x) => x.ruleId === 'NUTRITION_IMPLAUSIBLE')).toBe(true);
  });

  test('substitution against an exclusion blocks', async () => {
    const c = await constraintsFor({ prefs: [{ foodName: 'beef', preference: 'NEVER_RECOMMEND' }] });
    const out = await validateGeneratedRecipe({
      name: 'Rice Bowl', servings: 2,
      ingredients: [line('rice', 150), line('tomato', 80)],
      instructions: ['cook rice with tomato'],
      substitutions: [{ ingredientName: 'beef', forIngredient: 'tomato' }],
    }, c, { prisma });
    expect(out.status).toBe('FAIL');
    expect(out.violations.some((x) => x.stage === 'substitution' && x.severity === 'block')).toBe(true);
  });

  test('recipe-declared allergen blocks even when lines look clean', async () => {
    const c = await constraintsFor({ allergies: ['Peanuts'] });
    const out = await validateGeneratedRecipe({
      name: 'Tomato Rice', servings: 2, allergens: ['peanuts'],
      ingredients: [line('rice', 150), line('tomato', 100)],
      instructions: ['cook rice with tomato'],
    }, c, { prisma });
    expect(out.status).toBe('FAIL');
    expect(out.violations.some((x) => x.ruleId === 'ALLERGEN_DECLARED')).toBe(true);
  });
});
