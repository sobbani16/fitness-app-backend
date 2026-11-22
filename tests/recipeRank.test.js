// Phase 9 ranking: deterministic post-hard-filter ordering.
// Proves (a) hard-excluded recipes never appear regardless of preference
// signals, and (b) engagement/preference/nutrition reorder eligible results.
jest.mock('../src/lib/prisma', () => { const db = {
  userAllergy: { findMany: jest.fn(async () => [{ allergy: { name: 'Peanuts' } }]) },
  userHealthCondition: { findMany: jest.fn(async () => []) },
  foodPreference: { findMany: jest.fn(async () => []) },
  userPlanningPreferences: { findUnique: jest.fn(async () => null) },
  foodInventory: { findMany: jest.fn(async () => []) },
  macroGoal: { findUnique: jest.fn(async () => null) },
  ingredientCatalog: { findMany: jest.fn(async () => []) },
  ingredientAttribute: { findMany: jest.fn(async () => []) },
  recipe: { findMany: jest.fn(async () => []) },
  recipeEngagement: { findMany: jest.fn(async () => []) },
}; return { getPrisma: () => db }; });

const prisma = require('../src/lib/prisma').getPrisma();
const { matchIngredients } = require('../src/services/recipeMatch');

const ing = (id) => ({ id, caloriesPer100g: 100, proteinPer100g: 5, carbsPer100g: 20, fatPer100g: 2, fiberPer100g: 2 });
const cat = (id, name, ingredientId) => ({ id, name, normalizedName: name, aliases: [], category: 'Grain', usable: true, sourceRecord: {}, ingredient: ing(ingredientId) });
const CATALOG = [cat('c_rice', 'rice', 'i_rice'), cat('c_tom', 'tomato', 'i_tom'), cat('c_pb', 'peanut butter', 'i_pb')];

const line = (name, ingredientId, amountG = 100) => ({ ingredientName: name, ingredientId, amountG, optional: false });
const recipe = (id, name, lines, extra = {}) => ({
  id, recipeName: name, ingredients: lines, reviewStatus: 'VERIFIED', isSystem: true,
  cuisine: 'Indian', servings: 1, prepMinutes: 20, calories: 400, proteinG: 15, carbsG: 50, fatG: 10, fiberG: 5, allergens: [], ...extra,
});

describe('matchIngredients — deterministic ranking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.userAllergy.findMany.mockResolvedValue([{ allergy: { name: 'Peanuts' } }]);
    prisma.ingredientCatalog.findMany.mockResolvedValue(CATALOG);
  });

  test('hard-excluded recipe never appears — even with preference + engagement boosts', async () => {
    prisma.foodPreference.findMany.mockResolvedValue([{ preference: 'LOVE', foodName: 'peanut butter' }]);
    prisma.recipe.findMany.mockResolvedValue([
      recipe('r_bad', 'Peanut Butter Bowl', [line('peanut butter', 'i_pb'), line('rice', 'i_rice')]),
      recipe('r_ok', 'Tomato Rice', [line('rice', 'i_rice'), line('tomato', 'i_tom')]),
    ]);
    prisma.recipeEngagement.findMany.mockResolvedValue([{ recipeId: 'r_bad', userId: 'u1', favorite: true, rating: 5 }]);

    const out = await matchIngredients({ userId: 'u1', items: [{ name: 'rice' }, { name: 'tomato' }] });
    const ids = out.results.map((r) => r.recipe.id);
    expect(ids).not.toContain('r_bad');
    expect(ids).toContain('r_ok');
    expect(out.excluded.allergy).toBe(1);
  });

  test('engagement + preference reorder eligible survivors; DISLIKE soft-penalizes', async () => {
    prisma.foodPreference.findMany.mockResolvedValue([
      { preference: 'LOVE', foodName: 'tomato' },
      { preference: 'DISLIKE', foodName: 'plain rice' },
    ]);
    prisma.macroGoal.findUnique.mockResolvedValue({ caloriesTarget: 2100, proteinTarget: 150 });
    prisma.recipe.findMany.mockResolvedValue([
      recipe('r_a', 'Plain Rice', [line('rice', 'i_rice')], { calories: 400, proteinG: 8 }),
      recipe('r_b', 'Tomato Rice Deluxe', [line('rice', 'i_rice'), line('tomato', 'i_tom')], { calories: 700, proteinG: 55 }),
    ]);
    // r_b is missing tomato (partial) but loved + favored + protein-fit.
    prisma.recipeEngagement.findMany.mockResolvedValue([{ recipeId: 'r_b', userId: 'u1', favorite: true, rating: 5 }]);

    const out = await matchIngredients({ userId: 'u1', items: [{ name: 'rice' }] });
    const a = out.results.find((r) => r.recipe.id === 'r_a');
    const b = out.results.find((r) => r.recipe.id === 'r_b');
    expect(a.rankScore).toBeDefined();
    expect(b.rankScore).toBeDefined();
    expect(b.rankBreakdown.favorite).toBe(0.06);
    expect(b.rankBreakdown.preference).toBeGreaterThan(0);
    expect(b.rankBreakdown.proteinFit).toBe(0.04);
    // DISLIKE term 'plain rice' text-matches r_a's name → soft penalty.
    expect(a.rankBreakdown.preference).toBeLessThan(0);
    // Ranking never removes a recipe for DISLIKE — it's still returned.
    expect(out.results).toHaveLength(2);
  });

  test('exclusion invariance: boosting signals cannot lift an excluded recipe into results', async () => {
    prisma.recipe.findMany.mockResolvedValue([
      recipe('r_bad', 'Peanut Satay', [line('peanut butter', 'i_pb')]),
      recipe('r_c', 'Cucumber Salad', [line('cucumber', null)]),
    ]);
    const out = await matchIngredients({ userId: 'u1', items: [{ name: 'rice' }], allergies: ['peanut'] });
    expect(out.results.map((r) => r.recipe.id)).not.toContain('r_bad');
    expect(out.results.every((r) => r.recipe.id !== 'r_bad')).toBe(true);
  });
});
