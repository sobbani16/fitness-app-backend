// Relational ingredient-based recipe matching. Inputs resolve to canonical
// catalog ingredients (name or alias); a recipe line "matches" when its linked
// ingredientId is among the selected set. Water/salt-type staples never count
// as missing. Never claims "you have everything" — missing lines are always
// reported.
const { getPrisma } = require('../lib/prisma');
const { normalize } = require('./ingredientCsv');
const { httpError } = require('../lib/errors');

const PANTRY = new Set(['water', 'salt', 'ice', 'water for soaking', 'water for cooking', 'warm water']);

async function matchRecipes({ userId, ingredients, limit = 12 }) {
  if (!userId) throw httpError(401, 'Sign in required.');
  if (!Array.isArray(ingredients) || !ingredients.length || ingredients.length > 20) throw httpError(400, 'ingredients must be 1–20 names.');
  const prisma = getPrisma();
  const wanted = [...new Set(ingredients.map(normalize).filter(Boolean))];
  if (!wanted.length) throw httpError(400, 'ingredients must be non-empty names.');

  // Resolve selected names → canonical ingredient ids via catalog names+aliases.
  const catalog = await prisma.ingredientCatalog.findMany({ where: { usable: true }, select: { normalizedName: true, aliases: true, ingredient: { select: { id: true } } } });
  const selectedIds = new Set();
  const unresolvedInputs = [];
  for (const w of wanted) {
    const variants = new Set([w]);
    if (w.endsWith('es')) variants.add(w.slice(0, -2));
    if (w.endsWith('s') && !w.endsWith('ss')) variants.add(w.slice(0, -1));
    variants.add(`${w}s`);
    const hits = catalog.filter((c) => [...variants].some((v) => c.normalizedName === v || c.aliases.includes(v) || c.normalizedName.includes(v)) && c.ingredient?.id);
    if (hits.length) hits.forEach((h) => selectedIds.add(h.ingredient.id));
    else unresolvedInputs.push(w);
  }

  const recipes = await prisma.recipe.findMany({
    where: { reviewStatus: { not: 'REJECTED' }, OR: [{ isSystem: true }, { creatorId: userId }] },
    include: { ingredients: true },
  });

  const ranked = [];
  for (const r of recipes) {
    const required = r.ingredients.filter((l) => !PANTRY.has(normalize(l.ingredientName)));
    if (!required.length) continue;
    const matched = required.filter((l) => l.ingredientId && selectedIds.has(l.ingredientId));
    const nameMatched = required.filter((l) => !l.ingredientId && wanted.some((w) => normalize(l.ingredientName).includes(w)));
    const missing = required.filter((l) => !(l.ingredientId && selectedIds.has(l.ingredientId)) && !wanted.some((w) => normalize(l.ingredientName).includes(w)));
    const hits = matched.length + nameMatched.length;
    if (!hits) continue;
    ranked.push({
      recipe: {
        id: r.id, name: r.recipeName, cuisine: r.cuisine, region: r.region, mealType: r.mealType,
        servings: r.servings, portionG: r.portionG,
        perServing: { calories: r.calories, proteinG: r.proteinG, carbsG: r.carbsG, fatG: r.fatG, fiberG: r.fiberG },
        verificationLevel: r.reviewStatus === 'VERIFIED' ? 'VERIFIED' : 'ESTIMATED',
      },
      matched: [...matched.map((l) => l.ingredientName), ...nameMatched.map((l) => l.ingredientName)],
      missing: missing.map((l) => l.ingredientName),
      coverage: Math.round((hits / required.length) * 100) / 100,
    });
  }
  ranked.sort((a, b) => b.coverage - a.coverage || a.missing.length - b.missing.length || a.recipe.name.localeCompare(b.recipe.name));
  return { results: ranked.slice(0, limit), unresolvedInputs };
}

module.exports = { matchRecipes };
