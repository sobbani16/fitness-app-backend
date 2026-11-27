#!/usr/bin/env node
// pc-HUM-51 Workstream B — real serving-coverage recount. READ-ONLY.
// Defines the denominator explicitly (no hidden games):
//   DENOMINATOR = usable:true IngredientCatalog rows linked to an Ingredient
//   NUMERATOR   = those whose Ingredient carries >=1 IngredientServing
// Reports: coverage by source/category, frequently-logged breakdown,
// invalid conversions (grams<=0, weight-unit pseudo-servings), duplicates,
// provenance gaps, and the unresolved queue (denominator minus numerator,
// named). Never writes; exits 0 always — this is an audit, not a gate.
require('dotenv').config({ quiet: true });
const { getPrisma } = require('../src/lib/prisma');

const WEIGHT_UNIT_RE = /^\s*\d*\.?\d*\s*(g|gm|grm|gram|grams|oz|onz|ounce|ounces|lb|ml|fl\s*oz|kg)\b/i;
const PURE_UNIT_RE = /^(g|gm|grm|oz|onz|ml|kg|lb|fl\s*oz)$/i;

(async () => {
  const p = getPrisma();
  const catalog = await p.ingredientCatalog.findMany({
    where: { usable: true },
    select: { id: true, normalizedName: true, category: true, cuisine: true,
      ingredient: { select: { id: true, servings: { select: { id: true, label: true, grams: true, estimated: true, sourceRecord: true } } } } },
  });
  const denom = catalog.length;
  const covered = catalog.filter(c => (c.ingredient?.servings || []).length > 0);
  const unresolved = catalog.filter(c => !(c.ingredient?.servings || []).length);

  const allServings = catalog.flatMap(c => (c.ingredient?.servings || []).map(s => ({ ...s, cat: c.normalizedName })));
  const badGrams = allServings.filter(s => !(s.grams > 0));
  const weightLabels = allServings.filter(s => WEIGHT_UNIT_RE.test(s.label) || PURE_UNIT_RE.test((s.label || '').trim()));
  const noProv = allServings.filter(s => !s.sourceRecord);
  const estCount = allServings.filter(s => s.estimated).length;

  // duplicates: same ingredient + same normalized label
  const seen = new Map(); const dups = [];
  for (const c of catalog) for (const s of (c.ingredient?.servings || [])) {
    const k = `${c.ingredient?.id}|${(s.label || '').toLowerCase().trim()}`;
    if (seen.has(k)) dups.push({ catalog: c.normalizedName, label: s.label }); else seen.set(k, 1);
  }

  const by = (key) => {
    const g = {};
    for (const c of catalog) {
      const k = c[key] || '(unset)';
      g[k] = g[k] || { total: 0, covered: 0 };
      g[k].total++;
      if ((c.ingredient?.servings || []).length) g[k].covered++;
    }
    return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { ...v, pct: Math.round((v.covered / v.total) * 1000) / 10 }]).sort((a, b) => b[1].total - a[1].total));
  };

  // frequently-logged: top ingredients by foodlog count
  const freq = await p.foodLog.groupBy({ by: ['ingredientId'], _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 50 });
  const freqIds = freq.map(f => f.ingredientId).filter(Boolean);
  const freqCovered = catalog.filter(c => c.ingredient && freqIds.includes(c.ingredient.id));
  const freqWithServing = freqCovered.filter(c => (c.ingredient?.servings || []).length);

  const report = {
    denominator: { definition: 'usable:true IngredientCatalog rows', count: denom },
    numerator: { definition: '>=1 IngredientServing on linked ingredient', count: covered.length },
    coveragePct: denom ? Math.round((covered.length / denom) * 1000) / 10 : 0,
    servingRows: allServings.length,
    frequentlyLoggedTop50: { catalogMatched: freqCovered.length, withServing: freqWithServing.length,
      pct: freqCovered.length ? Math.round((freqWithServing.length / freqCovered.length) * 1000) / 10 : null },
    quality: { badGrams: badGrams.length, weightUnitPseudoServings: weightLabels.length, missingProvenance: noProv.length,
      estimatedShare: allServings.length ? Math.round((estCount / allServings.length) * 1000) / 10 : 0, duplicateLabels: dups.length },
    byCategory: by('category'), byCuisine: by('cuisine'),
    unresolvedQueue: unresolved.map(c => c.normalizedName).sort(),
  };
  console.log(JSON.stringify(report, null, 1));
  await p.$disconnect();
})().catch(e => { console.error('audit error:', e.message); process.exit(2); });
