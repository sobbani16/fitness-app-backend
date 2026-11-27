// P6-001 substitution rechecks: meal swaps must face the same allergy policy
// as generation and confirmDay, and swap/alternatives must be owner-scoped.
// Before: swapMeal/getAlternatives took no userId (cross-user write possible)
// and performed no allergen assessment at all.
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockDb }));
jest.mock('../src/services/weekly/planningPolicy', () => ({ recipeAllowed: () => true }));
const { getAlternatives, swapMeal, rebalanceDay } = require('../src/services/weekly/mealSwapService');

const OWNER = 'owner-1';
const meal = (over = {}) => ({
  id: 'm1', planId: 'p1', recipeId: 'r0', dayOfWeek: 1, mealType: 'lunch',
  calories: 400, proteinG: 20, carbsG: 40, fatG: 15, confirmedByUser: false,
  plan: { id: 'p1', userId: OWNER },
  recipe: { id: 'r0', ingredients: [] },
  ...over,
});
const recipe = (id, ingredientName, extra = {}) => ({
  id, mealType: 'lunch', isSystem: true, recipeName: `Recipe ${id}`, calories: 390,
  proteinG: 20, carbsG: 38, fatG: 14, fiberG: 5, servings: 1, portionG: 350,
  ingredients: ingredientName ? [{ ingredientId: `i-${id}`, ingredientName }] : [],
  ...extra,
});

function buildDb({ mealRow, recipes = [], allergies = ['peanut'] } = {}) {
  return {
    weeklyMeal: {
      findUnique: async ({ where }) => (where.id === mealRow.id ? mealRow : null),
      findMany: async () => [mealRow],
      update: jest.fn(async () => mealRow),
    },
    recipe: {
      findMany: async () => recipes,
      findUnique: async ({ where }) => recipes.find((r) => r.id === where.id) || null,
    },
    weeklyNutritionPlan: {
      findUnique: async () => ({ id: 'p1', userId: OWNER, caloriesTarget: 2000, proteinTarget: 100, carbsTarget: 200, fatTarget: 70 }),
    },
    foodPreference: { findMany: async () => [] },
    $transaction: async (fn) => fn(mockDb),
    userPlanningPreferences: { findUnique: async () => null },
    userAllergy: { findMany: async () => allergies.map((name) => ({ allergy: { name } })) },
    ingredient: { findMany: async ({ where }) => (where.id?.in || []).map((id) => ({ id, name: `ingredient ${id}`, catalog: null })) },
  };
}

let mockDb;
beforeEach(() => { mockDb = buildDb({ mealRow: meal() }); });

describe('ownership scoping', () => {
  it('swapMeal rejects a non-owner with 404 (no cross-user writes)', async () => {
    await expect(swapMeal('m1', 'r2', 'attacker-9')).rejects.toMatchObject({ status: 404 });
    expect(mockDb.weeklyMeal.update).not.toHaveBeenCalled();
  });
  it('getAlternatives rejects a non-owner with 404', async () => {
    await expect(getAlternatives('m1', 'attacker-9')).rejects.toMatchObject({ status: 404 });
  });
});

