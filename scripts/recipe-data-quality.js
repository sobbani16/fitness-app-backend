// READ-ONLY recipe-intelligence data-quality audit (Phase 15).
// Inspects catalog, ingredient, recipe, allergy, and rule data — writes a JSON
// report to docs/recipe-intelligence/database-quality-raw.json and prints a
// summary. Never writes to the database.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { getPrisma } = require('../src/lib/prisma');
const { normalize } = require('../src/services/ingredientCsv');

const ALLERGEN_HINTS = {
  milk: /\b(milk|cheese|butter|cream|yogurt|yoghurt|whey|casein|ghee|paneer|dairy)\b/i,
  egg: /\begg(s)?\b|omelet|omelette|mayonnaise|\bmayo\b/i,
  peanut: /\bpeanut|groundnut/i,
  fish: /\b(fish|salmon|tuna|cod|tilapia|sardine|anchovy|mackerel)\b/i,
  shellfish: /\b(shrimp|prawn|crab|lobster|shellfish|mussel|clam|oyster|scallop|squid)\b/i,
  wheat: /\b(wheat|flour|bread|pasta|semolina|couscous|seitan|roti|naan)\b/i,
  soy: /\b(soy|soya|tofu|edamame|tempeh)\b/i,
  sesame: /\b(sesame|tahini)\b/i,
  nuts: /\b(almond|walnut|cashew|pecan|pistachio|hazelnut|macadamia|nut)\b/i,
};
const MEAT_RE = /\b(chicken|turkey|duck|poultry|beef|pork|lamb|mutton|sausage|bacon|ham)\b/i;

function allergenList(sourceRecord) {
  const a = sourceRecord && typeof sourceRecord === 'object' ? sourceRecord.allergens : null;
  if (Array.isArray(a)) return a.map(normalize).filter(Boolean);
  if (typeof a === 'string') return a.split(/[,;]/).map(normalize).filter(Boolean);
  return [];
}

