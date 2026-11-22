// Recipe constraint engine (Phase 1) — server-authoritative constraint
// loading, boundary-safe term matching, and F-1 regression coverage: profile
// allergies/exclusions apply even when the request omits them.
jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn() }));
jest.mock('../src/lib/prisma', () => { const db = {
  userAllergy: { findMany: jest.fn() },
  userHealthCondition: { findMany: jest.fn() },
  foodPreference: { findMany: jest.fn() },
  userPlanningPreferences: { findUnique: jest.fn() },
  foodInventory: { findMany: jest.fn() },
  macroGoal: { findUnique: jest.fn() },
  ingredientCatalog: { findMany: jest.fn() },
  recipe: { findMany: jest.fn(), findFirst: jest.fn() },
  ingredientAttribute: { findMany: jest.fn() },
}; return { getPrisma: () => db }; });

const request = require('supertest');
const app = require('../src/app');
const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();
const constraints = require('../src/services/recipes/constraints');
const { matchIngredients } = require('../src/services/recipeMatch');
const { askJSON } = require('../src/services/aiProvider');

jest.setTimeout(30000);

// ---- fixtures -------------------------------------------------------------

const ing = (id, name, extra = {}) => ({
  id, name, caloriesPer100g: 100, proteinPer100g: 5, carbsPer100g: 20, fatPer100g: 2, fiberPer100g: 2, ...extra,
});

const cat = (id, name, { aliases = [], category = 'Vegetable', allergens = null, ingredientId = null, attributes = [] } = {}) => ({
  id, identityKey: name.replace(/\s+/g, '_'), name, normalizedName: name, aliases, category,
  sourceRecord: allergens ? { allergens } : null,
  usable: true,
  ingredient: ingredientId ? { ...ing(ingredientId, name), attributes } : null,
});

const line = (ingredientId, ingredientName, amountG, optional = false) => ({ ingredientId, ingredientName, amountG, optional });

const CATALOG = [
  cat('cat_pb', 'peanut butter', { category: 'Spreads', allergens: ['peanuts'], ingredientId: 'ing_pb' }),
  cat('cat_bread', 'bread', { category: 'Bakery', ingredientId: 'ing_bread' }),
  cat('cat_eggp', 'eggplant', { aliases: ['brinjal', 'aubergine'], ingredientId: 'ing_eggp' }),
  cat('cat_tom', 'tomato', { aliases: ['tomatoes'], ingredientId: 'ing_tom' }),
  cat('cat_mush', 'mushroom', { aliases: ['mushrooms'], ingredientId: 'ing_mush' }),
  cat('cat_rice', 'rice', { aliases: ['white rice'], category: 'Grain', ingredientId: 'ing_rice' }),
  cat('cat_chick', 'chicken breast', { aliases: ['chicken'], category: 'Animal protein', ingredientId: 'ing_chick' }),
  cat('cat_rib', 'ribeye', { aliases: ['ribeye steak'], category: 'Animal protein', ingredientId: 'ing_rib' }),
  cat('cat_pot', 'potato', { aliases: ['potatoes'], ingredientId: 'ing_pot' }),
  cat('cat_egg', 'egg', { aliases: ['eggs', 'whole egg'], category: 'Eggs', allergens: ['egg'], ingredientId: 'ing_egg' }),
  cat('cat_cil', 'cilantro', { aliases: ['coriander'], category: 'Herb', ingredientId: 'ing_cil' }),
  cat('cat_ghee', 'ghee', { aliases: ['clarified butter'], category: 'Dairy', allergens: ['milk'], ingredientId: 'ing_ghee' }),
  cat('cat_beef', 'beef', { aliases: ['beef mince'], category: 'Animal protein', ingredientId: 'ing_beef' }),
];

