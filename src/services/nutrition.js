const { httpError } = require('../lib/errors');
const keys = ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'sugarG', 'sodiumMg', 'saturatedFatG'];
const round = n => Math.round((n + Number.EPSILON) * 10000) / 10000;
function quantity(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000) throw httpError(400, 'Invalid quantity in grams');
  return value;
}
function scale(per100g, grams) {
  quantity(grams);
  return Object.fromEntries(keys.map(k => {
    const v = per100g[k];
    if (v != null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) throw httpError(400, `Invalid nutrient ${k}`);
    return [k, v == null ? null : round(v * grams / 100)];
  }));
}
function recipe(parts, yieldGrams) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 100) throw httpError(400, 'Recipe needs 1–100 ingredients');
  const scaled = parts.map(p => scale(p.per100g, p.grams));
  const totals = Object.fromEntries(keys.map(k => [k, scaled.some(p => p[k] == null) ? null : round(scaled.reduce((s,p) => s + p[k],0))]));
  const cookedYieldG = yieldGrams == null ? parts.reduce((s,p) => s + p.grams,0) : quantity(yieldGrams);
  if (!cookedYieldG) throw httpError(400, 'Recipe yield must be positive');
  return { totals, yieldGrams: cookedYieldG, per100g: scale(totals, 10000 / cookedYieldG) };
}
function totalCarbs(row) {
  if (row.total_carbs_g_per_100g != null) return row.total_carbs_g_per_100g;
  if (row.carbs_g_per_100g == null) return null;
  if (/excludes fibre|available carbohydrate/i.test(row.carb_definition || '')) return row.fiber_g_per_100g == null ? null : round(row.carbs_g_per_100g + row.fiber_g_per_100g);
  if (/total|not applicable/i.test(row.carb_definition || '')) return row.carbs_g_per_100g;
  return null;
}
function fromIngredient(i) {
 const r=i.catalog?.sourceRecord || {};
 return {calories:i.caloriesPer100g,proteinG:i.proteinPer100g,carbsG:i.carbsPer100g,fatG:i.fatPer100g,fiberG:i.fiberPer100g ?? null,sugarG:r.sugar_g_per_100g ?? null,sodiumMg:r.sodium_mg_per_100g ?? null,saturatedFatG:r.saturated_fat_g_per_100g ?? null};
}
module.exports = { keys, scale, recipe, totalCarbs, quantity, fromIngredient };
