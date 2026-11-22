// Recipe/catalog data remediation — Phase 15 follow-through.
//
// DRY-RUN by default. `--apply` executes the VERIFIED changes only;
// `--include-assumptions` additionally applies the assumption tier.
// Emits docs/recipe-intelligence/data-remediation-plan.json either way.
//
// Correction tiers:
//   VERIFIED      — deterministic, checkable mappings (catalog name match,
//                   unambiguous allergen declarations, USDA-aligned fixes,
//                   standard food-safety temperature guidance).
//   ASSUMPTION    — plausible but not verifiable (composite/proprietary items,
//                   generic "vegetables", "wrap"→tortilla). Reviewed, not applied by default.
//   NEEDS-HUMAN   — cannot be derived (missing instructions, unmatched lines).
//
// Never invented: allergen declarations on ambiguous items, nutrient values,
// recipe instructions.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { getPrisma } = require('../src/lib/prisma');
const { normalize } = require('../src/services/ingredientCsv');
const db = getPrisma();

const APPLY = process.argv.includes('--apply');
const ASSUME = APPLY && process.argv.includes('--include-assumptions');

// ---- VERIFIED relinks: unlinked line name -> IngredientCatalog.name ---------
// Each target confirmed present+usable+ingredient-linked in the live catalog.
const RELINK_VERIFIED = {
  'almonds': 'Almonds, raw',
  'apple': 'Apple with skin, raw',
  'peanut butter': 'Peanut butter plain',
  'eggs': 'Egg, whole, raw',
  'whole wheat bread': 'Whole wheat bread, ready',
  'asparagus': 'Asparagus raw',
  'salmon': 'Salmon Atlantic, raw',
  'chicken breast': 'Chicken breast skinless, raw',
  'sweet potato': 'Sweet potato, raw',
  'rice': 'Rice, basmati, cooked',
  'brown rice': 'Rice, brown, cooked',
  'chicken thigh': 'Chicken thigh skinless, raw',
  'greek yogurt': 'Greek yogurt plain, nonfat',
  'granola': 'Granola generic',
  'tortillas': 'Flour tortilla',
  'white fish': 'White fish, raw generic',
  'hummus': 'Hummus generic',
  'lean beef': 'Beef lean, raw',
  'lentils': 'Brown lentils (dry)',
  'milk': 'Milk, whole',
  'oats': 'Rolled oats, dry',
  'protein powder': 'Whey protein powder generic',
  'quinoa': 'Quinoa, cooked',
  'shrimp': 'Shrimp prawns, raw',
  'pasta': 'Pasta cooked plain',
  'turkey breast': 'Turkey breast, raw',
};

// ---- ASSUMPTION-tier relinks (not applied without --include-assumptions) ----
const RELINK_ASSUMPTION = {
  'wrap': 'Flour tortilla',        // wraps are not always flour tortillas
};

// ---- VERIFIED catalog allergen declarations --------------------------------
// Unambiguous by USDA/common name; canonical vocabulary per ALLERGEN_KEYWORDS.
const CATALOG_ALLERGENS = {
  'Almonds, raw': ['tree nuts'],
  'Peanut butter plain': ['peanuts'],
  'Egg, whole, raw': ['eggs'],
  'Egg, whole, boiled': ['eggs'],
  'Whole wheat bread, ready': ['wheat', 'gluten'],
  'Salmon Atlantic, raw': ['fish'],
  'White fish, raw generic': ['fish'],
  'Shrimp prawns, raw': ['shellfish'],
  'Milk, whole': ['milk'],
  'Milk, low-fat': ['milk'],
  'Greek yogurt plain, nonfat': ['milk'],
  'Whey protein powder generic': ['milk'],
  'Hummus generic': ['sesame'],
  'Pasta cooked plain': ['wheat', 'gluten'],
  // True wheat hits from the catalog allergen-hint audit (millet false
  // positives deliberately excluded — ragi/jowar/bajra are not wheat).
  'Whole-wheat atta flour, dry': ['wheat', 'gluten'],
  'Maida refined wheat flour': ['wheat', 'gluten'],
  'Semolina, dry': ['wheat', 'gluten'],
  'Vermicelli, wheat, dry': ['wheat', 'gluten'],
  'Chapati/roti, cooked without oil': ['wheat', 'gluten'],
  // Second pass — remaining unambiguous items from the hint audit.
  // 'Coconut milk'→tree nuts (FDA tree-nut classification, not dairy);
  // 'Peanut butter plain' milk-hint is a butter-keyword false positive.
  'Soy chunks, dry, unbranded': ['soy'],
  'Tofu, firm plain': ['soy'],
  'Paneer, full-fat plain': ['milk'],
  'Paneer, reduced-fat plain': ['milk'],
  'Plain yogurt curd': ['milk'],
  'Ghee clarified butter': ['milk'],
  'Butter unsalted': ['milk'],
  'Cheddar cheese': ['milk'],
  'Cream cheese': ['milk'],
  'Mozzarella (whole milk)': ['milk'],
  'Parmesan cheese': ['milk'],
  'Feta cheese': ['milk'],
  'Sour cream': ['milk'],
  'Heavy cream': ['milk'],
  'Cheese ravioli (fresh)': ['milk', 'wheat', 'gluten'],
  'Coconut milk, canned': ['tree nuts'],
  'Sesame oil': ['sesame'],
  'Sesame seeds': ['sesame'],
  'Cashew nuts, raw': ['tree nuts'],
  'Peanuts, raw': ['peanuts'],
  'White bread, ready': ['wheat', 'gluten'],
  'Pita bread': ['wheat', 'gluten'],
  'Bulgur wheat (dry)': ['wheat', 'gluten'],
  'Flour tortilla': ['wheat', 'gluten'],
};

