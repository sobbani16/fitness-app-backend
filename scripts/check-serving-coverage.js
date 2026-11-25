#!/usr/bin/env node
// Serving-coverage release gate — read-only, reproducible.
// Recomputes the FOOD_LOGGING_SERVING_COVERAGE gates against the configured DB:
//   coverage  ≥ COVERAGE_MIN of usable catalog items have ≥1 IngredientServing
//   grams     every serving row has grams > 0
//   labels    no serving row uses a pure weight/volume-unit label
//             (weight units stay available as grams input, never as a
//             pseudo-serving — see import-ingredient-servings.js)
//   prov      every serving row carries sourceRecord provenance
// Exits 1 when any gate fails. Never writes.
//   node scripts/check-serving-coverage.js
require('dotenv').config({ quiet: true });
const { getPrisma } = require('../src/lib/prisma');

const COVERAGE_MIN = 60; // release gate from FOOD_LOGGING_SERVING_COVERAGE.md
const WEIGHT_UNIT_RE = /^\s*\d*\.?\d*\s*(g|gm|grm|gram|grams|oz|onz|ounce|ounces|lb|ml|fl\s*oz|kg)\b/i;
const PURE_UNIT_RE = /^(g|gm|grm|oz|onz|ml|kg|lb|fl\s*oz)$/i;

(async () => {
  const p = getPrisma();
  const [usable, withServing, servings] = await Promise.all([
    p.ingredientCatalog.count({ where: { usable: true } }),
    p.ingredientCatalog.count({ where: { usable: true, ingredient: { servings: { some: {} } } } }),
    p.ingredientServing.findMany({ select: { id: true, label: true, grams: true, sourceRecord: true } }),
  ]);
  const coverage = usable ? (withServing / usable) * 100 : 0;
  const badGrams = servings.filter((s) => !(s.grams > 0));
  const weightLabels = servings.filter((s) => WEIGHT_UNIT_RE.test(s.label) || PURE_UNIT_RE.test(s.label.trim()));
  const noProv = servings.filter((s) => !s.sourceRecord);

  console.log(JSON.stringify({
    usableCatalog: usable, withServing, servingRows: servings.length,
    coveragePct: Math.round(coverage * 10) / 10,
    badGrams: badGrams.length, weightUnitLabels: weightLabels.length, missingProvenance: noProv.length,
  }, null, 1));
  weightLabels.slice(0, 10).forEach((s) => console.log(`  WTL ${s.id} "${s.label}"`));

  const fails = [];
  if (coverage < COVERAGE_MIN) fails.push(`coverage ${coverage.toFixed(1)}% < ${COVERAGE_MIN}%`);
  if (badGrams.length) fails.push(`${badGrams.length} serving rows with grams<=0`);
  if (weightLabels.length) fails.push(`${weightLabels.length} weight-unit serving labels`);
  if (noProv.length) fails.push(`${noProv.length} serving rows missing sourceRecord`);
  if (fails.length) { console.error(`\nSERVING GATE FAIL: ${fails.join('; ')}`); process.exit(1); }
  console.log(`\nServing gate passed: ${coverage.toFixed(1)}% >= ${COVERAGE_MIN}%, ${servings.length} rows clean.`);
  await p.$disconnect();
})();
