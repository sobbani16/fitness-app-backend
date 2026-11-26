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

// HUM-49 Workstream C: pure calculation over explicitly-declared nutrition
// bases. Scaling uses ONLY the matching unit — no mass/volume conversion
// happens here (density-guarded conversion lives in ingredientNutrition).
// Unknown nutrients stay null — measured zero and unknown are never merged.
// Mass is null for native volume/serving input with no documented mass.
const BASES = ['PER_100_G', 'PER_100_ML', 'PER_SERVING'];
function calculateDeclared(declared, input = {}) {
  if (!declared || typeof declared !== 'object') throw httpError(400, 'declared nutrition required');
  const { basis, nutrients = {} } = declared;
  if (!BASES.includes(basis)) throw httpError(400, `unsupported_basis: must be one of ${BASES.join('|')}`);
  const refQ = declared.referenceQuantity != null ? declared.referenceQuantity : (basis === 'PER_SERVING' ? 1 : 100);
  if (!Number.isFinite(refQ) || refQ <= 0 || refQ > 100000) throw httpError(400, 'invalid reference quantity');
  const bad = (k) => /^\d+G$|^\d+Mg$/.test(k);
  const unitFor = { PER_100_G: 'grams', PER_100_ML: 'volumeMl', PER_SERVING: 'servingCount' };
  const requiredInput = unitFor[basis];
  const amount = input[requiredInput];
  // Unit mismatch: input supplied in a NON-matching unit while the matching
  // one is absent — conversion is out of scope for the pure helper.
  const supplied = ['grams', 'volumeMl', 'servingCount'].filter((k) => input[k] != null);
  if (amount == null && supplied.length) {
    throw httpError(400, `unit_mismatch: ${basis} nutrition scales by ${requiredInput}, not ${supplied[0]}`);
  }
  if (amount == null) throw httpError(400, `missing ${requiredInput} for ${basis} calculation`);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    throw httpError(400, `invalid ${requiredInput}`);
  }
  const factor = basis === 'PER_SERVING' ? amount / refQ : amount / refQ;
  const nutrition = Object.fromEntries(keys.map((k) => {
    const v = nutrients[k];
    if (v != null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) throw httpError(400, `Invalid nutrient ${k}`);
    return [k, v == null ? null : round(v * factor)];
  }));
  // Mass: known ONLY when input itself is mass. Volume/serving input leaves
  // mass unknown unless a documented serving mass accompanies the input.
  let massG = null;
  if (basis === 'PER_100_G') massG = round(amount);
  else if (basis === 'PER_SERVING' && input.servingMassG != null) {
    if (!Number.isFinite(input.servingMassG) || input.servingMassG <= 0) throw httpError(400, 'invalid servingMassG');
    massG = round(input.servingMassG * factor); // servingMassG is per reference serving
  }
  return {
    nutrition,
    massG,
    basis,
    referenceQuantity: refQ,
    input: { [requiredInput]: amount },
    calculation: `${basis} × ${amount}/${refQ}`,
  };
}

module.exports = { keys, scale, recipe, totalCarbs, quantity, fromIngredient, calculateDeclared };
