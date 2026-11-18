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

function toRecipeRow(r) {
  const per = r.perServing || {};
  const nutritionSource = {
    kind: 'RECIPE_CALCULATED_FROM_UNVERIFIED_GENERIC_INGREDIENT_ESTIMATES',
    sourceKey: r.recipeKey,
    batchYieldG: num(r.finishedYieldG),
    yieldBasis: r.yieldBasis || null,
    nutritionConfidence: r.nutritionConfidence || null,
    carbDefinition: r.carbDefinition || null,
    energyMethod: r.energyMethod || null,
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
    calories: num(per.calories), proteinG: num(per.proteinG), carbsG: num(per.carbsG),
    fatG: num(per.fatG), fiberG: num(per.fiberG),
    description: r.description || null,
    aliases: Array.isArray(r.aliases) ? r.aliases.map(normalize).filter(Boolean) : [],
    reviewStatus: r.publishReady === true ? 'VERIFIED' : REVIEW_DRAFT,
    sourceKey: r.recipeKey,
    nutritionSource,
  };
}

function validateRecipe(r) {
  if (!r.recipeKey || !/^[\w-]{1,100}$/.test(r.recipeKey)) throw httpError(400, `Invalid recipeKey: ${r.recipeKey}`);
  const row = toRecipeRow(r);
  if (!row.recipeName || row.recipeName.length > 200) throw httpError(400, `Missing recipeName: ${r.recipeKey}`);
  if (!Array.isArray(r.ingredients) || !r.ingredients.length) throw httpError(400, `No ingredient lines: ${r.recipeKey}`);
  for (const l of r.ingredients) {
    if (!l.ingredientName || !(num(l.amountG) > 0)) throw httpError(400, `Bad ingredient line in ${r.recipeKey}`);
  }
  return row;
}

async function importRecipes(db, recipes, { apply = false, checksum = 'manual' } = {}) {
  if (!Array.isArray(recipes) || !recipes.length) throw httpError(400, 'recipes must be a nonempty array');
  const report = { input: recipes.length, inserted: 0, updated: 0, unchanged: 0, skipped: 0, conflicts: [], unresolvedLinks: [], linesChanged: 0, applied: apply };
  const rows = recipes.map((r) => {
    try { return { src: r, row: validateRecipe(r) }; }
    catch (e) { report.skipped++; report.conflicts.push({ id: r.recipeKey, reason: e.message }); return null; }
  }).filter(Boolean);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(6822982481)`;
    const existing = await tx.recipe.findMany({ where: { sourceKey: { in: rows.map(x => x.row.sourceKey) } }, include: { ingredients: true } });
    const bySourceKey = new Map(existing.map(r => [r.sourceKey, r]));
    const byName = new Map((await tx.recipe.findMany({ where: { recipeName: { in: rows.map(x => x.row.recipeName) } } })).map(r => [r.recipeName, r]));
    const catalogs = await tx.ingredientCatalog.findMany({ where: { usable: true }, include: { ingredient: { select: { id: true } } } });
    const ingByCatId = new Map(catalogs.map(c => [c.id, c.ingredient?.id]).filter(x => x[1]));
    const ingByName = new Map();
    for (const c of catalogs) for (const n of [c.normalizedName, ...c.aliases]) if (c.ingredient?.id && !ingByName.has(n)) ingByName.set(n, c.ingredient.id);

    for (const { src, row } of rows) {
      const nameOwner = byName.get(row.recipeName);
      if (nameOwner && nameOwner.sourceKey !== row.sourceKey) {
        report.skipped++;
        report.conflicts.push({ id: row.sourceKey, reason: `recipeName "${row.recipeName}" owned by ${nameOwner.sourceKey || nameOwner.id}; not overwritten` });
        continue;
      }
      const lines = src.ingredients.map((l) => {
        const n = lineKey(l);
        const linked = (l.ingredientKey && ingByCatId.get(l.ingredientKey)) || ingByName.get(n) || null;
        if (!linked && !UNLINKABLE.has(n)) report.unresolvedLinks.push({ recipe: row.sourceKey, line: l.ingredientName });
        return {
          ingredientId: linked, ingredientName: String(l.ingredientName).slice(0, 200),
          amountG: num(l.amountG), calories: num(l.calories), proteinG: num(l.proteinG), carbsG: num(l.carbsG), fatG: num(l.fatG),
        };
      });

      const old = bySourceKey.get(row.sourceKey);
      report[old ? 'updated' : 'inserted']++;
      if (!apply) continue;
      const { aliases, ...scalar } = row;
      let recipe;
      if (!old) {
        recipe = await tx.recipe.create({ data: { ...scalar, aliases } });
      } else {
        const changed = Object.entries(scalar).some(([k, v]) => !isDeepStrictEqual(old[k], v)) || !isDeepStrictEqual(old.aliases, aliases);
        if (!changed) {
          const oldKeys = new Map(old.ingredients.map(l => [lineKey(l), l]));
          const same = lines.length === old.ingredients.length && lines.every(l => {
            const o = oldKeys.get(lineKey(l));
            return o && o.amountG === l.amountG && o.ingredientId === l.ingredientId;
          });
          if (same) { report.updated--; report.unchanged++; continue; }
        }
        recipe = await tx.recipe.update({ where: { id: old.id }, data: { ...scalar, aliases } });
      }
      // Line reconciliation — preserve ids of unchanged lines.
      const oldLines = old ? new Map(old.ingredients.map(l => [lineKey(l), l])) : new Map();
      const seen = new Set();
      for (const l of lines) {
        const k = lineKey(l); seen.add(k);
        const o = oldLines.get(k);
        if (!o) { await tx.recipeIngredient.create({ data: { recipeId: recipe.id, ...l } }); report.linesChanged++; continue; }
        const upd = { ingredientId: l.ingredientId, amountG: l.amountG, calories: l.calories, proteinG: l.proteinG, carbsG: l.carbsG, fatG: l.fatG };
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

module.exports = { importRecipes, toRecipeRow, REVIEW_DRAFT };