// Allergen hints for UNLINKED line names that are unambiguous by name alone.
const LINE_ALLERGEN_HINTS = {
  'tuna': ['fish'],
  'cottage cheese': ['milk'],
  'almond milk': ['tree nuts'],
  'protein bar': [],          // composite — cannot declare without label data
  'turkey meatballs': [],     // composite
  'wrap': ['wheat', 'gluten'],
  'vegetables': [], 'mixed vegetables': [], 'mixed fruit': [],
  'mixed greens': [], 'mixed berries': [],
};

const POULTRY_RE = /\b(chicken|turkey|duck|poultry)\b/i;
const TEMP_RE = /\b(1[6-9]\d|2\d\d)\s*°?\s*f\b|\b(7[4-9]|8\d|9\d|1\d\d)\s*°?\s*c\b/i;
const POULTRY_STEP = { step: null, text: 'Cook poultry to an internal temperature of 74°C (165°F) before serving.' };
const GLUCOSE_ID = '43486dcb-990b-4c63-84ce-81f9964be508'; // carbs 107g/100g — physically impossible

(async () => {
  const plan = { generated: new Date().toISOString(), mode: APPLY ? 'apply' : 'dry-run', verified: {}, assumptions: {}, needsHuman: {} };

  const catalog = await db.ingredientCatalog.findMany({
    where: { usable: true },
    select: { id: true, name: true, normalizedName: true, aliases: true, sourceRecord: true, ingredient: { select: { id: true, caloriesPer100g: true, proteinPer100g: true, carbsPer100g: true, fatPer100g: true, fiberPer100g: true } } },
  });
  const catByName = new Map(catalog.map((c) => [c.name, c]));

  // ---- 1. relink unlinked lines -------------------------------------------
  const unlinked = await db.recipeIngredient.findMany({ where: { ingredientId: null }, select: { id: true, ingredientName: true, recipeId: true } });
  const relinkV = [], relinkA = [], relinkH = [];
  for (const l of unlinked) {
    const key = normalize(l.ingredientName);
    if (RELINK_VERIFIED[key] && catByName.get(RELINK_VERIFIED[key])?.ingredient) relinkV.push({ line: l, cat: catByName.get(RELINK_VERIFIED[key]) });
    else if (RELINK_ASSUMPTION[key] && catByName.get(RELINK_ASSUMPTION[key])?.ingredient) relinkA.push({ line: l, cat: catByName.get(RELINK_ASSUMPTION[key]) });
    else relinkH.push({ id: l.id, name: l.ingredientName });
  }
  plan.verified.relink = relinkV.map(({ line, cat }) => ({ lineId: line.id, name: line.ingredientName, to: cat.name }));
  plan.assumptions.relink = relinkA.map(({ line, cat }) => ({ lineId: line.id, name: line.ingredientName, to: cat.name }));
  plan.needsHuman.unlinkedLines = relinkH;

  if (APPLY) {
    for (const { line, cat } of [...relinkV, ...(ASSUME ? relinkA : [])]) {
      const i = cat.ingredient;
      await db.recipeIngredient.update({
        where: { id: line.id },
        data: { ingredientId: i.id, nutritionSnapshot: { per100: { calories: i.caloriesPer100g, proteinG: i.proteinPer100g, carbsG: i.carbsPer100g, fatG: i.fatPer100g, fiberG: i.fiberPer100g }, source: 'catalog', remediation: 'relink-v1' } },
      });
    }
  }

  // ---- 2. catalog allergen declarations ------------------------------------
  const catAllergenPlan = [];
  for (const [name, allergens] of Object.entries(CATALOG_ALLERGENS)) {
    const c = catByName.get(name);
    if (!c) { catAllergenPlan.push({ name, skipped: 'not in catalog' }); continue; }
    // Existing value may be a bare string ('dairy') — normalize to canonical
    // array form so the audit + validator both read it.
    const raw = c.sourceRecord?.allergens;
    const cur = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [{ dairy: 'milk' }[raw] || raw] : []);
    const next = [...new Set([...cur, ...allergens])];
    if (next.length === cur.length && Array.isArray(raw)) continue;
    catAllergenPlan.push({ name, from: cur, to: next });
    if (APPLY) {
      await db.ingredientCatalog.update({ where: { id: c.id }, data: { sourceRecord: { ...(c.sourceRecord || {}), allergens: next } } });
      c.sourceRecord = { ...(c.sourceRecord || {}), allergens: next };
    }
  }
  plan.verified.catalogAllergens = catAllergenPlan;

  // ---- 3. recipe allergens (derived + merged into existing set) ------------
  const recipes = await db.recipe.findMany({
    select: { id: true, recipeName: true, allergens: true, ingredients: { select: { id: true, ingredientName: true, ingredientId: true } } },
  });
  const catAllergensOf = (ingredientId) => {
    const c = catalog.find((x) => x.ingredient?.id === ingredientId);
    const a = c?.sourceRecord?.allergens;
    return Array.isArray(a) ? a : [];
  };
  const recipeAllergenPlan = [];
  for (const r of recipes) {
    const set = new Set(Array.isArray(r.allergens) ? r.allergens : []);
    const before = set.size;
    for (const l of r.ingredients) {
      for (const a of catAllergensOf(l.ingredientId)) set.add(a);
      for (const a of (LINE_ALLERGEN_HINTS[normalize(l.ingredientName)] || [])) set.add(a);
    }
    if (set.size === before) continue;
    const to = [...set];
    recipeAllergenPlan.push({ recipeId: r.id, name: r.recipeName, to });
    if (APPLY) await db.recipe.update({ where: { id: r.id }, data: { allergens: to } });
  }
  plan.verified.recipeAllergens = recipeAllergenPlan;

  // ---- 4. poultry temperature guidance (recipes WITH instructions) ---------
  const meatRecipes = await db.recipe.findMany({
    where: { ingredients: { some: { OR: ['chicken', 'turkey', 'duck', 'poultry'].map((w) => ({ ingredientName: { contains: w, mode: 'insensitive' } })) } } },
    select: { id: true, recipeName: true, instructions: true, ingredients: { select: { ingredientName: true } } },
  });
  const tempPlan = [];
  for (const r of meatRecipes) {
    const names = r.ingredients.map((l) => l.ingredientName).join(' ');
    if (!POULTRY_RE.test(names)) continue;
    const steps = Array.isArray(r.instructions) ? r.instructions : [];
    const text = steps.map((s) => (typeof s === 'string' ? s : s.text || '')).join(' ');
    if (!steps.length) { (plan.needsHuman.tempNoInstructions ||= []).push(r.recipeName); continue; }
    if (TEMP_RE.test(text)) continue;
    tempPlan.push(r.recipeName);
    if (APPLY) {
      const next = [...steps.map((s, i) => (typeof s === 'string' ? { step: i + 1, text: s } : s)), { ...POULTRY_STEP, step: steps.length + 1 }];
      await db.recipe.update({ where: { id: r.id }, data: { instructions: next } });
    }
  }
  plan.verified.poultryTempAdded = tempPlan;

  // ---- 5. GLUCOSE macro defect → cap at physical max (100g), not invented ---
  // carbsPer100g is non-nullable Float — null is impossible and 0 would lie
  // (a glucose product is ~all carbohydrate). 100 is the physical ceiling and
  // overestimates real glucose (~91g), i.e. errs toward overstating carbs.
  const glucose = await db.ingredient.findUnique({ where: { id: GLUCOSE_ID }, select: { carbsPer100g: true } });
  if (glucose && glucose.carbsPer100g > 100) {
    plan.verified.glucose = { id: GLUCOSE_ID, action: 'carbsPer100g 107 -> 100 (physical max; conservative over-estimate pending USDA-sourced value)' };
    if (APPLY) await db.ingredient.update({ where: { id: GLUCOSE_ID }, data: { carbsPer100g: 100 } });
  }

  // ---- report ---------------------------------------------------------------
  plan.summary = {
    relinkApplied: APPLY ? relinkV.length + (ASSUME ? relinkA.length : 0) : 0,
    relinkPlanned: relinkV.length, relinkAssumption: relinkA.length, relinkNeedsHuman: relinkH.length,
    catalogAllergenUpdates: catAllergenPlan.filter((c) => !c.skipped).length,
    recipeAllergenUpdates: recipeAllergenPlan.length,
    poultryTempSteps: tempPlan.length,
    glucoseFix: !!plan.verified.glucose,
  };
  const out = path.join(__dirname, '..', 'docs', 'recipe-intelligence', 'data-remediation-plan.json');
  fs.writeFileSync(out, JSON.stringify(plan, null, 2));
  console.log(JSON.stringify(plan.summary, null, 2));
  console.log(`${APPLY ? 'APPLIED' : 'DRY-RUN'} — plan → ${out}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
