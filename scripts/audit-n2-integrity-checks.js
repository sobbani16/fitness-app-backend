#!/usr/bin/env node
// pc-HUM-29 §11.2 — read-only data-integrity checks on the authorized dev DB.
// NEVER writes. Every check is a SELECT. Exits 0 with a JSON report; nonzero
// counts are findings, not failures — remediation is a separate approved step.
//
// Checks: canonicalization (seed-vs-catalog shadowing), orphan refs
// (RecipeIngredient/UserIngredient/IngredientAttribute/FoodLog → missing rows),
// duplicate catalog rows, provenance gaps, raw-vs-cooked ambiguity markers,
// serving-unit sanity, recipe-total consistency. Never guesses missing values.
require('dotenv').config({ quiet: true });
const { getPrisma } = require('../src/lib/prisma');

(async () => {
  const p = getPrisma();
  const q = (s) => p.$queryRawUnsafe(s);
  const report = {};

  // 1. canonicalization — seed ingredients sharing normalizedName with catalog-linked rows
  report.seedShadowing = (await q(`SELECT count(*)::int n FROM "Ingredient" i WHERE i.source='seed' AND EXISTS (SELECT 1 FROM "Ingredient" c WHERE c."normalizedName"=i."normalizedName" AND c.source!='seed')`))[0].n;

  // 2. orphan references — child rows pointing at missing parents
  report.orphans = {
    recipeIngredient_ingredient: (await q(`SELECT count(*)::int n FROM "RecipeIngredient" r LEFT JOIN "Ingredient" i ON i.id=r."ingredientId" WHERE i.id IS NULL`))[0].n,
    recipeIngredient_recipe: (await q(`SELECT count(*)::int n FROM "RecipeIngredient" r LEFT JOIN "Recipe" x ON x.id=r."recipeId" WHERE x.id IS NULL`))[0].n,
    ingredientAttribute_ingredient: (await q(`SELECT count(*)::int n FROM "IngredientAttribute" a LEFT JOIN "Ingredient" i ON i.id=a."ingredientId" WHERE i.id IS NULL`))[0].n,
    userIngredient_user: (await q(`SELECT count(*)::int n FROM "UserIngredient" u LEFT JOIN "User" x ON x.id=u."userId" WHERE x.id IS NULL`))[0].n,
    foodLog_ingredient: (await q(`SELECT count(*)::int n FROM "FoodLog" f LEFT JOIN "Ingredient" i ON i.id=f."ingredientId" WHERE f."ingredientId" IS NOT NULL AND i.id IS NULL`))[0].n,
    ingredientServing_ingredient: (await q(`SELECT count(*)::int n FROM "IngredientServing" s LEFT JOIN "Ingredient" i ON i.id=s."ingredientId" WHERE i.id IS NULL`))[0].n,
  };

  // 3. duplicates — same normalizedName+source within Ingredient
  report.duplicateIngredients = (await q(`SELECT count(*)::int n FROM (SELECT "normalizedName", source FROM "Ingredient" GROUP BY 1,2 HAVING count(*)>1) d`))[0]?.n ?? 0;

  // 4. provenance gaps
  report.provenance = {
    servingsMissingSourceRecord: (await q(`SELECT count(*)::int n FROM "IngredientServing" WHERE "sourceRecord" IS NULL`))[0].n,
    catalogMissingSourceRecord: (await q(`SELECT count(*)::int n FROM "IngredientCatalog" WHERE "sourceRecord" IS NULL`))[0].n,
  };

  // 5. raw-vs-cooked ambiguity — ingredients whose name gives no preparation signal but have cooked-only nutrient profiles is NOT guessable; we only count explicit preparation markers present/absent (never infer values)
  report.preparationMarkers = {
    catalogRowsWithPreparation: (await q(`SELECT count(*)::int n FROM "IngredientCatalog" WHERE preparation IS NOT NULL AND preparation<>''`))[0].n,
    catalogRowsTotal: (await q(`SELECT count(*)::int n FROM "IngredientCatalog"`))[0].n,
  };

  // 6. serving-unit sanity — grams<=0, implausibly large single servings (>2000g), weight-unit pseudo labels
  report.servingSanity = {
    nonPositiveGrams: (await q(`SELECT count(*)::int n FROM "IngredientServing" WHERE grams IS NULL OR grams<=0`))[0].n,
    implausiblyLarge: (await q(`SELECT count(*)::int n FROM "IngredientServing" WHERE grams>2000`))[0].n,
    weightUnitLabels: (await q(`SELECT count(*)::int n FROM "IngredientServing" WHERE lower(trim(label)) ~ '^(g|gm|grm|gram|grams|oz|onz|ounce|ounces|lb|ml|kg|fl oz)$'`))[0].n,
  };

  // 7. recipe totals consistency — recipes whose stored calories diverge wildly from summed ingredient contribution is a deep check; here the cheap invariant: recipes with ingredients but zero/null totals
  report.recipeTotals = {
    recipesWithIngredientsButNullCalories: (await q(`SELECT count(*)::int n FROM "Recipe" r WHERE r.calories IS NULL AND EXISTS (SELECT 1 FROM "RecipeIngredient" ri WHERE ri."recipeId"=r.id)`))[0].n,
    recipesWithZeroServings: (await q(`SELECT count(*)::int n FROM "Recipe" WHERE servings IS NULL OR servings<1`))[0].n,
  };

  // 8. historical preservation — FoodLogs referencing seed vs catalog ingredients (informational; deletion of referenced rows would break history)
  report.historicalRefs = {
    foodLogsTotal: (await q(`SELECT count(*)::int n FROM "FoodLog"`))[0].n,
    foodLogsWithIngredientRef: (await q(`SELECT count(*)::int n FROM "FoodLog" WHERE "ingredientId" IS NOT NULL`))[0].n,
    foodLogsReferencingSeed: (await q(`SELECT count(*)::int n FROM "FoodLog" f JOIN "Ingredient" i ON i.id=f."ingredientId" WHERE i.source='seed'`))[0].n,
  };

  report.auditedAt = new Date().toISOString();
  report.database = (process.env.DATABASE_URL || '').replace(/\/\/[^@]*@/, '//***@').replace(/\?.*$/, '');
  console.log(JSON.stringify(report, null, 1));
  await p.$disconnect();
})().catch(e => { console.error('integrity-check error:', e.message.slice(0, 300)); process.exit(2); });
