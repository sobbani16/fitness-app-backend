// Deterministic recipe matching for scanned foods — name/alias/cuisine scoring plus
// coverage of visually suggested ingredients against recipe lines. No AI involved.
const { getPrisma } = require('../lib/prisma');
const { scoreNames } = require('./foodSearch');
const { normalize } = require('./ingredientCsv');

const MAX_CANDIDATES = 4;

function coverage(lines, visibleNames) {
  if (!visibleNames.length || !lines.length) return { covered: [], ratio: 0 };
  const labels = lines.map((l) => normalize(l.ingredientName || ''));
  const covered = [];
  for (const v of visibleNames) {
    const w = normalize(v);
    if (!w) continue;
    const words = w.split(' ').filter((t) => t.length >= 3);
    if (labels.some((l) => l === w || l.includes(w) || w.includes(l)
      || (words.length > 1 && words.every((p) => l.includes(p)))
      || labels.some((x) => x.split(' ').includes(w)))) covered.push(v);
  }
  return { covered, ratio: covered.length / visibleNames.length };
}

async function matchDetectedFood(food, userId) {
  const prisma = getPrisma();
  const q = normalize(food.foodName || '');
  if (!q || q.length < 2) return [];
  const tokens = q.split(' ');
  const base = {
    reviewStatus: { not: 'REJECTED' },
    AND: [{ OR: [{ isSystem: true }, { creatorId: userId }] }],
  };
  const select = {
    id: true, recipeName: true, aliases: true, cuisine: true, region: true, servings: true, portionG: true,
    calories: true, proteinG: true, carbsG: true, fatG: true, fiberG: true, reviewStatus: true, finishedYieldG: true,
    ingredients: { select: { ingredientId: true, ingredientName: true, amountG: true, optional: true } },
  };
  // Exact-phrase/alias hits score highest downstream — fetch them before broad
  // token matches so a crowded token namespace can't push them out of the
  // take-limited candidate window (unordered findMany returns an arbitrary subset).
  const rows = await prisma.recipe.findMany({
    where: {
      ...base,
      OR: [
        { recipeName: { contains: q, mode: 'insensitive' } },
        { aliases: { hasSome: [String(food.foodName || '').toLowerCase(), q] } },
      ],
    },
    select,
    take: 20,
  });
  const tokenConds = tokens.filter((t) => t.length >= 4)
    .map((t) => ({ recipeName: { contains: t, mode: 'insensitive' } }));
  if (rows.length < 20 && tokenConds.length) {
    const extra = await prisma.recipe.findMany({
      where: { ...base, id: { notIn: rows.map((r) => r.id) }, OR: tokenConds },
      select,
      take: 20 - rows.length,
    });
    rows.push(...extra);
  }
  const cuisines = (food.cuisineCandidates || []).map(normalize);
  const visible = (food.visibleIngredients || []).map((i) => i.name);
  const scored = rows.map((r) => {
    const names = [r.recipeName, ...r.aliases, r.cuisine, r.region].map(normalize).filter(Boolean);
    const nameRank = scoreNames(names, q, tokens);
    const cuisineHit = cuisines.some((c) => c && (normalize(r.cuisine).includes(c) || normalize(r.region).includes(c)));
    const cov = coverage(r.ingredients, visible);
    const verifiedBonus = r.reviewStatus === 'VERIFIED' ? 0.05 : r.reviewStatus === 'SYSTEM' ? 0.03 : 0;
    const score = (3 - nameRank) + (cuisineHit ? 0.15 : 0) + cov.ratio * 0.25 + verifiedBonus;
    return {
      r, nameRank, score,
      reasons: [
        ...(nameRank === 0 ? ['exact dish name match'] : nameRank === 1 ? ['name starts with match'] : ['partial name match']),
        ...(cuisineHit ? [`cuisine matches (${r.cuisine || r.region})`] : []),
        ...(cov.covered.length ? [`${cov.covered.length}/${visible.length} visible ingredient(s) appear in recipe`] : []),
        r.reviewStatus === 'RESEARCH_DRAFT' ? ['research draft — nutrition estimated'] : [],
      ],
      covered: cov.covered,
    };
  }).filter((s) => s.nameRank < 99 || s.covered.length >= 2)
    .sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
  return scored.map((s) => ({
    recipeId: s.r.id, name: s.r.recipeName, cuisine: s.r.cuisine, region: s.r.region,
    servings: s.r.servings, portionG: s.r.portionG, finishedYieldG: s.r.finishedYieldG,
    reviewStatus: s.r.reviewStatus, nutritionLevel: s.r.reviewStatus === 'VERIFIED' ? 'VERIFIED' : 'ESTIMATED',
    nutritionPerServing: {
      calories: s.r.calories, protein_g: s.r.proteinG, carbs_g: s.r.carbsG, fat_g: s.r.fatG, fiber_g: s.r.fiberG,
    },
    ingredients: s.r.ingredients.map((l) => ({
      ingredientId: l.ingredientId, name: l.ingredientName, amountG: l.amountG, optional: l.optional,
    })),
    matchScore: Math.round(s.score * 100) / 100, reasons: s.reasons,
    visuallySuggestedIngredients: s.covered,
  }));
}

// Attach recipe matches to each detected food component. Per-food failures degrade to
// empty matches rather than failing the whole scan response.
async function attachRecipeMatches(detectedFoods, userId) {
  if (!Array.isArray(detectedFoods) || !detectedFoods.length) return detectedFoods;
  return Promise.all(detectedFoods.map(async (f) => ({ ...f, recipeMatches: await matchDetectedFood(f, userId).catch(() => []) })));
}

module.exports = { attachRecipeMatches, matchDetectedFood, coverage };
