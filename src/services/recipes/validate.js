// Deterministic recipe validation pipeline (Phase 5).
//
// validateGeneratedRecipe(recipe, constraints, ctx) inspects a candidate
// recipe — AI-generated OR imported OR transformed — and returns a typed
// outcome. Nothing reaches a user as "validated" while a critical stage is
// unresolved.
//
//   status: PASS | NEEDS_CLARIFICATION | NEEDS_REVIEW | FAIL
//   violations[]: {ruleId, stage, severity: block|review|clarify|warn, reason}
//   nutrition: deterministic per-serving totals + unresolvedLines
//   stages: per-stage status map for observability
//
// Severity → status: block→FAIL, clarify→NEEDS_CLARIFICATION,
// review→NEEDS_REVIEW, warn→PASS with warnings. Worst severity wins.
//
// Revalidate on ANY input change — callers must not cache a PASS across
// ingredient/quantity/method/constraint/rule changes.

const { getPrisma } = require('../../lib/prisma');
const { normalize } = require('../ingredientCsv');
const { computeFromLines } = require('../recipeImport');
const { violatesHard, textHasTerm } = require('./constraints');

const VALIDATOR_VERSION = 'recipe-validator-v1';
const MAX_INGREDIENTS = 40;
const MAX_AMOUNT_G = 5000;

// Packaged/compound names whose composition we usually cannot decompose —
// when unresolved, they get a review finding rather than a silent pass.
const COMPOUND_HINT = /\b(sauce|paste|mix|broth|stock|marinade|dressing|seasoning|gravy|spread|condiment|bouillon)\b/i;

// Deterministic food-safety rules. These flag for REVIEW — they never prove
// safety by absence, only catch known-unsafe patterns.
const SAFETY_RULES = [
  {
    id: 'POULTRY_TEMP_UNVERIFIED',
    when: (ctx) => ctx.joinedText && /\b(chicken|turkey|duck|poultry)\b/i.test(ctx.ingredientText),
    check: (ctx) => /\b(1[6-9]\d|2\d\d)\s*°?\s*f\b|\b(7[4-9]|8\d|9\d|1\d\d)\s*°?\s*c\b/i.test(ctx.joinedText),
    severity: 'review',
    reason: 'poultry present but instructions do not verify ≥165°F/74°C internal temperature',
  },
  {
    id: 'RAW_EGG_RISK',
    when: (ctx) => /\begg(s)?\b/i.test(ctx.ingredientText) && /\b(raw|uncooked|no.?cook)\b/i.test(ctx.joinedText),
    check: () => false,
    severity: 'review',
    reason: 'raw/uncooked egg — unsafe for vulnerable users; verify preparation',
  },
  {
    id: 'RAW_FLOUR',
    when: (ctx) => /\bflour\b/i.test(ctx.ingredientText) && /\b(raw|no.?bake|edible dough)\b/i.test(ctx.joinedText),
    check: () => false,
    severity: 'review',
    reason: 'raw flour is a known pathogen risk — heat-treat before no-bake use',
  },
  {
    id: 'LEFTOVER_RICE',
    when: (ctx) => /\brice\b/i.test(ctx.ingredientText) && /\b(leftover|reheat|day.?old)\b/i.test(ctx.joinedText),
    check: () => /\b(refrigerat|cool|within 1 hour|steam|reheat(ed)? (thoroughly|until)|piping hot)\b/i.test(ctx.joinedText),
    severity: 'warn',
    reason: 'cooked-rice storage/reheating steps not confirmed — Bacillus cereus risk',
  },
  {
    id: 'SHELLFISH_RAW',
    when: (ctx) => /\b(shrimp|prawn|crab|oyster|clam|mussel|scallop)\b/i.test(ctx.ingredientText) && /\b(raw|ceviche|crudo|no.?cook)\b/i.test(ctx.joinedText),
    check: () => false,
    severity: 'review',
    reason: 'raw shellfish — verify sourcing and vulnerable-population guidance',
  },
];