const RECIPES = [
  { id: 'r_pb', recipeName: 'Peanut Butter Toast', isSystem: true, reviewStatus: 'VERIFIED', allergens: ['peanuts'], ingredients: [line('ing_pb', 'peanut butter', 30), line('ing_bread', 'bread', 60)] },
  { id: 'r_eggp', recipeName: 'Eggplant Curry', isSystem: true, reviewStatus: 'SYSTEM', allergens: [], ingredients: [line('ing_eggp', 'eggplant', 300), line('ing_tom', 'tomato', 100)] },
  { id: 'r_mush', recipeName: 'Mushroom Stir Fry', isSystem: true, reviewStatus: 'SYSTEM', allergens: [], ingredients: [line('ing_mush', 'mushroom', 200), line('ing_rice', 'rice', 150)] },
  { id: 'r_chick', recipeName: 'Chicken Curry', isSystem: true, reviewStatus: 'SYSTEM', allergens: [], ingredients: [line('ing_chick', 'chicken breast', 250), line('ing_rice', 'rice', 150)] },
  { id: 'r_steak', recipeName: 'Steak Dinner', isSystem: true, reviewStatus: 'SYSTEM', allergens: [], ingredients: [line('ing_rib', 'ribeye', 200), line('ing_pot', 'potato', 200)] },
  { id: 'r_scramb', recipeName: 'Scrambled Eggs', isSystem: true, reviewStatus: 'SYSTEM', allergens: ['egg'], ingredients: [line('ing_egg', 'eggs', 120), line('ing_bread', 'bread', 60)] },
  { id: 'r_cil', recipeName: 'Cilantro Rice', isSystem: true, reviewStatus: 'SYSTEM', allergens: [], ingredients: [line('ing_cil', 'cilantro', 20), line('ing_rice', 'rice', 150)] },
  { id: 'r_ghee', recipeName: 'Ghee Rice', isSystem: true, reviewStatus: 'SYSTEM', allergens: [], ingredients: [line('ing_ghee', 'ghee', 15), line('ing_rice', 'rice', 150)] },
];

const ALL_ITEMS = ['peanut butter', 'bread', 'eggplant', 'tomato', 'mushroom', 'rice', 'chicken breast', 'ribeye', 'potato', 'egg', 'cilantro', 'ghee'];

function mockProfile({ allergies = [], restrictions = null, prefs = [], conditions = [], macroGoal = null, equipment } = {}) {
  prisma.userAllergy.findMany.mockResolvedValue(allergies.map((name) => ({ allergy: { name } })));
  prisma.userHealthCondition.findMany.mockResolvedValue(conditions);
  prisma.foodPreference.findMany.mockResolvedValue(prefs);
  prisma.userPlanningPreferences.findUnique.mockResolvedValue(
    restrictions || equipment ? { dietaryRestrictions: restrictions || [], availableEquipment: equipment || [] } : null,
  );
  prisma.foodInventory.findMany.mockResolvedValue([]);
  prisma.macroGoal.findUnique.mockResolvedValue(macroGoal);
  prisma.ingredientCatalog.findMany.mockResolvedValue(CATALOG);
  prisma.recipe.findMany.mockResolvedValue(RECIPES);
  prisma.ingredientAttribute.findMany.mockResolvedValue([]);
}

const ids = (out) => out.results.map((r) => r.recipe.id);

// ---- matching primitives --------------------------------------------------

describe('constraints: term matching', () => {
  test('word-boundary: egg matches eggs/egg, not eggplant', () => {
    expect(constraints.textHasTerm('scrambled eggs on toast', 'egg')).toBe(true);
    expect(constraints.textHasTerm('roasted eggplant curry', 'egg')).toBe(false);
    expect(constraints.textHasTerm('Eggplant Curry eggplant', 'egg')).toBe(false);
  });
  test('word-boundary: nut does not match walnut/coconut; specific nuts do', () => {
    expect(constraints.textHasTerm('walnut halves', 'nut')).toBe(false);
    expect(constraints.textHasTerm('coconut milk', 'nut')).toBe(false);
    expect(constraints.textHasTerm('mixed nuts', 'nut')).toBe(true);
    expect(constraints.textHasTerm('cashew cream', 'cashew')).toBe(true);
  });
  test('phrase terms match inside longer text', () => {
    expect(constraints.textHasTerm('peanut butter toast', 'peanut')).toBe(true);
    expect(constraints.textHasTerm('fish sauce dressing', 'fish')).toBe(true);
  });
  test('hasTerm is plural-tolerant both directions', () => {
    const s = new Set(['peanut']);
    expect(constraints.hasTerm(s, 'peanuts')).toBe(true);
    expect(constraints.hasTerm(new Set(['peanuts']), 'peanut')).toBe(true);
    expect(constraints.hasTerm(s, 'almond')).toBe(false);
  });
  test('canonRestriction normalizes separators', () => {
    expect(constraints.canonRestriction('Gluten Free')).toBe('gluten_free');
    expect(constraints.canonRestriction('lacto-vegetarian')).toBe('lacto_vegetarian');
  });
});

// ---- loadConstraints ------------------------------------------------------

