// Recipe nutrition reconciliation — pure functions shared by
// scripts/recipe-nutrition-audit.js and tests/recipeReconcile.test.js.
// Recomputes stored recipe macros from resolved ingredient lines so stored
// values can be drift-checked. Unknown is not zero: fiber stays null when no
// line carries it.

const KEYS = ['calories', 'proteinG', 'carbsG', 'fatG'];
const DRIFT_PCT = 5;

function recompute(recipe, byId) {
  const t = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, computed: 0, missing: 0, fiberMissing: true };
  for (const l of recipe.ingredients) {
    const i = l.ingredientId ? byId.get(l.ingredientId) : null;
    const g = Number(l.amountG) || 0;
    if (!i || g <= 0) { t.missing++; continue; }
    if (i.caloriesPer100g == null) { t.missing++; continue; }
    t.computed++;
    t.calories += (i.caloriesPer100g || 0) * g / 100;
    t.proteinG += (i.proteinPer100g || 0) * g / 100;
    t.carbsG += (i.carbsPer100g || 0) * g / 100;
    t.fatG += (i.fatPer100g || 0) * g / 100;
    if (i.fiberPer100g != null) { t.fiberMissing = false; t.fiberG += i.fiberPer100g * g / 100; }
  }
  const yieldG = Number(recipe.finishedYieldG);
  const portion = Number(recipe.portionG) || (yieldG && recipe.servings ? yieldG / recipe.servings : null);
  let scale = null;
  if (yieldG && portion && yieldG > 0) scale = portion / yieldG;
  else if (recipe.servings > 0) scale = 1 / recipe.servings;
  if (scale == null || !t.computed) return null;
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    calories: r2(t.calories * scale), proteinG: r2(t.proteinG * scale),
    carbsG: r2(t.carbsG * scale), fatG: r2(t.fatG * scale),
    fiberG: t.fiberMissing ? null : r2(t.fiberG * scale),
    _computedLines: t.computed, _unresolvedLines: t.missing,
  };
}

const driftPct = (stored, recomputed) =>
  stored == null || recomputed == null ? null :
  stored === 0 ? (recomputed === 0 ? 0 : Infinity) :
  Math.abs(recomputed - stored) / Math.abs(stored) * 100;

module.exports = { KEYS, DRIFT_PCT, recompute, driftPct };
