// Unified food search across the curated ingredient catalog, the user's
// cached ingredients, the shared Ingredient table, and system + personal
// recipes. One ranked result list; ingredient hits reuse the existing
// three-tier service so USDA fallthrough stays identical.
const { getPrisma } = require('../lib/prisma');
const { normalize } = require('./ingredientCsv');
const { searchIngredients } = require('./ingredientService');
const { httpError } = require('../lib/errors');

const VERIFICATION_RANK = { SOURCE_BACKED_FULL: 0, PARTIALLY_SOURCE_BACKED: 1, GENERIC_COMPOSITION: 2, ESTIMATED: 3, REVIEW_CONFLICT: 4 };
const CUISINE_KEYS = new Set(['indian', 'american', 'mediterranean', 'mexican', 'italian', 'chinese', 'japanese', 'thai', 'middle eastern']);

function scoreNames(names, q, tokens) {
  if (names.some((n) => n === q)) return 0;
  if (names.some((n) => n.startsWith(q))) return 1;
  if (tokens.every((t) => names.some((n) => n.includes(t)))) return 2;
  return 99;
}

function recipeNames(r) {
  return [normalize(r.recipeName), ...r.aliases.map(normalize), normalize(r.cuisine), normalize(r.region)].filter(Boolean);
}

async function searchRecipesLocal(prisma, { userId, q, tokens, filters, limit }) {
  const rows = await prisma.recipe.findMany({
    where: { reviewStatus: { not: 'REJECTED' }, OR: [{ isSystem: true }, { creatorId: userId }] },
    select: { id: true, recipeName: true, aliases: true, cuisine: true, region: true, mealType: true, servings: true, portionG: true, calories: true, proteinG: true, carbsG: true, fatG: true, fiberG: true, reviewStatus: true, creatorId: true, description: true },
  });
  const f = filters;
  return rows.map((r) => ({ r, score: scoreNames(recipeNames(r), q, tokens) }))
    .filter((x) => x.score < 99
      && (!f.cuisine || normalize(x.r.cuisine) === normalize(f.cuisine))
      && (!f.region || normalize(x.r.region).includes(normalize(f.region)))
      && (!f.mealType || x.r.mealType === f.mealType)
      && (!f.own || x.r.creatorId === userId))
    .map(({ r, score }) => ({
      type: 'recipe', id: r.id, name: r.recipeName, score,
      cuisine: r.cuisine, region: r.region, mealType: r.mealType,
      servings: r.servings, portionG: r.portionG,
      perServing: { calories: r.calories, proteinG: r.proteinG, carbsG: r.carbsG, fatG: r.fatG, fiberG: r.fiberG },
      verificationLevel: r.reviewStatus === 'VERIFIED' ? 'VERIFIED' : 'ESTIMATED',
      reviewStatus: r.reviewStatus,
      source: r.creatorId === userId ? 'user-recipe' : 'humai-recipe',
    }));
}

async function searchFoods({ userId, query, limit = 20, filters = {} }) {
  if (!userId) throw httpError(401, 'Sign in required.');
  const q = normalize(query);
  if (!q || q.length > 120) throw httpError(400, 'q is required (≤120 chars).');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw httpError(400, 'limit must be 1–50.');
  const tokens = q.split(' ');
  const prisma = getPrisma();
  const wantIngredients = !filters.type || filters.type === 'ingredient';
  const wantRecipes = !filters.type || filters.type === 'recipe';

  const ingredientTier = (async () => {
    if (!wantIngredients || filters.cuisine || filters.region || filters.mealType || filters.own) return { items: [], error: null };
    try {
      const rs = await searchIngredients({ userId, query: q, limit, preparation: filters.preparation, productType: filters.productType, verificationLevel: filters.verificationLevel });
      return {
        error: null,
        items: rs.map((r) => ({
          type: 'ingredient', id: r.id, name: r.name, score: 1,
          caloriesPer100g: r.caloriesPer100g, macrosPer100g: r.macrosPer100g,
          servings: r.servings, source: r.source, verificationLevel: r.verificationLevel || (r.source === 'humai-catalog' ? 'GENERIC_COMPOSITION' : 'ESTIMATED'),
          reviewRequired: r.reviewRequired, preparation: r.preparation || null, provenance: r.provenance || null,
        })),
      };
    } catch (err) {
      // External-catalog failure is not "no match" — surface the distinction.
      return { items: [], error: err.status === 503 ? 'ingredient-search-unavailable' : 'ingredient-search-error' };
    }
  })();

  const [ing, recipes] = await Promise.all([
    ingredientTier,
    wantRecipes ? searchRecipesLocal(prisma, { userId, q, tokens, filters, limit }) : Promise.resolve([]),
  ]);

  const combined = [...ing.items, ...recipes]
    .sort((a, b) => a.score - b.score
      || (VERIFICATION_RANK[a.verificationLevel] ?? 3) - (VERIFICATION_RANK[b.verificationLevel] ?? 3)
      || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit);
  return {
    results: combined,
    counts: { ingredients: ing.items.length, recipes: recipes.length },
    ...(ing.error ? { warnings: [{ code: ing.error, message: 'Ingredient catalog lookup failed — results may be incomplete. Retry or use Estimate with Leo.' }] } : {}),
  };
}

module.exports = { searchFoods, scoreNames };
