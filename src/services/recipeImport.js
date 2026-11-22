// Idempotent research-recipe importer. Recipes are keyed by `sourceKey`
// (e.g. HUMAI-RCP-0001); recipeName collisions with rows that don't carry the
// same sourceKey are conflicts, never silent overwrites — a user recipe named
// "Idli" must not be replaced by a catalog import.
//
// Ingredient lines are reconciled by normalized ingredientName: unchanged
// lines keep their ids (and any stored nutritionSnapshot), changed lines are
// updated in place, removed lines deleted, new lines created. No blind
// deleteMany+recreate.
const { isDeepStrictEqual } = require('node:util');
const { httpError } = require('../lib/errors');
const { normalize } = require('./ingredientCsv');

const REVIEW_DRAFT = 'RESEARCH_DRAFT';
// Zero-calorie / unmeasurable staples that never need a catalog link.
const UNLINKABLE = new Set(['water', 'salt', 'ice']);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const lineKey = (l) => normalize(l.ingredientName);

// Compute per-100g-of-recipe and per-serving macros from resolved ingredient
// lines when the source data does not supply totals. Uses each linked
// Ingredient's stored per-100g profile — never invented values. Lines without
// an ingredient link contribute only if they carry explicit macros.
function computeFromLines(lines, { servings, finishedYieldG, portionG }) {
  const t = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, computed: 0, missing: 0 };
  for (const l of lines) {
    const g = num(l.amountG) || 0;
    const per100 = l._per100; // {calories,proteinG,carbsG,fatG,fiberG} resolved from catalog
    if (per100) {
      l.calories = (per100.calories || 0) * g / 100;
      l.proteinG = (per100.proteinG || 0) * g / 100;
      l.carbsG = (per100.carbsG || 0) * g / 100;
      l.fatG = (per100.fatG || 0) * g / 100;
      t.computed++;
    } else {
      t.missing++;
    }
    t.calories += num(l.calories) || 0;
    t.proteinG += num(l.proteinG) || 0;
    t.carbsG += num(l.carbsG) || 0;
    t.fatG += num(l.fatG) || 0;
    if (per100?.fiberG != null) t.fiberG += per100.fiberG * g / 100;
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  const yieldG = num(finishedYieldG);
  const portion = num(portionG) || (yieldG && servings ? yieldG / servings : null);
  let scale;
  if (yieldG && portion && yieldG > 0) scale = portion / yieldG;
  else if (servings > 0) scale = 1 / servings;
  else scale = null;
  if (scale == null) return null;
  return {
    calories: r2(t.calories * scale),
    proteinG: r2(t.proteinG * scale),
    carbsG: r2(t.carbsG * scale),
    fatG: r2(t.fatG * scale),
    fiberG: t.computed ? r2(t.fiberG * scale) : null,
    _computedLines: t.computed,
    _unresolvedLines: t.missing,
  };
}

function toRecipeRow(r, computed) {
  const per = r.perServing || computed || {};
  const nutritionSource = {
    kind: r.perServing ? 'RECIPE_CALCULATED_FROM_UNVERIFIED_GENERIC_INGREDIENT_ESTIMATES' : 'COMPUTED_FROM_INGREDIENT_LINES',
    sourceKey: r.recipeKey,
    batchYieldG: num(r.finishedYieldG),
    yieldBasis: r.yieldBasis || null,
    nutritionConfidence: r.nutritionConfidence || null,
    carbDefinition: r.carbDefinition || null,
    energyMethod: r.perServing ? (r.energyMethod || null) : 'ingredient-line-sum',
    computedLines: computed?._computedLines ?? null,
    unresolvedLines: computed?._unresolvedLines ?? null,
    reviewStatus: r.reviewStatus || REVIEW_DRAFT,
    publishReady: false,
  };
  return {
    recipeName: String(r.recipeName || '').trim(),
    creatorId: 'system',
    isSystem: true,
    cuisine: r.cuisine || null,
    region: r.region || null,
    mealType: r.mealType || null,
    servings: Math.max(1, Math.round(num(r.servings) || 1)),
    portionG: num(r.portionG),
    finishedYieldG: num(r.finishedYieldG),
    prepMinutes: num(r.prepMinutes) == null ? null : Math.round(num(r.prepMinutes)),
    instructions: Array.isArray(r.instructions) ? r.instructions : null,
    safetyNotes: Array.isArray(r.safetyNotes) ? r.safetyNotes : null,
    allergens: Array.isArray(r.allergens) ? r.allergens.map(normalize).filter(Boolean) : [],
    calories: num(per.calories), proteinG: num(per.proteinG), carbsG: num(per.carbsG),
    fatG: num(per.fatG), fiberG: num(per.fiberG),
    description: r.description || null,
    aliases: Array.isArray(r.aliases) ? r.aliases.map(normalize).filter(Boolean) : [],
    reviewStatus: r.publishReady === true ? 'VERIFIED' : REVIEW_DRAFT,
    sourceKey: r.recipeKey,
    nutritionSource,
  };
}