async function main() {
  const p = getPrisma();
  const report = { generatedAt: new Date().toISOString(), sections: {} };

  const [catalog, ingredients, recipes, allergies, condRules, nutrientRules] = await Promise.all([
    p.ingredientCatalog.findMany({ select: { id: true, name: true, identityKey: true, normalizedName: true, aliases: true, category: true, usable: true, sourceRecord: true, ingredient: { select: { id: true, name: true, caloriesPer100g: true, proteinPer100g: true, carbsPer100g: true, fatPer100g: true, fiberPer100g: true } } } }),
    p.ingredient.findMany({ select: { id: true, name: true, caloriesPer100g: true, proteinPer100g: true, carbsPer100g: true, fatPer100g: true, fiberPer100g: true } }),
    p.recipe.findMany({ select: { id: true, recipeName: true, reviewStatus: true, isSystem: true, allergens: true, servings: true, instructions: true, safetyNotes: true, prepMinutes: true, calories: true, ingredients: { select: { ingredientName: true, ingredientId: true, amountG: true, optional: true } } } }),
    p.allergy.findMany({ select: { name: true } }),
    p.conditionRule.findMany({ select: { id: true, reviewStatus: true, attribute: true, target: true, action: true } }),
    p.healthConditionNutrientRule.findMany({ select: { id: true, reviewStatus: true, code: true, action: true } }).catch(() => []),
  ]);

  // ---- catalog quality ----------------------------------------------------
  const cat = report.sections.catalog = { total: catalog.length, usable: catalog.filter(c => c.usable).length, issues: {} };
  const missingLink = catalog.filter(c => c.usable && !c.ingredient);
  cat.issues.noIngredientLink = missingLink.map(c => c.normalizedName).slice(0, 30);
  cat.counts = { noIngredientLink: missingLink.length };

  const catNorm = (s) => String(s || '').trim().toLowerCase();
  const catGroups = new Map();
  for (const c of catalog) {
    const k = catNorm(c.category);
    if (!catGroups.has(k)) catGroups.set(k, new Set());
    catGroups.get(k).add(c.category);
  }
  cat.issues.categoryCaseVariants = [...catGroups.entries()].filter(([, variants]) => variants.size > 1).map(([k, v]) => ({ normalized: k, variants: [...v] }));
  cat.issues.missingCategory = catalog.filter(c => c.usable && !c.category).map(c => c.normalizedName).slice(0, 30);
  cat.counts.missingCategory = cat.issues.missingCategory.length;

  const aliasOwner = new Map();
  const dupAliases = [];
  for (const c of catalog) for (const a of [c.normalizedName, ...(c.aliases || [])]) {
    const k = normalize(a);
    if (!k) continue;
    if (aliasOwner.has(k) && aliasOwner.get(k) !== c.id) dupAliases.push({ alias: k, ids: [aliasOwner.get(k), c.id] });
    else aliasOwner.set(k, c.id);
  }
  cat.issues.duplicateAliases = dupAliases.slice(0, 30);
  cat.counts.duplicateAliases = dupAliases.length;

  // Undeclared allergen risk: name hints at a major allergen but no declaration.
  const undeclared = [];
  for (const c of catalog) {
    if (!c.usable) continue;
    const declared = allergenList(c.sourceRecord);
    const hinted = Object.entries(ALLERGEN_HINTS).filter(([, re]) => re.test(c.name) || re.test(c.normalizedName || '')).map(([k]) => k);
    const missing = hinted.filter(h => !declared.some(d => d.includes(h) || h.includes(d)));
    if (missing.length) undeclared.push({ name: c.name, hintedMissing: missing, declared });
  }
  cat.issues.undeclaredAllergenHints = undeclared.slice(0, 40);
  cat.counts.undeclaredAllergenHints = undeclared.length;

  // ---- ingredient nutrient quality ----------------------------------------
  const ing = report.sections.ingredients = { total: ingredients.length, counts: {}, issues: {} };
  const noMacros = ingredients.filter(i => i.caloriesPer100g == null);
  ing.counts.missingCalories = noMacros.length;
  ing.issues.missingCalories = noMacros.map(i => i.name).slice(0, 30);
  const implausible = ingredients.filter(i =>
    (i.caloriesPer100g != null && (i.caloriesPer100g < 0 || i.caloriesPer100g > 900)) ||
    (i.proteinPer100g != null && (i.proteinPer100g < 0 || i.proteinPer100g > 60)) ||
    (i.fatPer100g != null && (i.fatPer100g < 0 || i.fatPer100g > 100)));
  ing.counts.implausibleMacros = implausible.length;
  ing.issues.implausibleMacros = implausible.map(i => ({ name: i.name, kcal: i.caloriesPer100g, protein: i.proteinPer100g, fat: i.fatPer100g })).slice(0, 30);
  const macroSumBad = ingredients.filter(i => {
    const s = (i.proteinPer100g || 0) + (i.carbsPer100g || 0) + (i.fatPer100g || 0);
    return i.caloriesPer100g != null && s > 0 && s > 100;
  });
  ing.counts.macroSumOver100g = macroSumBad.length;
  ing.issues.macroSumOver100g = macroSumBad.map(i => i.name).slice(0, 30);

  // ---- recipes --------------------------------------------------------------
  const rec = report.sections.recipes = { total: recipes.length, counts: {}, issues: {} };
  const noInstr = recipes.filter(r => !Array.isArray(r.instructions) || !r.instructions.length);
  rec.counts.missingInstructions = noInstr.length;
  rec.issues.missingInstructions = noInstr.map(r => r.recipeName).slice(0, 30);
  const badServings = recipes.filter(r => !Number.isFinite(r.servings) || r.servings < 1 || r.servings > 20);
  rec.counts.invalidServings = badServings.length;
  rec.issues.invalidServings = badServings.map(r => ({ name: r.recipeName, servings: r.servings })).slice(0, 30);
  const meatNoTemp = recipes.filter(r => {
    const text = (r.ingredients || []).map(l => l.ingredientName).join(' ');
    if (!MEAT_RE.test(text)) return false;
    const instrText = (Array.isArray(r.instructions) ? r.instructions : []).map(s => typeof s === 'string' ? s : s?.text || '').join(' ') + ' ' + (Array.isArray(r.safetyNotes) ? r.safetyNotes.join(' ') : JSON.stringify(r.safetyNotes || ''));
    return !/1[6-9]\d\s*°?\s*f|7[4-9]|8\d|9\d|1\d\d\s*°?\s*c/i.test(instrText);
  });
  rec.counts.meatWithoutTempGuidance = meatNoTemp.length;
  rec.issues.meatWithoutTempGuidance = meatNoTemp.map(r => r.recipeName).slice(0, 30);
  const undeclaredRecipeAllergens = recipes.filter(r => {
    const declared = (r.allergens || []).map(normalize);
    const text = (r.ingredients || []).map(l => l.ingredientName).join(' ');
    return Object.entries(ALLERGEN_HINTS).some(([k, re]) => re.test(text) && !declared.some(d => d.includes(k) || k.includes(d)));
  });
  rec.counts.linesUndeclaredAllergen = undeclaredRecipeAllergens.length;
  rec.issues.linesUndeclaredAllergen = undeclaredRecipeAllergens.map(r => r.recipeName).slice(0, 30);
  const unlinkedLines = recipes.flatMap(r => (r.ingredients || []).filter(l => !l.ingredientId).map(l => ({ recipe: r.recipeName, line: l.ingredientName })));
  rec.counts.unlinkedIngredientLines = unlinkedLines.length;
  rec.issues.unlinkedIngredientLines = unlinkedLines.slice(0, 40);
  rec.counts.byReviewStatus = recipes.reduce((m, r) => { m[r.reviewStatus] = (m[r.reviewStatus] || 0) + 1; return m; }, {});

  // ---- reference data --------------------------------------------------------
  const ref = report.sections.referenceData = {};
  const allergyNames = allergies.map(a => a.name);
  const allergyNorm = new Map();
  for (const n of allergyNames) { const k = normalize(n); if (!allergyNorm.has(k)) allergyNorm.set(k, []); allergyNorm.get(k).push(n); }
  ref.allergyCount = allergies.length;
  ref.allergyCaseDuplicates = [...allergyNorm.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ normalized: k, variants: v }));
  ref.conditionRules = { total: condRules.length, byStatus: condRules.reduce((m, r) => { m[r.reviewStatus] = (m[r.reviewStatus] || 0) + 1; return m; }, {}), blockRules: condRules.filter(r => r.action === 'block').length };
  ref.nutrientRules = { total: nutrientRules.length, byStatus: nutrientRules.reduce((m, r) => { m[r.reviewStatus] = (m[r.reviewStatus] || 0) + 1; return m; }, {}) };

  const out = path.join(__dirname, '..', 'docs', 'recipe-intelligence', 'database-quality-raw.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log('=== RECIPE-INTELLIGENCE DATA QUALITY (read-only) ===');
  for (const [section, s] of Object.entries(report.sections)) {
    console.log(`\n[${section}]`);
    if (s.counts) for (const [k, v] of Object.entries(s.counts)) console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    if (s.total != null) console.log(`  total: ${s.total}`);
  }
  console.log('\n[reference]', JSON.stringify(ref, null, 1));
  console.log(`\nReport → ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => getPrisma().$disconnect());