const SEVERITY_RANK = { block: 4, clarify: 3, review: 2, warn: 1 };
const STATUS_BY_SEVERITY = { block: 'FAIL', clarify: 'NEEDS_CLARIFICATION', review: 'NEEDS_REVIEW', warn: 'PASS' };

async function loadCatalog(prisma) {
  const rows = await prisma.ingredientCatalog.findMany({
    where: { usable: true },
    select: {
      id: true, name: true, identityKey: true, normalizedName: true, aliases: true, category: true, sourceRecord: true,
      ingredient: { select: { id: true, name: true, caloriesPer100g: true, proteinPer100g: true, carbsPer100g: true, fatPer100g: true, fiberPer100g: true, attributes: { select: { attribute: true } } } },
    },
  });
  const byName = new Map();
  const byId = new Map();
  for (const c of rows) {
    if (c.ingredient?.id) byId.set(c.ingredient.id, c);
    for (const n of [c.normalizedName, ...(c.aliases || [])]) if (n && !byName.has(n)) byName.set(n, c);
  }
  return { rows, byName, byId };
}

function catAllergens(c) {
  const a = c?.sourceRecord && typeof c.sourceRecord === 'object' ? c.sourceRecord.allergens : null;
  if (Array.isArray(a)) return a.map(normalize);
  if (typeof a === 'string') return a.split(/[,;]/).map(normalize).filter(Boolean);
  return [];
}

/**
 * @param {object} recipe — candidate {name|recipeName, servings, ingredients|lines[], instructions[]|string}
 * @param {object} constraints — NormalizedConstraints from loadConstraints
 * @param {object} [ctx] — {prisma, catalog}
 */