function validateRecipeShape(r) {
  if (!r.recipeKey || !/^[\w-]{1,100}$/.test(r.recipeKey)) throw httpError(400, `Invalid recipeKey: ${r.recipeKey}`);
  if (!String(r.recipeName || '').trim() || String(r.recipeName).length > 200) throw httpError(400, `Missing recipeName: ${r.recipeKey}`);
  if (!Array.isArray(r.ingredients) || !r.ingredients.length) throw httpError(400, `No ingredient lines: ${r.recipeKey}`);
  for (const l of r.ingredients) {
    if (!l.ingredientName || !(num(l.amountG) > 0)) throw httpError(400, `Bad ingredient line in ${r.recipeKey}`);
  }
}

async function importRecipes(db, recipes, { apply = false, checksum = 'manual' } = {}) {
  if (!Array.isArray(recipes) || !recipes.length) throw httpError(400, 'recipes must be a nonempty array');
  const report = { input: recipes.length, inserted: 0, updated: 0, unchanged: 0, skipped: 0, conflicts: [], unresolvedLinks: [], linesChanged: 0, computedNutrition: 0, applied: apply };
  const srcs = recipes.map((r) => {
    try { validateRecipeShape(r); return r; }
    catch (e) { report.skipped++; report.conflicts.push({ id: r.recipeKey, reason: e.message }); return null; }
  }).filter(Boolean);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(6822982481)`;
    const catalogs = await tx.ingredientCatalog.findMany({
      where: { usable: true },
      include: { ingredient: { select: { id: true, caloriesPer100g: true, proteinPer100g: true, carbsPer100g: true, fatPer100g: true, fiberPer100g: true } } },
    });
    const catByKey = new Map();
    for (const c of catalogs) for (const k of [c.id, c.identityKey]) if (k && !catByKey.has(k)) catByKey.set(k, c);
    const catByIng = new Map(catalogs.map(c => [c.ingredient?.id, c]).filter(x => x[0]));
    const ingByName = new Map();
    for (const c of catalogs) for (const n of [c.normalizedName, ...c.aliases]) if (c.ingredient?.id && !ingByName.has(n)) ingByName.set(n, c);

    const rows = srcs.map((src) => {
      const lines = src.ingredients.map((l) => {
        const n = lineKey(l);
        const cat = (l.ingredientKey && catByKey.get(l.ingredientKey)) || ingByName.get(n) || null;
        if (!cat?.ingredient && !UNLINKABLE.has(n)) report.unresolvedLinks.push({ recipe: src.recipeKey, line: l.ingredientName });
        const ing = cat?.ingredient || null;
        return {
          ingredientId: ing?.id || null, ingredientName: String(l.ingredientName).slice(0, 200),
          amountG: num(l.amountG), optional: l.optional === true || l.role === 'optional' || l.role === 'garnish',
          calories: num(l.calories), proteinG: num(l.proteinG), carbsG: num(l.carbsG), fatG: num(l.fatG),
          _per100: ing ? { calories: ing.caloriesPer100g, proteinG: ing.proteinPer100g, carbsG: ing.carbsPer100g, fatG: ing.fatPer100g, fiberG: ing.fiberPer100g } : null,
        };
      });
      let computed = null;
      if (!src.perServing) {
        computed = computeFromLines(lines, { servings: src.servings, finishedYieldG: src.finishedYieldG, portionG: src.portionG });
        if (computed) report.computedNutrition++;
      }
      const row = toRecipeRow(src, computed);
      return { src, row, lines };
    });

    const existing = await tx.recipe.findMany({ where: { sourceKey: { in: rows.map(x => x.row.sourceKey) } }, include: { ingredients: true } });
    const bySourceKey = new Map(existing.map(r => [r.sourceKey, r]));
    const byName = new Map((await tx.recipe.findMany({ where: { recipeName: { in: rows.map(x => x.row.recipeName) } } })).map(r => [r.recipeName, r]));

    for (const { src, row, lines } of rows) {
      const nameOwner = byName.get(row.recipeName);
      if (nameOwner && nameOwner.sourceKey !== row.sourceKey) {
        report.skipped++;
        report.conflicts.push({ id: row.sourceKey, reason: `recipeName "${row.recipeName}" owned by ${nameOwner.sourceKey || nameOwner.id}; not overwritten` });
        continue;
      }

      const dbLines = lines.map(({ _per100, ...rest }) => rest);
      const old = bySourceKey.get(row.sourceKey);
      report[old ? 'updated' : 'inserted']++;
      if (!apply) continue;
      const { aliases, allergens, ...scalar } = row;
      let recipe;
      if (!old) {
        recipe = await tx.recipe.create({ data: { ...scalar, aliases, allergens } });
      } else {
        const changed = Object.entries(scalar).some(([k, v]) => !isDeepStrictEqual(old[k], v)) || !isDeepStrictEqual(old.aliases, aliases) || !isDeepStrictEqual(old.allergens, allergens);
        if (!changed) {
          const oldKeys = new Map(old.ingredients.map(l => [lineKey(l), l]));
          const same = dbLines.length === old.ingredients.length && dbLines.every(l => {
            const o = oldKeys.get(lineKey(l));
            return o && o.amountG === l.amountG && o.ingredientId === l.ingredientId && (o.optional ?? false) === l.optional;
          });
          if (same) { report.updated--; report.unchanged++; continue; }
        }
        recipe = await tx.recipe.update({ where: { id: old.id }, data: { ...scalar, aliases, allergens } });
      }
      // Line reconciliation — preserve ids of unchanged lines.
      const oldLines = old ? new Map(old.ingredients.map(l => [lineKey(l), l])) : new Map();
      const seen = new Set();
      for (const l of dbLines) {
        const k = lineKey(l); seen.add(k);
        const o = oldLines.get(k);
        if (!o) { await tx.recipeIngredient.create({ data: { recipeId: recipe.id, ...l } }); report.linesChanged++; continue; }
        const upd = { ingredientId: l.ingredientId, amountG: l.amountG, optional: l.optional, calories: l.calories, proteinG: l.proteinG, carbsG: l.carbsG, fatG: l.fatG };
        if (Object.entries(upd).some(([key, v]) => !isDeepStrictEqual(o[key], v))) {
          await tx.recipeIngredient.update({ where: { id: o.id }, data: upd }); report.linesChanged++;
        }
      }
      for (const o of old ? old.ingredients : []) if (!seen.has(lineKey(o))) { await tx.recipeIngredient.delete({ where: { id: o.id } }); report.linesChanged++; }
    }
    if (apply) await tx.ingredientImport.create({ data: { checksum, filename: 'recipes-expansion', report } });
    return report;
  }, { timeout: 300000 });
}

module.exports = { importRecipes, toRecipeRow, computeFromLines, REVIEW_DRAFT };
