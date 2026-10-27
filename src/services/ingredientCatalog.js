const { isDeepStrictEqual } = require('node:util');
const { httpError } = require('../lib/errors');
const normalize = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const fields = ['kcal_per_100g', 'protein_g_per_100g', 'carbs_g_per_100g', 'fat_g_per_100g'];
function validateCatalog(rows) {
  if (!Array.isArray(rows) || !rows.length) throw Error('Catalog must be a nonempty array.');
  const ids = new Set(), names = new Set();
  return rows.map(row => {
    if (!row || typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(row.id) || typeof row.name !== 'string' || !normalize(row.name)) throw Error('Every catalog record requires a stable ID and name.');
    const normalizedName = normalize(row.name);
    if (ids.has(row.id) || names.has(normalizedName)) throw Error('Duplicate catalog ID or normalized name.');
    ids.add(row.id); names.add(normalizedName);
    if (!['SOURCE_MEASURED', 'GENERIC_COMPOSITION', 'IDENTITY_DERIVED', 'NEEDS_SOURCE_MATCH'].includes(row.status)) throw Error(`Unsupported status: ${row.id}`);
    const usable = row.status !== 'NEEDS_SOURCE_MATCH' && fields.every(key => row[key] != null) && (!/EXCLUDES fibre/i.test(row.carb_definition || '') || row.fiber_g_per_100g != null);
    if (!['100 g', '100 g edible portion'].includes(row.basis)) throw Error(`Unsupported nutrition basis: ${row.id}`);
    for (const key of [...fields, 'fiber_g_per_100g']) {
      const value = row[key];
      if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > (key === 'kcal_per_100g' ? 1000 : 100))) throw Error(`Invalid ${key}: ${row.id}`);
      if (usable && fields.includes(key) && value == null) throw Error(`Missing nutrition: ${row.id}`);
    }
    if (usable && (!row.source || !row.carb_definition)) throw Error(`Missing nutrition provenance: ${row.id}`);
    if (usable && /EXCLUDES fibre/i.test(row.carb_definition) && row.fiber_g_per_100g == null) throw Error(`Missing fiber for carbohydrate conversion: ${row.id}`);
    return { row, normalizedName, usable, aliases: [...new Set(String(row.search_aliases || '').split(';').map(normalize).filter(Boolean))] };
  });
}
function nutrition(row) {
  return { caloriesPer100g: row.kcal_per_100g, proteinPer100g: row.protein_g_per_100g,
    // App macros use total carbohydrate; preserve the supplied available carbohydrate in sourceRecord.
    carbsPer100g: Math.round((row.carbs_g_per_100g + (/EXCLUDES fibre/i.test(row.carb_definition) ? row.fiber_g_per_100g : 0)) * 10000) / 10000,
    fatPer100g: row.fat_g_per_100g, fiberPer100g: row.fiber_g_per_100g };
}
async function importCatalog(prisma, rows, apply = false) {
  let entries;
  try { entries = validateCatalog(rows); } catch (error) { error.code = 'CATALOG_VALIDATION'; throw error; }
  return prisma.$transaction(async tx => {
    // Serialize importer runs and preserve identity links across repeated imports.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(6822982480)`;
    const report = { total: entries.length, usable: entries.filter(x => x.usable).length, hidden: entries.filter(x => !x.usable).length, created: 0, updated: 0, linkedExisting: 0, applied: apply };
    // Read reference rows once: remote imports must not do thousands of round trips.
    const catalogs = await tx.ingredientCatalog.findMany();
    const ingredients = await tx.ingredient.findMany();
    const byId = new Map(catalogs.map(x => [x.id, x]));
    const byName = new Map(catalogs.map(x => [x.normalizedName, x]));
    const byCatalog = new Map(ingredients.filter(x => x.catalogId).map(x => [x.catalogId, x]));
    const byIngredientName = new Map();
    for (const ingredient of ingredients) {
      const matches = byIngredientName.get(ingredient.normalizedName) || [];
      matches.push(ingredient); byIngredientName.set(ingredient.normalizedName, matches);
    }
    const newCatalogs = [], newIngredients = [];
    for (const { row, normalizedName, aliases, usable } of entries) {
      const old = byId.get(row.id);
      if (old?.verificationLevel) throw httpError(409, "Legacy importer cannot overwrite v5; use ingredients:import:v5");
      const collision = byName.get(normalizedName);
      if (collision && collision.id !== row.id) throw httpError(409, `Name belongs to another catalog ID: ${row.name}`);
      let ingredient = byCatalog.get(row.id);
      if (!ingredient && usable) {
        const matches = byIngredientName.get(normalizedName) || [];
        if (matches.length > 1 || matches.some(x => x.catalogId && x.catalogId !== row.id)) throw httpError(409, `Ambiguous existing ingredient: ${row.name}`);
        ingredient = matches[0];
        if (ingredient) report.linkedExisting++;
      }
      report[old ? 'updated' : 'created']++;
      if (!apply) continue;
      const data = { name: row.name, normalizedName, aliases, category: row.category || '', preparation: row.preparation || '', status: row.status, usable, sourceRecord: row };
      if (!old) newCatalogs.push({ id: row.id, ...data });
      else if (Object.entries(data).some(([key, value]) => !isDeepStrictEqual(old[key], value))) {
        await tx.ingredientCatalog.update({ where: { id: row.id }, data });
      }
      if (usable) {
        const values = { name: row.name, normalizedName, catalogId: row.id, source: 'humai-catalog', ...nutrition(row) };
        if (ingredient) {
          // New catalog parents must exist before linking an existing ingredient.
          if (!old) { await tx.ingredientCatalog.create({ data: newCatalogs.pop() }); }
          if (Object.entries(values).some(([key, value]) => !isDeepStrictEqual(ingredient[key], value))) {
            await tx.ingredient.update({ where: { id: ingredient.id }, data: values });
          }
        } else newIngredients.push(values);
      }
    }
    if (newCatalogs.length) await tx.ingredientCatalog.createMany({ data: newCatalogs });
    if (newIngredients.length) await tx.ingredient.createMany({ data: newIngredients });
    return report;
  }, { timeout: 120000 });
}
module.exports = { normalize, validateCatalog, nutrition, importCatalog };