describe('loadConstraints', () => {
  beforeEach(() => jest.clearAllMocks());

  test('profile allergy is authoritative — survives empty request allergies; request may only add', async () => {
    mockProfile({ allergies: ['Peanuts'] });
    const c = await constraints.loadConstraints('u1', {});
    expect(c.hard.allergenTerms.has('peanut')).toBe(true);
    expect(c.hard.allergenTerms.has('groundnut')).toBe(true); // derivative keyword

    const c2 = await constraints.loadConstraints('u1', { allergies: ['Sesame'] });
    expect(c2.hard.allergenTerms.has('peanut')).toBe(true); // profile retained
    expect(c2.hard.allergenTerms.has('sesame')).toBe(true); // request narrowed
    expect(c2.hard.allergenTerms.has('tahini')).toBe(true);
  });

  test('NEVER_RECOMMEND is a hard exclusion; DISLIKE stays soft', async () => {
    mockProfile({ prefs: [
      { foodName: 'mushroom', preference: 'NEVER_RECOMMEND' },
      { foodName: 'cilantro', preference: 'DISLIKE' },
    ] });
    const c = await constraints.loadConstraints('u1', {});
    expect(c.hard.excludeTerms.has('mushroom')).toBe(true);
    expect(c.soft.dislikes).toContain('cilantro');
    expect(c.hard.excludeTerms.has('cilantro')).toBe(false); // dislikes must not hard-block
  });

  test('saved vegetarian restriction maps to terms + categories + pattern', async () => {
    mockProfile({ restrictions: ['vegetarian'] });
    const c = await constraints.loadConstraints('u1', {});
    expect(c.hard.excludeTerms.has('chicken')).toBe(true);
    expect(c.hard.excludeTerms.has('gelatin')).toBe(true);
    expect(c.hard.bannedCategories.has('animal protein')).toBe(true);
    expect(c.hard.bannedCategories.has('seafood')).toBe(true);
    expect(c.hard.patterns.some((p) => p.key === 'vegetarian' && p.source === 'profile')).toBe(true);
  });

  test('exclude_* entry produces a literal term; halal is enforced but flagged unverifiable', async () => {
    mockProfile({ restrictions: ['exclude_beef', 'halal'] });
    const c = await constraints.loadConstraints('u1', {});
    expect(c.hard.excludeTerms.has('beef')).toBe(true);
    expect(c.hard.excludeTerms.has('pork')).toBe(true); // halal term
    expect(c.hard.excludeTerms.has('alcohol')).toBe(true);
    expect(c.unknown.some((u) => /halal/.test(u.key || ''))).toBe(true); // certification can't be verified
  });

  test('unknown restriction is recorded as unverifiable, not silently dropped', async () => {
    mockProfile({ restrictions: ['nightshade_free'] });
    const c = await constraints.loadConstraints('u1', {});
    expect(c.unknown.some((u) => u.key === 'nightshade_free')).toBe(true);
    expect(c.hard.excludeTerms.has('nightshade free')).toBe(true); // conservative literal fallback
  });

  test('APPROVED ingredient block rules produce bannedAttributes; query is approval-gated', async () => {
    mockProfile({ conditions: [{
      severity: 'high', active: true,
      condition: { id: 'c1', name: 'Chronic Kidney Disease', conditionRules: [
        { id: 'rule1', attribute: 'HIGH_PHOSPHORUS', target: 'ingredient', action: 'block', reviewStatus: 'APPROVED', reason: 'CKD phosphorus limit', ruleCode: null, version: 1 },
        { id: 'rule2', attribute: 'HIGH_SODIUM', target: 'ingredient', action: 'warn', reviewStatus: 'APPROVED', reason: 'watch sodium' },
      ] },
    }] });
    const c = await constraints.loadConstraints('u1', {});
    expect(c.hard.bannedAttributes.has('HIGH_PHOSPHORUS')).toBe(true);
    expect(c.hard.bannedAttributes.has('HIGH_SODIUM')).toBe(false);
    expect(c.hard.warnRules.some((r) => r.attribute === 'HIGH_SODIUM')).toBe(true);
    expect(prisma.userHealthCondition.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        condition: expect.objectContaining({
          include: expect.objectContaining({ conditionRules: expect.objectContaining({ where: { reviewStatus: 'APPROVED' } }) }),
        }),
      }),
    }));
  });

  test('macroGoal feeds limits; missing planning prefs surfaces unknown', async () => {
    mockProfile({ macroGoal: { caloriesTarget: 2000, proteinTarget: 140, carbsTarget: 220, fatTarget: 60, fiberTarget: 28, source: 'custom' } });
    const c = await constraints.loadConstraints('u1', {});
    expect(c.limits.caloriesTarget).toBe(2000);
    expect(c.unknown.some((u) => u.field === 'planningPreferences')).toBe(true);
  });

  test('equipment: request narrows to subset, never widens', async () => {
    mockProfile({ equipment: ['oven', 'stove', 'air fryer'] });
    const c = await constraints.loadConstraints('u1', { equipment: ['stove'] });
    expect(c.equipment).toEqual(['stove']);
  });
});

