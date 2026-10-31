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
const { normalize: catalogNormalize } = require('./ingredientCatalog');

function normalize(s) {
  return (s || '').trim().toLowerCase();
}

// USDA rows carry a labeled household measure ("1 slice") plus its weight in
// sourceMetadata. When no catalog servings exist, surface it as a serving so
// clients can offer natural units instead of bare grams.
function derivedServings(ingredient) {
  if (ingredient.servings?.length) return ingredient.servings;
  const meta = ingredient.sourceMetadata;
  const unit = (meta?.servingSizeUnit || '').toLowerCase();
  if (meta?.householdServingFullText && Number.isFinite(meta?.servingSize) && meta.servingSize > 0 && ['g', 'gm', 'ml'].includes(unit)) {
    return [{ id: 'label-serving', label: meta.householdServingFullText, grams: meta.servingSize, estimated: true }];
  }
  return [];
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
      ...(ingredient.fiberPer100g == null ? {} : { fiber_g: ingredient.fiberPer100g }),
    },
    source: ingredient.catalogId ? 'humai-catalog' : source,
    servings: derivedServings(ingredient),
    revision: ingredient.catalog?.importBatch || null,
    verificationLevel: ingredient.catalog?.verificationLevel || null,
    reviewRequired: ingredient.catalog?.reviewRequired || false,
    ...(ingredient.sourceMetadata ? { provenance: ingredient.sourceMetadata } : {}),
    ...(ingredient.catalog ? { catalogId: ingredient.catalog.id, preparation: ingredient.catalog.preparation, nutritionStatus: ingredient.catalog.status, provenance: ingredient.catalog.sourceRecord } : {}),
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
    const curated = await prisma.ingredient.findUnique({ where: { fdcId: item.fdcId }, include: { catalog: true } });
    if (curated?.catalogId) { if (curated.catalog?.usable) stored.push(curated); continue; }
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
        fiberPer100g: item.fiberPer100g ?? null,
        sourceMetadata: { ...(curated?.sourceMetadata || {}), ...(item.sourceMetadata || {}) },
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
        fiberPer100g: item.fiberPer100g ?? null,
        sourceMetadata: { ...(curated?.sourceMetadata || {}), ...(item.sourceMetadata || {}) },
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
async function searchIngredients({ userId, query, limit = 10, preparation, productType, verificationLevel }) {
  if (!userId) throw new Error('userId is required');
  const q = catalogNormalize(query);
  if (q.length > 120 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw Object.assign(new Error('Invalid search query or limit'), { status: 400 });
  if (!q) throw new Error('query is required');

  const prisma = getPrisma();

  // Curated names and aliases always outrank personal-cache and external results.
  const catalog = await prisma.ingredientCatalog.findMany({ where: { usable: true }, select: { id:true, name:true, normalizedName:true, aliases:true, brand:true, restaurantChain:true, preparation:true, verificationLevel:true, ingredient:{select:{id:true}} } });
  const tokens = q.split(' ');
  const ranked = catalog.map(row => {
    const names = [row.normalizedName, ...row.aliases, catalogNormalize(row.brand), catalogNormalize(row.restaurantChain)];
    const score = names.some(n => n === q) ? 0 : names.some(n => n.startsWith(q)) ? 1 : tokens.every(t => names.some(n => n.includes(t))) ? 2 : 99;
    return { row, score };
  }).filter(x => x.score < 99 && x.row.ingredient && (!preparation || catalogNormalize(x.row.preparation + ' ' + x.row.name).includes(catalogNormalize(preparation))) && (!productType || (productType === 'branded' ? !!(x.row.brand || x.row.restaurantChain) : !(x.row.brand || x.row.restaurantChain))) && (!verificationLevel || x.row.verificationLevel === verificationLevel)).sort((a, b) => a.score - b.score || ({SOURCE_BACKED_FULL:0,PARTIALLY_SOURCE_BACKED:1,GENERIC_COMPOSITION:2,ESTIMATED:3,REVIEW_CONFLICT:4}[a.row.verificationLevel] ?? 3) - ({SOURCE_BACKED_FULL:0,PARTIALLY_SOURCE_BACKED:1,GENERIC_COMPOSITION:2,ESTIMATED:3,REVIEW_CONFLICT:4}[b.row.verificationLevel] ?? 3) || a.row.name.localeCompare(b.row.name) || a.row.id.localeCompare(b.row.id)).slice(0, limit);
  if (ranked.length) {
    const details=await prisma.ingredientCatalog.findMany({where:{id:{in:ranked.map(x=>x.row.id)}},include:{ingredient:{include:{servings:true}}}});
    const byId=new Map(details.map(row=>[row.id,row]));
    return ranked.map(({row})=>byId.get(row.id)).filter(row=>row?.ingredient).map(row=>toDto({...row.ingredient,catalog:row},'humai-catalog'));
  }

  if (preparation || productType || verificationLevel) return [];

  // Tier 1 — the user's own previously-searched ingredients.
  const userRows = await prisma.userIngredient.findMany({
    where: { userId, ingredient: { normalizedName: { contains: q }, catalogId: null } },
    include: { ingredient: true },
    orderBy: { lastSearchedAt: 'desc' },
    take: limit,
  });
  if (userRows.length) {
    return userRows.map((r) => toDto(r.ingredient, 'user-cache'));
  }

  // Tier 2 — the central shared catalog. Link hits into the user's table.
  const central = await prisma.ingredient.findMany({
    where: { normalizedName: { contains: q }, catalogId: null },
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