describe('allergy recheck on substitution', () => {
  it('swap to an allergen-conflicting recipe → 409 ALLERGY_CONFLICT, no write', async () => {
    mockDb = buildDb({ mealRow: meal(), recipes: [recipe('r2', 'peanut sauce')] });
    await expect(swapMeal('m1', 'r2', OWNER)).rejects.toMatchObject({ status: 409, code: 'ALLERGY_CONFLICT' });
    expect(mockDb.weeklyMeal.update).not.toHaveBeenCalled();
  });
  it('swap to a clear recipe succeeds', async () => {
    mockDb = buildDb({ mealRow: meal(), recipes: [recipe('r2', 'steamed rice')] });
    const out = await swapMeal('m1', 'r2', OWNER);
    expect(mockDb.weeklyMeal.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1' }, data: expect.objectContaining({ recipeId: 'r2' }) }));
    expect(out).toBeTruthy();
  });
  it('alternatives exclude conflicting recipes and expose allergyStatus', async () => {
    mockDb = buildDb({ mealRow: meal(), recipes: [recipe('r2', 'peanut sauce'), recipe('r3', 'steamed rice')] });
    const out = await getAlternatives('m1', OWNER);
    expect(out.map((r) => r.id)).toEqual(['r3']);
    expect(out[0].allergyStatus).toBe('clear');
  });
  it('unknown composition → 409 ALLERGY_COMPOSITION_UNKNOWN unless acknowledged', async () => {
    // 'house blend' has no catalog row → line unresolved → composition unknown.
    mockDb = buildDb({ mealRow: meal(), recipes: [recipe('r2', 'house blend')] });
    await expect(swapMeal('m1', 'r2', OWNER)).rejects.toMatchObject({ status: 409, code: 'ALLERGY_COMPOSITION_UNKNOWN' });
    expect(mockDb.weeklyMeal.update).not.toHaveBeenCalled();
    await swapMeal('m1', 'r2', OWNER, { acknowledgeUnknownAllergens: true });
    expect(mockDb.weeklyMeal.update).toHaveBeenCalled();
  });
  it('users with no allergies swap freely', async () => {
    mockDb = buildDb({ mealRow: meal(), recipes: [recipe('r2', 'peanut sauce')], allergies: [] });
    await swapMeal('m1', 'r2', OWNER);
    expect(mockDb.weeklyMeal.update).toHaveBeenCalled();
  });
});

describe('rebalanceDay allergy enforcement (automatic writes, no user to acknowledge)', () => {
  it('never installs an allergen-conflicting recipe even when it scores best', async () => {
    const peanutRecipe = recipe('rp', 'peanut', { calories: 2000 });
    const cleanRecipe = recipe('rc', 'rice', { calories: 100 });
    mockDb = buildDb({ mealRow: meal(), recipes: [peanutRecipe, cleanRecipe], allergies: ['peanut'] });
    await rebalanceDay('p1', 1, OWNER, { skipMealId: 'nope', disliked: [], restrictions: [], preferences: [] });
    const calls = mockDb.weeklyMeal.update.mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0].data.recipeId).toBe('rc');
  });

  it('excludes composition-unknown recipes, falling back rather than installing one', async () => {
    const unknownRecipe = recipe('ru', null, { calories: 2000 });
    mockDb = buildDb({ mealRow: meal(), recipes: [unknownRecipe], allergies: ['peanut'] });
    await rebalanceDay('p1', 1, OWNER, { skipMealId: 'nope', disliked: [], restrictions: [], preferences: [] });
    for (const c of mockDb.weeklyMeal.update.mock.calls) expect(c[0].data.recipeId).not.toBe('ru');
  });
});

describe('P6-002 swap+rebalance atomicity', () => {
  it('swap write and rebalance run inside a single transaction', async () => {
    const txSpy = jest.fn(async (fn) => fn(mockDb));
    mockDb.$transaction = txSpy;
    mockDb = Object.assign(mockDb, buildDb({ mealRow: meal(), recipes: [recipe('r2', 'rice')] }));
    mockDb.$transaction = txSpy;
    await swapMeal('m1', 'r2', OWNER);
    expect(txSpy).toHaveBeenCalledTimes(1);
  });

  it('a rebalance failure propagates — no silent half-swapped success', async () => {
    mockDb = buildDb({ mealRow: meal(), recipes: [recipe('r2', 'rice')] });
    mockDb.$transaction = async (fn) => {
      // simulate the tx aborting mid-rebalance: throw inside the callback
      const err = new Error('rebalance write failed');
      try { await fn({ ...mockDb, weeklyMeal: { ...mockDb.weeklyMeal, update: jest.fn(async () => meal()), findMany: async () => { throw err; } } }); }
      catch (e) { throw e; }
    };
    await expect(swapMeal('m1', 'r2', OWNER)).rejects.toThrow('rebalance write failed');
  });
});