// ---- violatesHard ----------------------------------------------------------

describe('violatesHard', () => {
  const hard = {
    allergenTerms: new Set(['peanut', 'groundnut']),
    excludeTerms: new Set(['beef', 'gelatin']),
    bannedCategories: new Set(['animal protein']),
    bannedTags: new Set(['meat']),
    bannedAttributes: new Set(['HIGH_PHOSPHORUS']),
    patterns: [], medicalConditions: [], warnRules: [],
  };

  test('each violation class returns its rule id', () => {
    expect(constraints.violatesHard(hard, { text: 'peanut satay' }).ruleId).toBe('ALLERGEN_TEXT');
    expect(constraints.violatesHard(hard, { text: 'satay', allergens: ['peanuts'] }).ruleId).toBe('ALLERGEN_DECLARED');
    expect(constraints.violatesHard(hard, { text: 'beef stew' }).ruleId).toBe('EXCLUDED_TERM');
    expect(constraints.violatesHard(hard, { text: 'ribeye', category: 'Animal protein' }).ruleId).toBe('BANNED_CATEGORY');
    expect(constraints.violatesHard(hard, { text: 'mystery', tags: ['meat'] }).ruleId).toBe('BANNED_TAG');
    expect(constraints.violatesHard(hard, { text: 'mystery', attributes: ['HIGH_PHOSPHORUS'] }).ruleId).toBe('CONDITION_ATTR');
    expect(constraints.violatesHard(hard, { text: 'tomato salad' })).toBeNull();
  });
});

// ---- matchIngredients: F-1 regression -------------------------------------

describe('matchIngredients constraint enforcement', () => {
  beforeEach(() => jest.clearAllMocks());

  test('F-1: saved peanut allergy enforced when request omits allergies', async () => {
    mockProfile({ allergies: ['Peanuts'] });
    const out = await matchIngredients({ userId: 'u1', items: ALL_ITEMS, allergies: [] });
    expect(ids(out)).not.toContain('r_pb');
    expect(out.excluded.allergy).toBe(1);
    expect(ids(out)).toContain('r_eggp');
  });

  test('boundary: egg allergy excludes Scrambled Eggs but not Eggplant Curry', async () => {
    mockProfile({ allergies: ['Egg'] });
    const out = await matchIngredients({ userId: 'u1', items: ALL_ITEMS });
    expect(ids(out)).not.toContain('r_scramb');
    expect(ids(out)).toContain('r_eggp');
    expect(out.excluded.allergy).toBe(1);
  });

  test('NEVER_RECOMMEND food is a hard exclusion in matching', async () => {
    mockProfile({ prefs: [{ foodName: 'mushroom', preference: 'NEVER_RECOMMEND' }] });
    const out = await matchIngredients({ userId: 'u1', items: ALL_ITEMS });
    expect(ids(out)).not.toContain('r_mush');
    expect(out.excluded.exclusion).toBe(1);
  });

  test('DISLIKE does not hard-exclude', async () => {
    mockProfile({ prefs: [{ foodName: 'cilantro', preference: 'DISLIKE' }] });
    const out = await matchIngredients({ userId: 'u1', items: ALL_ITEMS });
    expect(ids(out)).toContain('r_cil');
  });

  test('saved vegetarian: meat name hits a term, category-only hit excluded too', async () => {
    mockProfile({ restrictions: ['vegetarian'] });
    const out = await matchIngredients({ userId: 'u1', items: ALL_ITEMS });
    expect(ids(out)).not.toContain('r_chick');   // 'chicken' term
    expect(ids(out)).not.toContain('r_steak');   // 'ribeye' via Animal protein category
    expect(ids(out)).toContain('r_scramb');      // vegetarian (lacto-ovo) permits eggs
    expect(out.excluded.exclusion).toBe(1);      // chicken
    expect(out.excluded.diet).toBe(1);           // steak was the category-path hit
    expect(ids(out)).toContain('r_pb');
    expect(ids(out)).toContain('r_eggp');
  });

  test('request diet still narrows (vegan request excludes dairy/meat/egg recipes)', async () => {
    mockProfile({});
    const out = await matchIngredients({ userId: 'u1', items: ALL_ITEMS, diet: ['vegan'] });
    expect(ids(out)).not.toContain('r_ghee');
    expect(ids(out)).not.toContain('r_chick');
    expect(ids(out)).not.toContain('r_scramb');
    expect(ids(out)).toContain('r_eggp');
    expect(ids(out)).toContain('r_mush');
  });

  test('APPROVED condition rule blocks attributed ingredients; user-scoped query', async () => {
    mockProfile({ conditions: [{
      severity: 'high', active: true,
      condition: { id: 'c1', name: 'Chronic Kidney Disease', conditionRules: [
        { id: 'rule1', attribute: 'HIGH_PHOSPHORUS', target: 'ingredient', action: 'block', reviewStatus: 'APPROVED', reason: 'CKD', ruleCode: null, version: 1 },
      ] },
    }] });
    prisma.ingredientAttribute.findMany.mockResolvedValue([{ ingredientId: 'ing_chick', attribute: 'HIGH_PHOSPHORUS' }]);
    const out = await matchIngredients({ userId: 'u1', items: ALL_ITEMS });
    expect(ids(out)).not.toContain('r_chick');
    expect(out.excluded.condition).toBe(1);
    expect(prisma.recipe.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [{ isSystem: true }, { creatorId: 'u1' }] }),
    }));
  });
});

