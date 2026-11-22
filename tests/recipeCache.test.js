// CACHE-001 / STALE-002: shared content cached by version stamp; user-specific
// validation decisions are never cached or shared across users.
jest.mock('../src/lib/prisma', () => { const db = {
  ingredientCatalog: { findMany: jest.fn(), aggregate: jest.fn() },
}; return { getPrisma: () => db }; });

const prisma = require('../src/lib/prisma').getPrisma();
const cache = require('../src/services/recipes/cache');
const { loadCatalog, validateGeneratedRecipe } = require('../src/services/recipes/validate');

const stamp = (count, ms) => ({ _count: { id: count }, _max: { updatedAt: new Date(ms) } });
const ROW = { id: 'c1', name: 'rice', identityKey: 'rice', normalizedName: 'rice', aliases: [], category: 'Grain', sourceRecord: {}, ingredient: { id: 'i1', name: 'rice', caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3, fiberPer100g: 0.4, attributes: [] } };

const CAND = {
  name: 'Rice Bowl', servings: 1, estimatedMinutes: 10, mealType: 'lunch',
  ingredients: [{ ingredientName: 'rice', amountG: 150, unit: 'g', optional: false }],
  instructions: ['Cook the rice thoroughly before serving.'], missingIngredients: [], substitutions: [],
};
const PEANUT_CAND = { ...CAND, ingredients: [{ ingredientName: 'peanut butter', amountG: 30, unit: 'g', optional: false }] };
const constraintsFor = (allergy) => ({
  version: 'test', userId: 'x', hard: { allergenTerms: new Set(allergy ? [allergy] : []), excludeTerms: new Set(), bannedCategories: new Set(), bannedTags: new Set(), bannedAttributes: new Set(), patterns: [], medicalConditions: [], warnRules: [], nutrientLimits: [] },
  soft: { dislikes: [], likes: [], cuisines: [] }, limits: null, equipment: [], availability: { items: [] }, unknown: [],
});

describe('version-aware shared cache', () => {
  beforeEach(() => { jest.clearAllMocks(); cache.reset(); prisma.ingredientCatalog.aggregate.mockResolvedValue(stamp(1, 1000)); });

  test('CACHE-001: catalog is shared but validation outcomes are never cached — each user gets their own verdict', async () => {
    prisma.ingredientCatalog.findMany.mockResolvedValue([ROW]);
    const ctx = { prisma };
    // Same underlying catalog fetch shared…
    const catA = await loadCatalog(prisma);
    const catB = await loadCatalog(prisma);
    expect(prisma.ingredientCatalog.findMany).toHaveBeenCalledTimes(1);
    expect(catA).toBe(catB);
    // …but validation runs fresh per user: allergic user FAILs, clean user PASSes.
    const vAllergic = await validateGeneratedRecipe(PEANUT_CAND, constraintsFor('peanut'), { ...ctx, catalog: catA });
    const vClean = await validateGeneratedRecipe(PEANUT_CAND, constraintsFor(null), { ...ctx, catalog: catB });
    expect(vAllergic.status).toBe('FAIL');
    expect(vClean.status).not.toBe('FAIL');
    // No per-user verdict in the shared store — only the user-agnostic
    // catalog scope key may exist.
    expect(cache.snapshot().keys).toEqual(['catalog:validate']);
  });

  test('STALE-002: version stamp change invalidates — updated catalog row is re-fetched', async () => {
    prisma.ingredientCatalog.findMany
      .mockResolvedValueOnce([ROW])
      .mockResolvedValueOnce([{ ...ROW, name: 'rice2', normalizedName: 'rice2', identityKey: 'rice2' }]);
    const first = await loadCatalog(prisma);
    expect(first.byName.has('rice')).toBe(true);
    expect(prisma.ingredientCatalog.findMany).toHaveBeenCalledTimes(1);

    // Catalog mutates → stamp changes → stale entry invalidated, new data served.
    prisma.ingredientCatalog.aggregate.mockResolvedValue(stamp(1, 2000));
    const second = await loadCatalog(prisma);
    expect(prisma.ingredientCatalog.findMany).toHaveBeenCalledTimes(2);
    expect(second.byName.has('rice2')).toBe(true);
    expect(cache.snapshot().invalidated).toBeGreaterThan(0);
  });

  test('missing version probe → cache skipped entirely (never serves unverifiable data)', async () => {
    prisma.ingredientCatalog.aggregate.mockRejectedValue(new Error('no aggregate'));
    prisma.ingredientCatalog.findMany.mockResolvedValue([ROW]);
    await loadCatalog(prisma);
    await loadCatalog(prisma);
    expect(prisma.ingredientCatalog.findMany).toHaveBeenCalledTimes(2);
    expect(cache.snapshot().skips).toBe(2);
  });
});
