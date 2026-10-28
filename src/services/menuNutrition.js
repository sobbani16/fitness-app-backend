// Enriches parsed menu items with nutrition using the existing catalog.
// Hierarchy: restaurant-reported > catalog/recipe match > insufficient info.
// Never invents exact values: estimates are ranges with named assumptions.

// Typical plated portion ranges (grams) by section/type — used only when the
// menu states no portion. Ranges reflect real restaurant variance.
const PORTION_RANGES = [
  { match: /biryani|pulao|fried rice|rice bowl/i, grams: [300, 450] },
  { match: /curry|gravy|dal|paneer|tikka masala|korma/i, grams: [200, 350] },
  { match: /starter|appetizer|tikka|kabob|kebab|tikki/i, grams: [150, 250] },
  { match: /salad|soup/i, grams: [200, 300] },
  { match: /burger|sandwich|wrap|pizza/i, grams: [200, 350] },
  { match: /dessert|cake|kulfi|ice cream|gulab|halwa/i, grams: [100, 200] },
  { match: /lassi|shake|juice|smoothie|coffee|tea|chai/i, grams: [200, 350] },
  { match: /naan|roti|bread|dosa|idli|paratha/i, grams: [60, 150] },
];
const DEFAULT_RANGE = [200, 400];

function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function portionRangeFor(item) {
  const text = `${item.section || ''} ${item.name}`;
  for (const r of PORTION_RANGES) if (r.match.test(text)) return r.grams;
  return DEFAULT_RANGE;
}

// Splits a dish name into candidate lookup terms, longest first.
function candidateTerms(name) {
  const n = normalizeName(name);
  const terms = [n];
  const words = n.split(' ');
  for (let len = Math.min(words.length, 3); len >= 2; len -= 1) {
    terms.push(words.slice(0, len).join(' '));
  }
  for (const w of words) if (w.length >= 4) terms.push(w);
  return [...new Set(terms)];
}

async function findCatalogMatch(prisma, name) {
  for (const term of candidateTerms(name)) {
    if (term.length < 3) continue;
    // User-facing recipes first (they carry per-100g nutrition), then central ingredients.
    const recipe = await prisma.recipe.findFirst({
      where: { recipeName: { contains: term, mode: 'insensitive' } },
      select: { recipeName: true, calories: true, proteinG: true, carbsG: true, fatG: true, fiberG: true, portionG: true, servings: true },
    }).catch(() => null);
    if (recipe && recipe.calories != null) {
      const basisG = recipe.portionG && recipe.portionG > 0 ? recipe.portionG : 100;
      return { kind: 'recipe', name: recipe.recipeName, per100: { calories: (recipe.calories / basisG) * 100, protein: ((recipe.proteinG || 0) / basisG) * 100, carbs: ((recipe.carbsG || 0) / basisG) * 100, fat: ((recipe.fatG || 0) / basisG) * 100, fiber: recipe.fiberG == null ? null : (recipe.fiberG / basisG) * 100 } };
    }
    const ingredient = await prisma.ingredient.findFirst({
      where: { normalizedName: { contains: term } },
      select: { name: true, caloriesPer100g: true, proteinPer100g: true, carbsPer100g: true, fatPer100g: true, fiberPer100g: true },
    }).catch(() => null);
    if (ingredient) {
      return { kind: 'ingredient', name: ingredient.name, per100: { calories: ingredient.caloriesPer100g, protein: ingredient.proteinPer100g, carbs: ingredient.carbsPer100g, fat: ingredient.fatPer100g, fiber: ingredient.fiberPer100g } };
    }
  }
  return null;
}

function rangeFor(per100, portionRange) {
  const scale = per100 / 100;
  return {
    min: Math.round(scale * portionRange[0]),
    max: Math.round(scale * portionRange[1]),
    portionGMin: portionRange[0],
    portionGMax: portionRange[1],
  };
}

async function enrichMenuItems(prisma, items) {
  const out = [];
  for (const item of items) {
    const base = { ...item };
    if (item.calories != null) {
      out.push({ ...base, nutritionSource: 'restaurant-reported', estimate: null, explanation: 'Calories printed on the menu.' });
      continue;
    }
    const match = await findCatalogMatch(prisma, item.name);
    if (!match) {
      out.push({ ...base, nutritionSource: 'insufficient_information', estimate: null, explanation: 'Not enough information — confirm the portion or search this dish manually.' });
      continue;
    }
    const portion = portionRangeFor(item);
    const kcal = rangeFor(match.per100.calories || 0, portion);
    out.push({
      ...base,
      nutritionSource: 'estimated',
      estimate: {
        calories: kcal,
        proteinG: { min: Math.round((match.per100.protein || 0) / 100 * portion[0]), max: Math.round((match.per100.protein || 0) / 100 * portion[1]) },
        carbsG: { min: Math.round((match.per100.carbs || 0) / 100 * portion[0]), max: Math.round((match.per100.carbs || 0) / 100 * portion[1]) },
        fatG: { min: Math.round((match.per100.fat || 0) / 100 * portion[0]), max: Math.round((match.per100.fat || 0) / 100 * portion[1]) },
      },
      matchedTo: { kind: match.kind, name: match.name },
      explanation: `Estimated from "${match.name}" nutrition (${match.kind}) at a typical ${portion[0]}–${portion[1]} g serving. Restaurant recipes and portions vary.`,
    });
  }
  return out;
}

module.exports = { enrichMenuItems, normalizeName, portionRangeFor };