// ---- /recipes/:id/customize — server-side enforcement ----------------------

describe('POST /recipes/:id/customize constraint enforcement', () => {
  beforeEach(() => jest.clearAllMocks());

  const baseRecipe = {
    id: 'r1', recipeName: 'Rice Bowl', servings: 2, isSystem: true, reviewStatus: 'SYSTEM',
    allergens: [], finishedYieldG: 400, portionG: 200,
    ingredients: [line('ing_rice', 'rice', 150), line('ing_tom', 'tomato', 80)],
  };

  test('profile peanut allergy blocks an AI-proposed peanut butter add (F-1)', async () => {
    mockProfile({ allergies: ['Peanuts'], prefs: [{ foodName: 'beef', preference: 'NEVER_RECOMMEND' }] });
    prisma.recipe.findFirst.mockResolvedValue(baseRecipe);
    prisma.ingredientCatalog.findMany.mockResolvedValue(CATALOG);
    askJSON.mockResolvedValue({ changes: [
      { action: 'add', ingredientName: 'peanut butter', amountG: 30 },
      { action: 'add', ingredientName: 'beef', amountG: 100 },
      { action: 'add', ingredientName: 'cilantro', amountG: 10 },
    ], notes: 'richer bowl' });

    // NOTE: request body deliberately omits allergies — the server must know.
    const res = await request(app).post('/recipes/r1/customize')
      .set('x-user-id', 'u1')
      .send({ request: 'make it richer' });

    expect(res.status).toBe(200);
    const reasons = res.body.rejected.map((r) => r.reason).join(' | ');
    expect(reasons).toMatch(/peanut butter.*allergies/i);
    expect(reasons).toMatch(/beef.*saved restrictions/i);
    // Clean add still applies.
    expect(res.body.changesApplied.join(' ')).toMatch(/cilantro/i);
    expect(res.body.proposedLines.some((l) => /peanut|beef/i.test(l.ingredientName))).toBe(false);
    expect(res.body.provenance.nutritionRecomputed).toBe(true);
  });

  test('request-provided allergies are additive, not a bypass', async () => {
    mockProfile({});
    prisma.recipe.findFirst.mockResolvedValue(baseRecipe);
    prisma.ingredientCatalog.findMany.mockResolvedValue(CATALOG);
    askJSON.mockResolvedValue({ changes: [{ action: 'add', ingredientName: 'ghee', amountG: 15 }], notes: '' });

    const res = await request(app).post('/recipes/r1/customize')
      .set('x-user-id', 'u1')
      .send({ request: 'add ghee', allergies: ['dairy'] });

    expect(res.status).toBe(200);
    expect(res.body.rejected.map((r) => r.reason).join(' ')).toMatch(/ghee.*allergies/i);
  });
});
