#!/usr/bin/env node
// Read-only nutrient inventory/coverage report for HUM-225.
// Denominators are explicit: profile ≠ ingredient; null nutrient amount ≠ zero.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { getPrisma } = require('../src/lib/prisma');

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outPath = outFlag >= 0 ? args[outFlag + 1] : null;

const pct = (num, den) => den ? Math.round((num / den) * 1000) / 10 : null;
const countBy = (rows, key) => rows.reduce((acc, row) => {
  const k = row[key] ?? '(null)';
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});
const normalize = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const PRIORITY_TERMS = [
  'idli', 'dosa', 'pesarattu', 'upma', 'poha', 'chapati', 'rice', 'dal',
  'sambar', 'rasam', 'curd', 'buttermilk', 'paneer', 'biryani', 'chicken curry',
  'egg curry', 'vegetables', 'lentils', 'millets', 'guava', 'mango', 'banana',
  'jamun', 'ice apple', 'street food', 'beverages', 'biscuits', 'packaged',
];

(async () => {
  const prisma = getPrisma();
  const [
    ingredients, catalog, profiles, nutrientDefinitions, recipeIngredients,
    ingredientServings, foodLogs, userIngredients, evidenceProfiles,
  ] = await Promise.all([
    prisma.ingredient.findMany({ select: { id: true, name: true, normalizedName: true, source: true, fdcId: true, catalogId: true, fiberPer100g: true } }),
    prisma.ingredientCatalog.findMany({ select: { id: true, name: true, normalizedName: true, aliases: true, brand: true, foodType: true, cuisine: true, category: true, preparation: true, status: true, usable: true, reviewRequired: true, verificationLevel: true, ingredient: { select: { id: true } } } }),
    prisma.ingredientNutritionProfile.findMany({ select: { id: true, ingredientId: true, preparationType: true, source: true, sourceDataset: true, verifiedAt: true, nutrients: { select: { amountPer100g: true } } } }),
    prisma.nutrient.findMany({ select: { id: true, code: true, name: true, unit: true, category: true } }),
    prisma.recipeIngredient.findMany({ select: { id: true, recipeId: true, ingredientId: true, ingredientName: true, nutritionSnapshot: true, fiberG: true, calories: true } }),
    prisma.ingredientServing.findMany({ select: { id: true, ingredientId: true, label: true, grams: true, estimated: true, sourceRecord: true } }),
    prisma.foodLog.findMany({ select: { id: true, ingredientId: true, nutritionSnapshot: true, micronutrients: true, fiberG: true } }),
    prisma.userIngredient.findMany({ select: { id: true, ingredientId: true, userId: true } }),
    prisma.ingredientEvidenceProfile.findMany({ select: { id: true, ingredientKey: true, status: true, version: true, reviewedAt: true } }),
  ]);

  const numericProfiles = profiles.filter(p => p.nutrients.some(n => n.amountPer100g !== null));
  const emptyProfiles = profiles.filter(p => p.nutrients.length === 0);
  const allNullProfiles = profiles.filter(p => p.nutrients.length > 0 && p.nutrients.every(n => n.amountPer100g === null));
  const verifiedProfiles = profiles.filter(p => p.verifiedAt !== null);
  const verifiedNumericProfiles = verifiedProfiles.filter(p => p.nutrients.some(n => n.amountPer100g !== null));
  const numericIngredientIds = new Set(numericProfiles.map(p => p.ingredientId));
  const anyProfileIngredientIds = new Set(profiles.map(p => p.ingredientId));
  const unresolvedIngredients = ingredients.filter(i => !numericIngredientIds.has(i.id));
  const noProfileIngredients = ingredients.filter(i => !anyProfileIngredientIds.has(i.id));
  const catalogUnresolved = catalog.filter(c => c.usable && (!c.ingredient?.id || !numericIngredientIds.has(c.ingredient.id)));

  const recipeLinked = recipeIngredients.filter(r => r.ingredientId);
  const recipeUnlinked = recipeIngredients.filter(r => !r.ingredientId);
  const recipeLinkedNumeric = recipeLinked.filter(r => numericIngredientIds.has(r.ingredientId));
  const recipeUnresolved = recipeLinked.filter(r => !numericIngredientIds.has(r.ingredientId));
  const recipeWithSnapshot = recipeIngredients.filter(r => r.nutritionSnapshot !== null);

  const numericObservations = await prisma.ingredientNutrient.count({ where: { amountPer100g: { not: null } } });
  const unknownObservations = await prisma.ingredientNutrient.count({ where: { amountPer100g: null } });
  const perNutrient = await prisma.$queryRaw`
    SELECT n."code", n."name", n."unit", n."category"::text AS "category",
      COUNT(DISTINCT p."id") FILTER (WHERE x."amountPer100g" IS NOT NULL)::int AS "profilesWithNumeric",
      COUNT(x."id") FILTER (WHERE x."amountPer100g" IS NOT NULL)::int AS "numericObservations",
      COUNT(x."id") FILTER (WHERE x."amountPer100g" IS NULL)::int AS "unknownObservations",
      COUNT(DISTINCT p."ingredientId") FILTER (WHERE x."amountPer100g" IS NOT NULL)::int AS "ingredientsWithNumeric"
    FROM "Nutrient" n
    LEFT JOIN "IngredientNutrient" x ON x."nutrientId" = n."id"
    LEFT JOIN "IngredientNutritionProfile" p ON p."id" = x."nutritionProfileId"
    GROUP BY n."id", n."code", n."name", n."unit", n."category"
    ORDER BY n."category", n."code"`;

  const catalogNames = new Set(catalog.flatMap(c => [c.normalizedName, ...(c.aliases || [])].map(normalize)));
  const ingredientNames = new Set(ingredients.map(i => i.normalizedName || normalize(i.name)));
  const recipeNames = new Set(recipeIngredients.map(r => normalize(r.ingredientName)));
  const priorityFoodCoverage = PRIORITY_TERMS.map(term => {
    const n = normalize(term);
    const contains = set => [...set].some(x => x === n || x.includes(n) || n.includes(x));
    return { term, catalog: contains(catalogNames), ingredient: contains(ingredientNames), recipeComponent: contains(recipeNames) };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    database: {
      provider: 'postgres',
      database: new URL(process.env.DATABASE_URL || 'postgres://missing').pathname.replace(/^\//, '') || null,
      note: 'Read-only report. No secrets or connection credentials are emitted.',
    },
    counts: {
      uniqueIngredients: ingredients.length,
      ingredientCatalogEntries: catalog.length,
      usableCatalogEntries: catalog.filter(c => c.usable).length,
      brandedFormulations: catalog.filter(c => c.brand).length,
      nutritionProfiles: profiles.length,
      verifiedProfiles: verifiedProfiles.length,
      numericProfiles: numericProfiles.length,
      verifiedNumericProfiles: verifiedNumericProfiles.length,
      emptyProfiles: emptyProfiles.length,
      allNullProfiles: allNullProfiles.length,
      ingredientNutrientRows: numericObservations + unknownObservations,
      numericNutrientObservations: numericObservations,
      unknownNutrientObservations: unknownObservations,
      nutrientDefinitions: nutrientDefinitions.length,
      recipeComponents: recipeIngredients.length,
      linkedRecipeComponents: recipeLinked.length,
      unlinkedRecipeComponents: recipeUnlinked.length,
      recipeComponentsLinkedToNumericIngredient: recipeLinkedNumeric.length,
      recipeComponentsLinkedButUnresolved: recipeUnresolved.length,
      recipeComponentsWithSnapshot: recipeWithSnapshot.length,
      servingRows: ingredientServings.length,
      foodLogRows: foodLogs.length,
      foodLogsWithIngredientLink: foodLogs.filter(f => f.ingredientId).length,
      foodLogsWithNutritionSnapshot: foodLogs.filter(f => f.nutritionSnapshot !== null).length,
      foodLogsWithMicronutrients: foodLogs.filter(f => f.micronutrients !== null).length,
      userIngredientLinks: userIngredients.length,
      uniqueUserLinkedIngredients: new Set(userIngredients.map(u => u.ingredientId)).size,
      evidenceProfiles: evidenceProfiles.length,
    },
    coverage: {
      ingredientsWithAnyProfile: { count: anyProfileIngredientIds.size, pct: pct(anyProfileIngredientIds.size, ingredients.length) },
      ingredientsWithNumericProfile: { count: numericIngredientIds.size, pct: pct(numericIngredientIds.size, ingredients.length) },
      unresolvedIngredients: { count: unresolvedIngredients.length, pct: pct(unresolvedIngredients.length, ingredients.length), definition: 'Ingredient with no IngredientNutritionProfile containing a numeric amountPer100g' },
      usableCatalogLinkedToNumericIngredient: { count: catalog.length - catalogUnresolved.length - catalog.filter(c => !c.usable).length, pct: pct(catalog.length - catalogUnresolved.length - catalog.filter(c => !c.usable).length, catalog.filter(c => c.usable).length), definition: 'usable catalog entry whose linked ingredient has at least one numeric nutrient profile' },
      usableCatalogUnresolved: { count: catalogUnresolved.length, pct: pct(catalogUnresolved.length, catalog.filter(c => c.usable).length) },
      recipeComponentsLinkedToNumericIngredient: { count: recipeLinkedNumeric.length, pct: pct(recipeLinkedNumeric.length, recipeIngredients.length) },
      servingCoverageIngredients: { count: new Set(ingredientServings.map(s => s.ingredientId)).size, pct: pct(new Set(ingredientServings.map(s => s.ingredientId)).size, ingredients.length) },
    },
    distributions: {
      ingredientSources: countBy(ingredients, 'source'),
      catalogStatus: countBy(catalog, 'status'),
      catalogVerificationLevels: countBy(catalog, 'verificationLevel'),
      profileSources: countBy(profiles, 'source'),
      profilePreparations: countBy(profiles, 'preparationType'),
      nutrientCategories: countBy(nutrientDefinitions, 'category'),
      evidenceStatuses: countBy(evidenceProfiles, 'status'),
      amountPer100gStates: { numeric: numericObservations, unknown: unknownObservations },
    },
    nutrientCoverage: perNutrient,
    reportedCountReconciliation: {
      reported: { ingredients: 426, verifiedProfiles: 142, originalProfiles: 18, updatedProfiles: 42, unresolvedOriginal: 283, unresolvedUpdated: 284, nutrientDefinitions: 27 },
      actual: { ingredients: ingredients.length, verifiedProfiles: verifiedProfiles.length, profiles: profiles.length, numericProfiles: numericProfiles.length, unresolvedIngredients: unresolvedIngredients.length, nutrientDefinitions: nutrientDefinitions.length },
      note: 'A nutrition profile is not an ingredient. A profile containing only null nutrient amounts is still unresolved. An empty profile is not numerical enrichment.',
    },
    priorityFoodCoverage,
    unresolvedSamples: {
      ingredients: unresolvedIngredients.slice(0, 80).map(i => ({ id: i.id, name: i.name, source: i.source, fdcId: i.fdcId, catalogId: i.catalogId, noProfile: !anyProfileIngredientIds.has(i.id) })),
      catalog: catalogUnresolved.slice(0, 80).map(c => ({ id: c.id, name: c.name, status: c.status, reviewRequired: c.reviewRequired, linkedIngredient: c.ingredient?.id || null })),
      recipeComponents: [...recipeUnlinked.slice(0, 40).map(r => ({ id: r.id, recipeId: r.recipeId, ingredientName: r.ingredientName, reason: 'missing ingredientId' })), ...recipeUnresolved.slice(0, 40).map(r => ({ id: r.id, recipeId: r.recipeId, ingredientName: r.ingredientName, ingredientId: r.ingredientId, reason: 'linked ingredient has no numeric nutrient profile' }))],
    },
  };

  const json = JSON.stringify(report, null, 2) + '\n';
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, json);
  }
  console.log(json);
  await prisma.$disconnect();
})().catch(async e => {
  console.error(`nutrient coverage report failed: ${e.message}`);
  process.exitCode = 2;
  try { await getPrisma().$disconnect(); } catch {}
});
