#!/usr/bin/env node
// Import humai_food_recipe_expansion_v1.json (ingredients + Indian recipes).
// Default is a DRY RUN — pass --apply to write. Usage:
//   node scripts/import-food-expansion.js <file.json> [--apply]
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { getPrisma } = require('../src/lib/prisma');
const { importV5 } = require('../src/services/ingredientImportV5');
const { importRecipes } = require('../src/services/recipeImport');

const LEVEL = {
  NEEDS_SOURCE_MATCH: 'GENERIC_COMPOSITION',
  VERIFIED: 'SOURCE_BACKED_FULL',
};

function toV5Row(i) {
  return {
    id: i.key,
    name: i.name,
    category: i.category || '',
    preparation: i.preparation || '',
    status: 'GENERIC_COMPOSITION',
    basis: '100 g',
    carb_definition: 'total (approx, unverified)',
    nutrition_verification_level: LEVEL[i.reviewStatus] || 'GENERIC_COMPOSITION',
    kcal_per_100g: i.caloriesPer100g,
    protein_g_per_100g: i.proteinPer100g,
    carbs_g_per_100g: i.carbsPer100g,
    fat_g_per_100g: i.fatPer100g,
    fiber_g_per_100g: i.fiberPer100g ?? null,
    source: i.source || 'GENERIC_RESEARCH_DRAFT_NOT_VERIFIED',
    source_id: i.sourceId || null,
    expansion_key: i.key,
    import_action: i.importAction,
    notes: i.notes || null,
    allergens: i.allergens || null,
    needs_raw_cooked_check: i.needsRawCookedCheck === true,
  };
}

async function main() {
  const file = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!file) { console.error('usage: node scripts/import-food-expansion.js <file.json> [--apply]'); process.exit(2); }
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const ingredients = data.ingredients || [], recipes = data.recipes || [];
  const checksum = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
  const prisma = getPrisma();

  const ingRows = ingredients.filter(i => i.importAction !== 'SKIP').map(toV5Row);
  const ingReport = await importV5(prisma, ingRows, { apply, checksum: `expansion-v1-${checksum}`, filename: file });
  const recReport = await importRecipes(prisma, recipes, { apply, checksum: `expansion-v1-${checksum}` });

  console.log(JSON.stringify({ dryRun: !apply, ingredients: ingReport, recipes: { ...recReport, unresolvedLinks: recReport.unresolvedLinks.slice(0, 50), unresolvedLinkCount: recReport.unresolvedLinks.length } }, null, 2));
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
