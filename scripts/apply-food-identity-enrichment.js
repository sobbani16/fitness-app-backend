// Idempotent food-identity enrichment applier.
// Reads a versioned manifest (default data/imports/food-identity-enrichment-v1.json)
// and applies: catalog alias patches, gut-taxonomy IngredientAttribute rows,
// and Ingredient rows keyed by fdcId. Safe to re-run — every write resolves by
// canonical identity or a unique key; nothing is duplicated.
// Usage: node scripts/apply-food-identity-enrichment.js [manifestPath] [--dry-run]
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { getPrisma } = require('../src/lib/prisma');

const manifestPath = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : path.join(__dirname, '../data/imports/food-identity-enrichment-v1.json');
const DRY = process.argv.includes('--dry-run');

(async () => {
  const p = getPrisma();
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const report = { manifest: m.manifest, version: m.version, dryRun: DRY, aliasPatches: [], taxonomyAttributes: [], ingredients: [] };

  for (const ap of m.aliasPatches || []) {
    const cat = await p.ingredientCatalog.findFirst({ where: { normalizedName: ap.catalogNormalizedName } });
    if (!cat) { report.aliasPatches.push({ name: ap.catalogNormalizedName, status: 'CATALOG_ROW_MISSING' }); continue; }
    const merged = [...new Set([...(cat.aliases || []), ...ap.aliases])];
    const changed = merged.length !== cat.aliases.length;
    if (changed && !DRY) await p.ingredientCatalog.update({ where: { id: cat.id }, data: { aliases: merged } });
    report.aliasPatches.push({ name: ap.catalogNormalizedName, status: changed ? (DRY ? 'WOULD_UPDATE' : 'UPDATED') : 'ALREADY_CURRENT', aliases: merged.length });
  }

  for (const t of m.taxonomyAttributes || []) {
    const cat = await p.ingredientCatalog.findFirst({ where: { normalizedName: t.catalogNormalizedName }, include: { ingredient: true } });
    if (!cat?.ingredient) { report.taxonomyAttributes.push({ name: t.catalogNormalizedName, status: 'NO_LINKED_INGREDIENT' }); continue; }
    let created = 0;
    for (const attribute of t.attributes) {
      const where = { ingredientId_attribute: { ingredientId: cat.ingredient.id, attribute } };
      const exists = await p.ingredientAttribute.findUnique({ where });
      if (!exists && !DRY) await p.ingredientAttribute.create({ data: { ingredientId: cat.ingredient.id, attribute } });
      if (!exists) created += 1;
    }
    report.taxonomyAttributes.push({ name: t.catalogNormalizedName, status: created ? (DRY ? 'WOULD_CREATE' : 'CREATED') : 'ALREADY_CURRENT', created });
  }

  for (const ing of m.ingredients || []) {
    const exists = await p.ingredient.findUnique({ where: { fdcId: ing.fdcId } })
      || await p.ingredient.findFirst({ where: { normalizedName: ing.normalizedName } });
    if (exists) { report.ingredients.push({ name: ing.name, status: 'ALREADY_CURRENT', id: exists.id }); continue; }
    if (!DRY) {
      const created = await p.ingredient.create({ data: {
        fdcId: ing.fdcId, name: ing.name, normalizedName: ing.normalizedName,
        caloriesPer100g: ing.macrosPer100g.calories, proteinPer100g: ing.macrosPer100g.proteinG,
        carbsPer100g: ing.macrosPer100g.carbsG, fatPer100g: ing.macrosPer100g.fatG, fiberPer100g: ing.macrosPer100g.fiberG,
        source: ing.source, sourceMetadata: { fdcId: ing.fdcId, basis: ing.nutritionBasis, manifest: m.manifest },
      }});
      report.ingredients.push({ name: ing.name, status: 'CREATED', id: created.id });
    } else report.ingredients.push({ name: ing.name, status: 'WOULD_CREATE' });
  }

  console.log(JSON.stringify(report, null, 2));
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
