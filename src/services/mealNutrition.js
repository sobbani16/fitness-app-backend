// Deterministic nutrition for user-reviewed scanned meals: resolves each confirmed
// line to the catalog/ingredient per-100g profile and computes totals. Never trusts
// AI-provided nutrition; unknown micronutrients stay null rather than zero.
const { getPrisma } = require('../lib/prisma');
const { normalize } = require('./ingredientCsv');
const { httpError } = require('../lib/errors');

const CALC_VERSION = 'ingredient-lines-v1';
const MAX_ITEMS = 50;
const MAX_AMOUNT_G = 20000;

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const scale = (per100, g) => (per100 == null ? null : (per100 * g) / 100);

async function resolveIngredient(prisma, item, catalogByName) {
  if (item.ingredientId) {
    const ing = await prisma.ingredient.findUnique({ where: { id: item.ingredientId }, select: { id: true, name: true, caloriesPer100g: true, proteinPer100g: true, carbsPer100g: true, fatPer100g: true, fiberPer100g: true } });
    if (ing) return ing;
    throw httpError(400, `Unknown ingredientId: ${String(item.ingredientId).slice(0, 60)}`);
  }
  return catalogByName.get(normalize(item.name || '')) || null;
}

async function computeMealNutrition(userId, input) {
  if (!userId) throw httpError(401, 'Sign in required.');
  const items = Array.isArray(input?.items) ? input.items : null;
  if (!items || !items.length) throw httpError(400, 'Provide at least one ingredient line.');
  if (items.length > MAX_ITEMS) throw httpError(400, `Too many items (max ${MAX_ITEMS}).`);
  for (const it of items) {
    const g = it?.amountG;
    if (!Number.isFinite(g) || g <= 0 || g > MAX_AMOUNT_G) throw httpError(400, 'Each item needs amountG between 0 and 20000.');
    if (!it.ingredientId && typeof it.name !== 'string') throw httpError(400, 'Each item needs ingredientId or name.');
  }
  const prisma = getPrisma();
  const catalog = await prisma.ingredientCatalog.findMany({
    select: { normalizedName: true, aliases: true, ingredient: { select: { id: true, name: true, caloriesPer100g: true, proteinPer100g: true, carbsPer100g: true, fatPer100g: true, fiberPer100g: true } } },
  });
  const catalogByName = new Map();
  for (const c of catalog) {
    if (!c.ingredient?.id) continue;
    for (const key of [c.normalizedName, ...c.aliases]) if (key && !catalogByName.has(key)) catalogByName.set(key, c.ingredient);
  }
  const lines = [];
  const unresolved = [];
  for (const it of items) {
    const ing = await resolveIngredient(prisma, it, catalogByName);
    if (!ing) { unresolved.push({ name: String(it.name || '').slice(0, 120), amountG: it.amountG }); continue; }
    lines.push({
      ingredientId: ing.id, name: ing.name, amountG: it.amountG,
      calories: round1(scale(ing.caloriesPer100g, it.amountG)),
      protein_g: round1(scale(ing.proteinPer100g, it.amountG)),
      carbs_g: round1(scale(ing.carbsPer100g, it.amountG)),
      fat_g: round1(scale(ing.fatPer100g, it.amountG)),
      fiber_g: round1(scale(ing.fiberPer100g, it.amountG)),
      fiberKnown: ing.fiberPer100g != null,
      source: 'ingredient-per-100g',
    });
  }
  const totals = lines.reduce((a, l) => ({
    calories: a.calories + (l.calories || 0),
    protein_g: a.protein_g + (l.protein_g || 0),
    carbs_g: a.carbs_g + (l.carbs_g || 0),
    fat_g: a.fat_g + (l.fat_g || 0),
    fiber_g: l.fiber_g != null ? a.fiber_g + l.fiber_g : a.fiber_g,
  }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });
  return {
    calculationVersion: CALC_VERSION,
    lines, unresolved,
    totals: { calories: Math.round(totals.calories), protein_g: round1(totals.protein_g), carbs_g: round1(totals.carbs_g), fat_g: round1(totals.fat_g), fiber_g: round1(totals.fiber_g) },
    totalGrams: items.reduce((a, i) => a + i.amountG, 0),
    fiberComplete: lines.every((l) => l.fiberKnown),
    provenance: unresolved.length ? 'partial — some lines unresolved' : 'ingredient lines — computed from per-100g profiles',
  };
}

module.exports = { computeMealNutrition, CALC_VERSION };
