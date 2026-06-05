// Ingredient lookup with a three-tier cache:
//   1. The user's own ingredient table (UserIngredient -> Ingredient).
//   2. The central, shared Ingredient catalog.
//   3. The USDA FoodData Central API.
//
// On a USDA hit, the ingredient is stored in BOTH the central catalog and the
// user's table, so subsequent searches (by this user or any other) are served
// from the DB. A central hit also gets linked into the user's table.

const { getPrisma } = require('../lib/prisma');
const { searchUsda } = require('./usdaService');

function normalize(s) {
  return (s || '').trim().toLowerCase();
}

function toDto(ingredient, source) {
  return {
    id: ingredient.id,
    fdcId: ingredient.fdcId,
    name: ingredient.name,
    caloriesPer100g: ingredient.caloriesPer100g,
    macrosPer100g: {
      protein_g: ingredient.proteinPer100g,
      carbs_g: ingredient.carbsPer100g,
      fat_g: ingredient.fatPer100g,
    },
    source,
  };
}

// Link a set of central ingredients into a user's table (idempotent), bumping
// searchCount/lastSearchedAt when the link already exists.
async function linkToUser(prisma, userId, ingredients) {
  for (const ing of ingredients) {
    await prisma.userIngredient.upsert({
      where: { userId_ingredientId: { userId, ingredientId: ing.id } },
      update: { searchCount: { increment: 1 }, lastSearchedAt: new Date() },
      create: { userId, ingredientId: ing.id },
    });
  }
}

async function storeFromUsda(prisma, items) {
  const stored = [];
  for (const item of items) {
    const ing = await prisma.ingredient.upsert({
      where: { fdcId: item.fdcId },
      update: {
        name: item.name,
        normalizedName: normalize(item.name),
        caloriesPer100g: item.caloriesPer100g,
        proteinPer100g: item.proteinPer100g,
        carbsPer100g: item.carbsPer100g,
        fatPer100g: item.fatPer100g,
        source: item.source,
      },
      create: {
        fdcId: item.fdcId,
        name: item.name,
        normalizedName: normalize(item.name),
        caloriesPer100g: item.caloriesPer100g,
        proteinPer100g: item.proteinPer100g,
        carbsPer100g: item.carbsPer100g,
        fatPer100g: item.fatPer100g,
        source: item.source,
      },
    });
    stored.push(ing);
  }
  return stored;
}

/**
 * Resolve ingredient search results for a user via the three-tier cache.
 * @param {{ userId: string, query: string, limit?: number }} params
 * @returns {Promise<Array>} ingredient DTOs (each with per-100g nutrition)
 */
async function searchIngredients({ userId, query, limit = 10 }) {
  if (!userId) throw new Error('userId is required');
  const q = normalize(query);
  if (!q) throw new Error('query is required');

  const prisma = getPrisma();

  // Tier 1 — the user's own previously-searched ingredients.
  const userRows = await prisma.userIngredient.findMany({
    where: { userId, ingredient: { normalizedName: { contains: q } } },
    include: { ingredient: true },
    orderBy: { lastSearchedAt: 'desc' },
    take: limit,
  });
  if (userRows.length) {
    return userRows.map((r) => toDto(r.ingredient, 'user-cache'));
  }

  // Tier 2 — the central shared catalog. Link hits into the user's table.
  const central = await prisma.ingredient.findMany({
    where: { normalizedName: { contains: q } },
    take: limit,
  });
  if (central.length) {
    await linkToUser(prisma, userId, central);
    return central.map((i) => toDto(i, 'central-cache'));
  }

  // Tier 3 — USDA. Store results centrally + in the user's table.
  const usda = await searchUsda(q, limit);
  if (!usda.length) return [];
  const stored = await storeFromUsda(prisma, usda);
  await linkToUser(prisma, userId, stored);
  return stored.map((i) => toDto(i, 'usda'));
}

module.exports = {
  searchIngredients,
  // exported for unit testing
  normalize,
  toDto,
};