async function validateGeneratedRecipe(recipe, constraints, ctx = {}) {
  const prisma = ctx.prisma || getPrisma();
  const catalog = ctx.catalog || await loadCatalog(prisma);
  const violations = [];
  const stages = {};
  let lines = [];
  let per = null;
  const mark = (stage, ruleId, severity, reason) => {
    violations.push({ ruleId, stage, severity, reason });
    const rank = (v) => SEVERITY_RANK[v.severity] || 0;
    const cur = stages[stage]?.worst || 0;
    stages[stage] = { worst: Math.max(cur, rank), status: rank === 0 ? 'PASS' : 'FLAGGED' };
  };
  const stagePass = (s) => { if (!stages[s]) stages[s] = { worst: 0, status: 'PASS' }; };

  // ---- 1. schema ----------------------------------------------------------
  const name = String(recipe?.name || recipe?.recipeName || '').trim();
  const rawLines = recipe?.ingredients || recipe?.lines || [];
  const instructions = Array.isArray(recipe?.instructions)
    ? recipe.instructions
    : String(recipe?.instructions || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const servings = Number(recipe?.servings);

  if (!name || name.length > 140) mark('schema', 'SCHEMA_NAME', 'block', 'recipe name missing or >140 chars');
  if (!Number.isFinite(servings) || servings < 1 || servings > 20 || !Number.isInteger(servings)) {
    mark('schema', 'SCHEMA_SERVINGS', 'block', `invalid servings "${recipe?.servings}"`);
  }
  if (!Array.isArray(rawLines) || !rawLines.length || rawLines.length > MAX_INGREDIENTS) {
    mark('schema', 'SCHEMA_LINES', 'block', `ingredient lines must be 1–${MAX_INGREDIENTS}`);
  }
  for (const l of Array.isArray(rawLines) ? rawLines : []) {
    const n = String(l?.ingredientName || l?.name || '').trim();
    if (!n) mark('schema', 'SCHEMA_LINE_NAME', 'block', 'ingredient line missing a name');
  }
  stagePass('schema');
  if (stages.schema.status === 'FLAGGED') return finish(); // can't continue safely

  // ---- 2. identity ---------------------------------------------------------
  lines = rawLines.map((l) => {
    const ingredientName = String(l.ingredientName || l.name || '').trim();
    const cat = l.ingredientId ? catalog.byId.get(l.ingredientId) : null;
    const byName = cat || catalog.byName.get(normalize(ingredientName)) || null;
    return {
      ingredientName,
      ingredientId: l.ingredientId || byName?.ingredient?.id || null,
      amountG: Number.isFinite(Number(l.amountG)) ? Number(l.amountG) : null,
      unit: l.unit || null,
      optional: !!l.optional,
      cat: byName,
      // Resolution means a catalog match — a caller-supplied ingredientId
      // that doesn't resolve is still unknown (fail closed below).
      resolved: !!byName,
      _per100: byName?.ingredient ? {
        calories: byName.ingredient.caloriesPer100g, proteinG: byName.ingredient.proteinPer100g,
        carbsG: byName.ingredient.carbsPer100g, fatG: byName.ingredient.fatPer100g, fiberG: byName.ingredient.fiberPer100g,
      } : null,
    };
  });

  const userHasAllergies = (constraints.hard?.allergenTerms?.size || 0) > 0;
  for (const l of lines) {
    if (l.resolved) continue;
    // Unknown ingredient: cannot verify allergens/derivatives — fail closed
    // when the user carries allergies, else require human review.
    const sev = userHasAllergies && !l.optional ? 'block' : 'review';
    mark('identity', 'INGREDIENT_UNRESOLVED', sev, `"${l.ingredientName}" not resolvable in the catalog — composition unknown`);
  }
  stagePass('identity');

  // ---- 3. quantity ----------------------------------------------------------
  for (const l of lines) {
    if (l.amountG == null) {
      mark('quantity', 'QUANTITY_MISSING', l.optional ? 'warn' : 'clarify', `no amount given for "${l.ingredientName}"`);
      continue;
    }
    if (l.amountG <= 0) mark('quantity', 'QUANTITY_NONPOSITIVE', 'block', `"${l.ingredientName}" amount ${l.amountG}g`);
    else if (l.amountG > MAX_AMOUNT_G) mark('quantity', 'QUANTITY_IMPLAUSIBLE', 'block', `"${l.ingredientName}" amount ${l.amountG}g exceeds ${MAX_AMOUNT_G}g`);
  }
  stagePass('quantity');

  // ---- 4. compound decomposition -------------------------------------------
  for (const l of lines) {
    const components = l.cat?.sourceRecord && typeof l.cat.sourceRecord === 'object' ? l.cat.sourceRecord.components : null;
    if (Array.isArray(components) && components.length) {
      l._components = components.map((c) => String(c));
      continue;
    }
    if (!l.resolved && COMPOUND_HINT.test(l.ingredientName)) {
      mark('decompose', 'COMPOUND_UNRESOLVED', userHasAllergies ? 'block' : 'review', `"${l.ingredientName}" looks compound — contents undeclared`);
    }
  }
  stagePass('decompose');

  // ---- 5-8. hard filters (allergy / exclusion / pattern / medical) ----------
  const stageOf = (ruleId) => (ruleId.startsWith('ALLERGEN') ? 'allergen'
    : ruleId === 'CONDITION_ATTR' ? 'medical'
    : ruleId === 'EXCLUDED_TERM' ? 'exclusion' : 'pattern');
  for (const l of lines) {
    const texts = [l.ingredientName, ...(l._components || [])].join(' ');
    const v = violatesHard(constraints.hard, {
      text: texts,
      allergens: [...catAllergens(l.cat), ...(l._components || [])],
      category: l.cat?.category || null,
      tags: Array.isArray(l.cat?.sourceRecord?.tags) ? l.cat.sourceRecord.tags : [],
      attributes: (l.cat?.ingredient?.attributes || []).map((a) => a.attribute),
    });
    if (v) mark(stageOf(v.ruleId), v.ruleId, 'block', `"${l.ingredientName}": ${v.reason}`);
  }
  // Recipe-level declared allergens count as declarations, not proof.
  for (const a of recipe?.allergens || []) {
    if (constraints.hard.allergenTerms && [...constraints.hard.allergenTerms].some((t) => textHasTerm(a, t) || a === t)) {
      mark('allergen', 'ALLERGEN_DECLARED', 'block', `recipe declares "${a}" — matches user allergy`);
    }
  }
  for (const s of ['allergen', 'exclusion', 'pattern', 'medical']) stagePass(s);

  // Medical warn-rules (APPROVED, action=warn) surface as warnings.
  for (const wr of constraints.hard.warnRules || []) {
    const hit = lines.find((l) => (l.cat?.ingredient?.attributes || []).some((a) => a.attribute === wr.attribute));
    if (hit) mark('medical', 'CONDITION_WARN', 'warn', `"${hit.ingredientName}": ${wr.reason || `attribute ${wr.attribute}`} (${wr.conditionName})`);
  }

  // ---- 9. nutrition ----------------------------------------------------------
  const computable = lines.filter((l) => l.amountG != null && l.amountG > 0);
  per = computable.length ? computeFromLines(computable, { servings, finishedYieldG: recipe?.finishedYieldG, portionG: recipe?.portionG }) : null;
  const missingNutrition = lines.filter((l) => !l._per100 && l.amountG > 0);
  if (missingNutrition.length) {
    const hardLimitRelevant = (constraints.hard.bannedAttributes?.size || 0) > 0;
    mark('nutrition', 'NUTRITION_MISSING', hardLimitRelevant ? 'review' : 'warn',
      `${missingNutrition.length} line(s) lack verified nutrition: ${missingNutrition.slice(0, 3).map((l) => l.ingredientName).join(', ')}`);
  }
  if (per) {
    const kcal = per.calories;
    if (Number.isFinite(kcal) && kcal > 2500) mark('nutrition', 'NUTRITION_IMPLAUSIBLE', 'review', `${Math.round(kcal)} kcal/serving exceeds plausibility bound`);
    if (Number.isFinite(kcal) && kcal <= 0) mark('nutrition', 'NUTRITION_ZERO', 'review', 'computed nutrition is zero — check line amounts');
  }
  stagePass('nutrition');

  // ---- 9b. medical nutrient limits --------------------------------------------
  // APPROVED HealthConditionNutrientRule thresholds vs computed values.
  // Missing nutrient data on a hard limit → review (never treated as zero).
  const nutrientValue = (code, basis) => {
    if (!per) return undefined;
    const k = normalize(code).replace(/[\s-]+/g, '_');
    const serving = { calories: per.calories, energy: per.calories, kcal: per.calories, protein: per.proteinG, carbohydrate: per.carbsG, carbs: per.carbsG, fat: per.fatG, total_fat: per.fatG, fiber: per.fiberG, fibre: per.fiberG, dietary_fiber: per.fiberG }[k];
    if (serving == null) return undefined;
    if (basis === 'PER_100G') {
      const totalG = lines.reduce((s, l) => s + (l.amountG || 0), 0);
      return totalG > 0 ? (serving * (servings || 1) * 100) / totalG : undefined;
    }
    return serving; // PER_SERVING and DAILY compare against one serving
  };
  for (const lim of constraints?.nutrientLimits || constraints?.hard?.nutrientLimits || []) {
    if (!['LIMIT', 'AVOID_IF_INDICATED', 'MONITOR', 'PRIORITIZE'].includes(lim.action)) continue;
    const isHard = lim.action === 'LIMIT' || lim.action === 'AVOID_IF_INDICATED';
    const value = nutrientValue(lim.nutrientKey, lim.thresholdBasis);
    if (value == null || !Number.isFinite(value)) {
      mark('limits', 'LIMIT_UNVERIFIABLE', isHard ? 'review' : 'warn',
        `${lim.nutrientKey || 'nutrient'}: cannot verify ${lim.action} threshold — nutrient not computed from ingredient data${lim.conditionName ? ` (${lim.conditionName})` : ''}`);
      continue;
    }
    if (!Number.isFinite(lim.thresholdValue)) {
      mark('limits', 'LIMIT_NO_THRESHOLD', 'review', `${lim.nutrientKey}: ${lim.action} rule has no threshold value`);
      continue;
    }
    const rounded = Math.round(value * 10) / 10;
    if (isHard && value > lim.thresholdValue) {
      mark('limits', 'LIMIT_EXCEEDED', 'block', `${lim.nutrientKey} ${rounded}${lim.nutrientUnit || ''} exceeds ${lim.thresholdValue}${lim.thresholdUnit || ''} ${lim.thresholdBasis?.toLowerCase() || 'per serving'}${lim.conditionName ? ` (${lim.conditionName})` : ''}`);
    } else if (lim.action === 'MONITOR' && value > lim.thresholdValue) {
      mark('limits', 'LIMIT_MONITOR', 'warn', `${lim.nutrientKey} ${rounded}${lim.nutrientUnit || ''} is above the monitored level${lim.conditionName ? ` (${lim.conditionName})` : ''}`);
    } else if (lim.action === 'PRIORITIZE' && value < lim.thresholdValue) {
      mark('limits', 'TARGET_BELOW', 'warn', `${lim.nutrientKey} ${rounded}${lim.nutrientUnit || ''} below prioritized target${lim.conditionName ? ` (${lim.conditionName})` : ''}`);
    }
  }
  // MacroGoal sanity: one serving consuming most of the daily budget is a
  // portion-design problem, not a safety violation → warn.
  if (per?.calories != null && constraints?.limits?.caloriesTarget && per.calories > constraints.limits.caloriesTarget * 0.75) {
    mark('limits', 'PORTION_DOMINANT', 'warn', `one serving is ~${Math.round((per.calories / constraints.limits.caloriesTarget) * 100)}% of the daily calorie target`);
  }
  stagePass('limits');

  // ---- 10-12. feasibility / safety / servings --------------------------------
  const joinedText = instructions.join(' ');
  if (!instructions.length) mark('feasibility', 'INSTRUCTIONS_MISSING', 'clarify', 'no cooking instructions provided');
  else {
    // Lines never referenced in instructions (AI hallucination guard) — soft.
    const unreferenced = lines.filter((l) => {
      const w = normalize(l.ingredientName).split(' ')[0];
      return w.length >= 4 && !new RegExp(`\\b${w}`, 'i').test(joinedText);
    });
    if (unreferenced.length >= Math.ceil(lines.length / 2) && lines.length >= 3) {
      mark('feasibility', 'INSTRUCTIONS_UNREFERENCED', 'review', `${unreferenced.length}/${lines.length} ingredients never appear in instructions`);
    }
    // Ingredients named in steps but absent from the line list.
    const stepIngredients = (recipe?.instructionIngredients || []).filter(Boolean);
    for (const s of stepIngredients) {
      if (!lines.some((l) => textHasTerm(l.ingredientName, s))) {
        mark('feasibility', 'INSTRUCTION_EXTRA_INGREDIENT', 'clarify', `instructions use "${s}" which is not in the ingredient list`);
      }
    }
  }
  // Equipment: declared + instruction-detected vs the user's available set.
  // Missing → clarify (profile may be stale) — feasibility, not safety.
  const EQUIPMENT_TERMS = ['oven', 'air fryer', 'airfryer', 'blender', 'pressure cooker', 'instant pot', 'slow cooker', 'microwave', 'grill', 'food processor', 'stand mixer', 'rice cooker', 'toaster', 'stovetop', 'broiler', 'steamer', 'deep fryer'];
  const declaredEq = (Array.isArray(recipe?.equipment) ? recipe.equipment : []).map(normalize);
  const detectedEq = EQUIPMENT_TERMS.filter((t) => textHasTerm(joinedText, t));
  const owned = new Set((constraints?.equipment || []).map(normalize));
  if (owned.size) {
    const missingEq = [...new Set([...declaredEq, ...detectedEq])]
      .filter((e) => ![...owned].some((o) => o === e || o.includes(e) || e.includes(o) || o.replace(/\s+/g, '') === e.replace(/\s+/g, '')));
    if (missingEq.length) mark('feasibility', 'EQUIPMENT_MISSING', 'clarify', `requires equipment not listed as available: ${missingEq.slice(0, 4).join(', ')}`);
  }
  stagePass('feasibility');

  const ingredientText = lines.map((l) => l.ingredientName).join(' ');
  const safetyCtx = { joinedText, ingredientText };
  for (const rule of SAFETY_RULES) {
    if (rule.when(safetyCtx) && !rule.check(safetyCtx)) mark('safety', rule.id, rule.severity, rule.reason);
  }
  stagePass('safety');

  const totalG = lines.reduce((s, l) => s + (l.amountG || 0), 0);
  const perServingG = totalG / Math.max(1, servings || 1);
  if (perServingG > 1500) mark('servings', 'SERVING_IMPLAUSIBLE', 'review', `${Math.round(perServingG)}g per serving is implausible`);
  if (perServingG < 30 && totalG > 0) mark('servings', 'SERVING_TINY', 'warn', `${Math.round(perServingG)}g per serving — verify yield`);
  stagePass('servings');

  // ---- 13. substitutions ------------------------------------------------------
  for (const sub of recipe?.substitutions || []) {
    const subName = String(sub?.ingredientName || sub?.name || '');
    const cat = catalog.byName.get(normalize(subName));
    if (subName && !cat) mark('substitution', 'SUB_UNRESOLVED', 'review', `proposed substitution "${subName}" not in catalog`);
    const v = cat && violatesHard(constraints.hard, {
      text: subName, allergens: catAllergens(cat), category: cat.category,
      tags: Array.isArray(cat.sourceRecord?.tags) ? cat.sourceRecord.tags : [],
      attributes: (cat.ingredient?.attributes || []).map((a) => a.attribute),
    });
    if (v) mark('substitution', v.ruleId, 'block', `substitution "${subName}": ${v.reason}`);
  }
  stagePass('substitution');

  return finish();

  // ---------------------------------------------------------------------------
  function finish() {
    const worst = violations.reduce((m, v) => Math.max(m, SEVERITY_RANK[v.severity] || 0), 0);
    const status = worst === 0 ? 'PASS' : STATUS_BY_SEVERITY[Object.keys(SEVERITY_RANK).find((k) => SEVERITY_RANK[k] === worst)];
    return {
      status,
      validatorVersion: VALIDATOR_VERSION,
      violations,
      warnings: violations.filter((v) => v.severity === 'warn').map((v) => v.reason),
      stages,
      nutrition: per ? {
        perServing: { calories: per.calories, proteinG: per.proteinG, carbsG: per.carbsG, fatG: per.fatG, fiberG: per.fiberG },
        computedLines: per._computedLines, missingLines: per._unresolvedLines,
        provenance: 'ingredient_per100_deterministic',
      } : { perServing: null, computedLines: 0, missingLines: lines?.length || 0, provenance: 'unavailable' },
      constraintVersion: constraints?.version || null,
    };
  }
}

/**
 * Persist a validation outcome to SafetyAuditLog (checkType
 * 'recipe_validation'). Privacy-conscious: stores status, ruleIds, and
 * versions — never constraint details, profile data, or ingredient lists.
 * Fire-and-forget by contract: audit failure must never break a request.
 */
async function recordValidation(prisma, { userId, input, validation }) {
  try {
    if (!userId || !validation) return;
    await prisma.safetyAuditLog.create({
      data: {
        userId: String(userId),
        checkType: 'recipe_validation',
        input: {
          candidate: typeof input === 'string' ? input : input?.name || null,
          constraintVersion: validation.constraintVersion,
          validatorVersion: validation.validatorVersion,
        },
        result: {
          status: validation.status,
          ruleIds: validation.violations.map((v) => v.ruleId),
          violations: validation.violations.slice(0, 20).map((v) => ({ ruleId: v.ruleId, stage: v.stage, severity: v.severity })),
        },
        passed: validation.status === 'PASS',
      },
    });
  } catch { /* audit write failure is non-fatal by design */ }
}

module.exports = { validateGeneratedRecipe, VALIDATOR_VERSION, SAFETY_RULES, loadCatalog, recordValidation, catAllergens };
