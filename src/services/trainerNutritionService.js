// Trainer nutrition guidance.
//
// Scope-of-practice guardrails baked into every path:
//  - Plans are *suggestions*. Every read payload carries `disclaimer`; trainer
//    guidance is never relabeled as medical nutrition therapy.
//  - Allergy warnings are computed only when the client granted `food_logs` or
//    `nutrition_summaries` consent on the relation (trainer reading client
//    health data). Conflicting items are reported, never silently dropped.
//  - FoodLog/MacroGoal are never auto-written. The ONLY write path is the
//    client-initiated /log endpoint, which creates the client's own FoodLog
//    rows using the same semantics as POST /food-logs.
const crypto = require('crypto');
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const nutritionMath = require('./nutrition');
const {
  requireApprovedTrainer,
  requireActiveRelation,
  getGrantedCategories,
} = require('./trainerAccess');

const DISCLAIMER = 'General fitness nutrition guidance — not medical nutrition therapy.';

// Trainer may read client allergy data only when one of these is granted.
const ALLERGY_CONSENT_CATEGORIES = ['food_logs', 'nutrition_summaries'];

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_ORDER = new Map(MEAL_TYPES.map((t, i) => [t, i]));
const TARGET_KEYS = ['caloriesKcal', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'waterMl'];
const MAX_MEALS = 50;
const MAX_ITEMS_PER_MEAL = 100;

const PLAN_INCLUDE = {
  meals: { include: { items: true } },
  targets: true,
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function cleanString(value, field, max, { required = false } = {}) {
  if (value == null) {
    if (required) throw httpError(400, `${field} required`);
    return null;
  }
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw httpError(400, `Invalid ${field}`);
  }
  return value.trim();
}

function cleanQuantity(value, field = 'quantityG') {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) throw httpError(400, `Invalid ${field}`);
  return n;
}

function cleanMealType(value) {
  const t = String(value || 'snack').trim().toLowerCase().slice(0, 30);
  return t || 'snack';
}

function validateItems(items) {
  if (items == null) return [];
  if (!Array.isArray(items) || items.length > MAX_ITEMS_PER_MEAL) {
    throw httpError(400, `At most ${MAX_ITEMS_PER_MEAL} items per meal allowed`);
  }
  return items.map((item) => {
    if (!item || typeof item !== 'object') throw httpError(400, 'Invalid plan item');
    const ingredientId = cleanString(item.ingredientId, 'ingredientId', 120);
    const recipeId = cleanString(item.recipeId, 'recipeId', 120);
    const foodName = cleanString(item.foodName, 'foodName', 300);
    if (!ingredientId && !recipeId && !foodName) {
      throw httpError(400, 'Each item needs an ingredientId, recipeId or foodName');
    }
    let substitutions = null;
    if (item.substitutions != null) {
      substitutions = item.substitutions;
      if (JSON.stringify(substitutions).length > 2000) throw httpError(400, 'Invalid substitutions');
    }
    return {
      ingredientId,
      recipeId,
      foodName,
      quantityG: cleanQuantity(item.quantityG),
      substitutions,
    };
  });
}

function validateMeals(meals) {
  if (meals == null) return [];
  if (!Array.isArray(meals) || meals.length > MAX_MEALS) {
    throw httpError(400, `At most ${MAX_MEALS} meals allowed`);
  }
  return meals.map((meal) => {
    if (!meal || typeof meal !== 'object') throw httpError(400, 'Invalid meal');
    return {
      mealType: cleanMealType(meal.mealType),
      timing: cleanString(meal.timing, 'timing', 100),
      notes: cleanString(meal.notes, 'notes', 2000),
      items: { create: validateItems(meal.items) },
    };
  });
}

function validateTargets(targets) {
  if (targets == null) return null;
  if (typeof targets !== 'object' || Array.isArray(targets)) throw httpError(400, 'Invalid targets');
  const data = {};
  for (const key of TARGET_KEYS) {
    if (targets[key] == null) continue;
    const n = Number(targets[key]);
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw httpError(400, `Invalid ${key}`);
    data[key] = n;
  }
  return data;
}

/** Stored targets row -> plain object, or null when every field is empty. */
function targetsFromRow(row) {
  if (!row) return null;
  const data = Object.fromEntries(TARGET_KEYS.map((k) => [k, row[k]]).filter(([, v]) => v != null));
  return Object.keys(data).length ? data : null;
}

function cloneMeals(meals) {
  return (meals || []).map((m) => ({
    mealType: m.mealType, timing: m.timing, notes: m.notes,
    items: { create: (m.items || []).map((i) => ({ ingredientId: i.ingredientId, recipeId: i.recipeId, foodName: i.foodName, quantityG: i.quantityG, substitutions: i.substitutions })) },
  }));
}

// ---------------------------------------------------------------------------
// Allergy matching
// ---------------------------------------------------------------------------

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Canonical allergen keys -> ingredient attributes (IngredientAttribute) and
// food-name patterns. Mirrors the conservative keyword approach in
// menuAnalysis.js — flags possible matches, never claims an item is safe.
const ALLERGENS = [
  { key: 'peanut', names: ['peanut'], attributes: ['NUT'], pattern: /peanut/i },
  {
    key: 'tree_nut',
    names: ['tree nut', 'nut', 'almond', 'cashew', 'walnut', 'pistachio', 'hazelnut', 'pecan', 'macadamia', 'brazil nut'],
    attributes: ['NUT'],
    pattern: /almond|cashew|walnut|pistachio|hazelnut|pecan|macadamia|brazil\s*nut|\bnut(s)?\b/i,
  },
  {
    key: 'dairy',
    names: ['dairy', 'milk', 'lactose', 'casein', 'whey'],
    attributes: ['DAIRY'],
    pattern: /milk|cheese|cheddar|mozzarella|parmesan|butter|cream|ghee|paneer|yogurt|yoghurt|whey|casein|lactose/i,
  },
  { key: 'egg', names: ['egg'], attributes: ['EGG'], pattern: /\beggs?\b|mayonnaise|\bmayo\b|aioli/i },
  {
    key: 'gluten',
    names: ['gluten', 'wheat', 'celiac', 'coeliac'],
    attributes: ['CONTAINS_GLUTEN'],
    pattern: /wheat|gluten|bread|\bbun\b|pasta|noodle|seitan|\bflour\b|barley|\brye\b|couscous/i,
  },
  {
    key: 'shellfish',
    names: ['shellfish', 'shrimp', 'prawn', 'crab', 'lobster', 'crustacean'],
    attributes: ['SHELLFISH'],
    pattern: /shrimp|prawn|crab|lobster|scallop|shellfish|oyster|mussel|clam|crayfish/i,
  },
  {
    key: 'fish',
    names: ['fish', 'salmon', 'tuna', 'cod', 'anchovy'],
    attributes: ['FISH'],
    pattern: /\bfish\b|salmon|tuna|\bcod\b|anchov|tilapia|sardine|trout|mackerel|herring/i,
  },
  { key: 'soy', names: ['soy', 'soya', 'soybean'], attributes: ['SOY'], pattern: /\bsoy\b|soya|tofu|edamame|miso|tempeh/i },
  { key: 'sesame', names: ['sesame'], attributes: ['SESAME'], pattern: /sesame|tahini/i },
];

/** Match an allergy record name (free text) to canonical matchers. */
function matchersForAllergy(name) {
  const lower = String(name || '').toLowerCase().trim();
  if (!lower) return [];
  const matched = ALLERGENS.filter((a) =>
    a.names.some((n) => new RegExp(`\\b${escapeRx(n)}s?\\b`, 'i').test(lower)));
  if (matched.length) return matched;
  // Fallback: build a pattern from the allergy term itself so custom allergy
  // names ("strawberry", "mustard") still flag obvious name matches.
  const term = lower
    .replace(/\b(allergy|allergies|allergic|intolerance|intolerant|sensitivity|sensitive|to)\b/g, ' ')
    .replace(/[^a-z\s-]/g, ' ')
    .trim();
  if (term.length < 3) return [];
  return [{ key: term, attributes: [], pattern: new RegExp(escapeRx(term).replace(/e?s$/, 'e?s?'), 'i') }];
}

async function loadClientAllergyNames(clientUserId, db = getPrisma()) {
  const rows = await db.userAllergy.findMany({
    where: { userId: clientUserId },
    include: { allergy: true },
  });
  return rows.map((r) => r.allergy.name).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Item resolution: names, attributes, nutrition
// ---------------------------------------------------------------------------

const NULL_NUTRITION = Object.fromEntries(nutritionMath.keys.map((k) => [k, null]));

async function loadItemRefs(plan, db = getPrisma()) {
  const items = (plan.meals || []).flatMap((m) => m.items || []);
  const ingredientIds = [...new Set(items.map((i) => i.ingredientId).filter(Boolean))];
  const recipeIds = [...new Set(items.map((i) => i.recipeId).filter(Boolean))];
  const [ingredients, recipes] = await Promise.all([
    ingredientIds.length
      ? db.ingredient.findMany({ where: { id: { in: ingredientIds } }, include: { catalog: true, attributes: true } })
      : [],
    recipeIds.length ? db.recipe.findMany({ where: { id: { in: recipeIds } } }) : [],
  ]);
  return {
    ingredients: new Map(ingredients.map((i) => [i.id, i])),
    recipes: new Map(recipes.map((r) => [r.id, r])),
  };
}

function itemDisplayName(item, refs) {
  if (item.foodName) return item.foodName;
  if (item.ingredientId && refs.ingredients.get(item.ingredientId)) return refs.ingredients.get(item.ingredientId).name;
  if (item.recipeId && refs.recipes.get(item.recipeId)) return refs.recipes.get(item.recipeId).recipeName;
  return 'Unknown item';
}

/**
 * Per-item nutrition via existing nutrient math.
 *  - ingredientId: per-100g catalog values scaled to quantityG (same math as
 *    ingredientNutrition.calculate / nutrition.fromIngredient + scale).
 *  - recipeId: stored recipe totals scaled by quantityG / portionG.
 *  - otherwise (or unresolvable): null fields, resolvable=false.
 */
function computeItemNutrition(item, refs) {
  if (item.ingredientId) {
    const ingredient = refs.ingredients.get(item.ingredientId);
    if (ingredient && !(ingredient.catalog && !ingredient.catalog.usable)) {
      try {
        return { resolvable: true, nutrition: nutritionMath.scale(nutritionMath.fromIngredient(ingredient), item.quantityG) };
      } catch (err) { /* fall through to unresolvable */ }
    }
    return { resolvable: false, nutrition: { ...NULL_NUTRITION } };
  }
  if (item.recipeId) {
    const recipe = refs.recipes.get(item.recipeId);
    if (recipe && recipe.portionG > 0) {
      const totals = { calories: recipe.calories, proteinG: recipe.proteinG, carbsG: recipe.carbsG, fatG: recipe.fatG, fiberG: recipe.fiberG };
      try {
        return { resolvable: true, nutrition: nutritionMath.scale(totals, (item.quantityG * 100) / recipe.portionG) };
      } catch (err) { /* fall through */ }
    }
    return { resolvable: false, nutrition: { ...NULL_NUTRITION } };
  }
  return { resolvable: false, nutrition: { ...NULL_NUTRITION } };
}

function sumTotals(items) {
  const complete = items.every((i) => i.resolvable);
  const partialTotals = {};
  const totals = {};
  for (const key of nutritionMath.keys) {
    const allKnown = items.every((i) => i.nutrition[key] != null);
    totals[key] = allKnown ? Math.round(items.reduce((s, i) => s + i.nutrition[key], 0) * 10000) / 10000 : null;
    const known = items.filter((i) => i.nutrition[key] != null);
    partialTotals[key] = known.length ? Math.round(known.reduce((s, i) => s + i.nutrition[key], 0) * 10000) / 10000 : null;
  }
  return { complete, totals, partialTotals };
}

/** Plan -> meals with per-item nutrition + meal/plan totals. */
async function attachNutrition(plan, db = getPrisma()) {
  const refs = await loadItemRefs(plan, db);
  const meals = [...(plan.meals || [])]
    .sort((a, b) => (MEAL_ORDER.get(a.mealType) ?? 99) - (MEAL_ORDER.get(b.mealType) ?? 99))
    .map((meal) => {
      const items = (meal.items || []).map((item) => ({
        ...item,
        name: itemDisplayName(item, refs),
        ...computeItemNutrition(item, refs),
      }));
      return { ...meal, items, ...sumTotals(items) };
    });
  const allItems = meals.flatMap((m) => m.items);
  return { meals, ...sumTotals(allItems) };
}

/**
 * Allergy conflicts for a plan vs a client's saved allergies.
 * Returns warnings only — items are never removed or altered.
 */
async function findAllergyConflicts(plan, allergyNames, db = getPrisma()) {
  if (!allergyNames.length) return [];
  const refs = await loadItemRefs(plan, db);
  const matchers = allergyNames.flatMap((name) => matchersForAllergy(name).map((m) => ({ allergen: name, ...m })));
  const conflicts = [];
  for (const meal of plan.meals || []) {
    for (const item of meal.items || []) {
      const name = itemDisplayName(item, refs);
      const attributes = (refs.ingredients.get(item.ingredientId)?.attributes || []).map((a) => a.attribute);
      for (const m of matchers) {
        const byName = m.pattern && m.pattern.test(name);
        const byAttribute = m.attributes.some((a) => attributes.includes(a));
        if (byName || byAttribute) {
          conflicts.push({
            itemId: item.id,
            mealId: meal.id,
            mealType: meal.mealType,
            item: name,
            allergen: m.allergen,
            match: byAttribute ? 'ingredient_attribute' : 'name',
          });
          break; // one warning per item per allergen
        }
      }
    }
  }
  return conflicts;
}

/**
 * Allergy check gated on relation consent. Returns
 * { consentGranted, allergyConflicts } — when consent is missing the check is
 * skipped entirely (trainer must not learn allergy data indirectly).
 */
async function consentedAllergyCheck(relationId, clientUserId, plan, db = getPrisma()) {
  const granted = await getGrantedCategories(relationId);
  const consentGranted = ALLERGY_CONSENT_CATEGORIES.some((c) => granted.has(c));
  if (!consentGranted) return { consentGranted: false, allergyConflicts: [] };
  const names = await loadClientAllergyNames(clientUserId, db);
  return { consentGranted: true, allergyConflicts: await findAllergyConflicts(plan, names, db) };
}

// ---------------------------------------------------------------------------
// Plan lifecycle (trainer side)
// ---------------------------------------------------------------------------

async function requireOwnedPlan(trainerUserId, planId, db = getPrisma()) {
  const trainer = await requireApprovedTrainer(trainerUserId);
  const plan = await db.trainerNutritionPlan.findUnique({
    where: { id: planId },
    include: PLAN_INCLUDE,
  });
  if (!plan || plan.trainerId !== trainer.id) throw httpError(404, 'Plan not found.');
  return { trainer, plan };
}

/**
 * Replace all child rows inside a transaction — mirrors the mealPlan
 * create-with-nested-items pattern: meals (with items) and targets are fully
 * rebuilt from the payload.
 */
async function replaceChildren(planId, { meals, targets }, tx) {
  await tx.trainerNutritionPlanMeal.deleteMany({ where: { planId } }); // items cascade
  await tx.trainerNutritionTargets.deleteMany({ where: { planId } });
  for (const { items, ...meal } of meals) {
    await tx.trainerNutritionPlanMeal.create({ data: { ...meal, planId, items } });
  }
  if (targets) await tx.trainerNutritionTargets.create({ data: { ...targets, planId } });
}

async function createDraft(trainerUserId, payload, tx = getPrisma()) {
  const trainer = await requireApprovedTrainer(trainerUserId);
  const title = cleanString(payload.title, 'title', 200, { required: true });
  const guidanceText = cleanString(payload.guidanceText, 'guidanceText', 10000);
  const meals = validateMeals(payload.meals);
  const targets = validateTargets(payload.targets);
  let clientId = null;
  if (payload.clientId != null) {
    clientId = cleanString(payload.clientId, 'clientId', 120, { required: true });
    await requireActiveRelation({ trainerId: trainer.id, clientUserId: clientId });
  }
  const plan = await tx.trainerNutritionPlan.create({
    data: { trainerId: trainer.id, clientId, title, guidanceText, status: 'draft', version: 1 },
  });
  await replaceChildren(plan.id, { meals, targets }, tx);
  return tx.trainerNutritionPlan.findUnique({ where: { id: plan.id }, include: PLAN_INCLUDE });
}

async function updateDraft(trainerUserId, planId, payload, tx = getPrisma()) {
  const { plan } = await requireOwnedPlan(trainerUserId, planId, tx);
  if (plan.status !== 'draft') throw httpError(409, 'Only draft plans can be edited — revise a published plan instead.');
  const data = {};
  if (payload.title !== undefined) data.title = cleanString(payload.title, 'title', 200, { required: true });
  if (payload.guidanceText !== undefined) data.guidanceText = cleanString(payload.guidanceText, 'guidanceText', 10000);
  if (payload.clientId !== undefined) {
    if (payload.clientId == null) {
      data.clientId = null;
    } else {
      const clientId = cleanString(payload.clientId, 'clientId', 120, { required: true });
      await requireActiveRelation({ trainerId: plan.trainerId, clientUserId: clientId });
      data.clientId = clientId;
    }
  }
  const meals = payload.meals === undefined ? null : validateMeals(payload.meals);
  const targets = payload.targets === undefined ? undefined : validateTargets(payload.targets);
  await tx.trainerNutritionPlan.update({ where: { id: plan.id }, data });
  if (meals !== null || targets !== undefined) {
    // Children omitted from the payload are preserved by re-creating them
    // verbatim (replace-children semantics like the MealPlan pattern).
    await replaceChildren(plan.id, {
      meals: meals === null ? cloneMeals(plan.meals) : meals,
      targets: targets === undefined ? targetsFromRow(plan.targets) : targets,
    }, tx);
  }
  return tx.trainerNutritionPlan.findUnique({ where: { id: plan.id }, include: PLAN_INCLUDE });
}

async function publishPlan(trainerUserId, planId, tx = getPrisma()) {
  const { plan } = await requireOwnedPlan(trainerUserId, planId, tx);
  if (plan.status !== 'draft') throw httpError(409, `Cannot publish a ${plan.status} plan.`);
  if (!plan.meals.length || !plan.meals.some((m) => m.items.length)) {
    throw httpError(400, 'Plan needs at least one meal item before publishing.');
  }
  return tx.trainerNutritionPlan.update({
    where: { id: plan.id },
    data: { status: 'published' },
    include: PLAN_INCLUDE,
  });
}

/** New draft version (version+1, supersedesId -> prior), prior archived. */
async function revisePlan(trainerUserId, planId, payload = {}, tx = getPrisma()) {
  const { trainer, plan } = await requireOwnedPlan(trainerUserId, planId, tx);
  if (plan.status !== 'published') throw httpError(409, 'Only published plans can be revised.');
  const title = payload.title !== undefined ? cleanString(payload.title, 'title', 200, { required: true }) : plan.title;
  const guidanceText = payload.guidanceText !== undefined ? cleanString(payload.guidanceText, 'guidanceText', 10000) : plan.guidanceText;
  const meals = payload.meals !== undefined ? validateMeals(payload.meals) : cloneMeals(plan.meals);
  const targets = payload.targets !== undefined ? validateTargets(payload.targets) : targetsFromRow(plan.targets);
  let clientId = plan.clientId;
  if (payload.clientId !== undefined) {
    clientId = payload.clientId == null ? null : cleanString(payload.clientId, 'clientId', 120, { required: true });
    if (clientId) await requireActiveRelation({ trainerId: trainer.id, clientUserId: clientId });
  }
  const next = await tx.trainerNutritionPlan.create({
    data: {
      trainerId: trainer.id,
      clientId,
      title,
      guidanceText,
      status: 'draft',
      version: plan.version + 1,
      supersedesId: plan.id,
    },
  });
  await replaceChildren(next.id, { meals, targets }, tx);
  await tx.trainerNutritionPlan.update({ where: { id: plan.id }, data: { status: 'archived' } });
  return tx.trainerNutritionPlan.findUnique({ where: { id: next.id }, include: PLAN_INCLUDE });
}

async function archivePlan(trainerUserId, planId, tx = getPrisma()) {
  const { plan } = await requireOwnedPlan(trainerUserId, planId, tx);
  if (plan.status === 'archived') throw httpError(409, 'Plan already archived.');
  return tx.trainerNutritionPlan.update({
    where: { id: plan.id },
    data: { status: 'archived' },
    include: PLAN_INCLUDE,
  });
}

// ---------------------------------------------------------------------------
// Preview (trainer): per-item nutrition + totals + consent-gated allergy check
// ---------------------------------------------------------------------------

async function previewPlan(trainerUserId, planId) {
  const prisma = getPrisma();
  const { plan } = await requireOwnedPlan(trainerUserId, planId, prisma);
  const nutrition = await attachNutrition(plan, prisma);

  // Pick the client this plan targets: explicit clientId or latest assignment.
  let clientId = plan.clientId;
  if (!clientId) {
    const latest = await prisma.trainerNutritionAssignment.findFirst({
      where: { planId: plan.id },
      orderBy: { assignedAt: 'desc' },
      select: { clientId: true },
    });
    clientId = latest?.clientId || null;
  }
  let allergy = { consentGranted: false, allergyConflicts: [] };
  if (clientId) {
    const relation = await prisma.trainerClient.findUnique({
      where: { trainerId_clientId: { trainerId: plan.trainerId, clientId } },
    });
    if (relation && relation.status === 'active') {
      allergy = await consentedAllergyCheck(relation.id, clientId, plan, prisma);
    }
  }
  return {
    planId: plan.id,
    version: plan.version,
    status: plan.status,
    disclaimer: DISCLAIMER,
    meals: nutrition.meals,
    totals: nutrition.totals,
    partialTotals: nutrition.partialTotals,
    complete: nutrition.complete,
    targets: plan.targets || null,
    allergyCheckConsent: allergy.consentGranted,
    allergyConflicts: allergy.allergyConflicts,
  };
}

// ---------------------------------------------------------------------------
// Assignment (trainer) + response/feedback (client)
// ---------------------------------------------------------------------------

async function assignPlan(trainerUserId, planId, clientUserId, tx = getPrisma()) {
  const { plan } = await requireOwnedPlan(trainerUserId, planId, tx);
  if (plan.status !== 'published') throw httpError(409, 'Only published plans can be assigned.');
  const { relation } = await requireActiveRelation({ trainerId: plan.trainerId, clientUserId });
  const open = await tx.trainerNutritionAssignment.findFirst({
    where: { planId: plan.id, clientId: clientUserId, status: { in: ['assigned', 'accepted'] } },
  });
  if (open) throw httpError(409, 'Plan already assigned to this client.');
  const assignment = await tx.trainerNutritionAssignment.create({
    data: { planId: plan.id, clientId: clientUserId, status: 'assigned' },
  });
  const allergy = await consentedAllergyCheck(relation.id, clientUserId, plan, tx);
  return {
    assignment,
    disclaimer: DISCLAIMER,
    allergyCheckConsent: allergy.consentGranted,
    allergyConflicts: allergy.allergyConflicts,
  };
}

async function requireClientAssignment(clientUserId, assignmentId, db = getPrisma()) {
  const assignment = await db.trainerNutritionAssignment.findUnique({
    where: { id: assignmentId },
    include: { plan: { include: PLAN_INCLUDE }, feedback: true },
  });
  if (!assignment || assignment.clientId !== clientUserId) throw httpError(404, 'Assignment not found.');
  return assignment;
}

async function respondToAssignment(clientUserId, assignmentId, action, tx = getPrisma()) {
  if (!['accept', 'decline'].includes(action)) throw httpError(400, 'action must be accept or decline');
  const assignment = await requireClientAssignment(clientUserId, assignmentId, tx);
  if (assignment.status !== 'assigned') throw httpError(409, `Assignment already ${assignment.status}.`);
  return tx.trainerNutritionAssignment.update({
    where: { id: assignment.id },
    data: { status: action === 'accept' ? 'accepted' : 'declined', respondedAt: new Date() },
  });
}

async function addFeedback(clientUserId, assignmentId, { rating, note }, tx = getPrisma()) {
  const assignment = await requireClientAssignment(clientUserId, assignmentId, tx);
  if (!['assigned', 'accepted'].includes(assignment.status)) {
    throw httpError(409, `Cannot give feedback on a ${assignment.status} assignment.`);
  }
  let r = null;
  if (rating != null) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw httpError(400, 'rating must be an integer 1-5');
    r = rating;
  }
  const text = cleanString(note, 'note', 2000);
  if (r == null && !text) throw httpError(400, 'rating or note required');
  return tx.trainerNutritionFeedback.create({
    data: { assignmentId: assignment.id, clientId: clientUserId, rating: r, note: text },
  });
}

// ---------------------------------------------------------------------------
// Client-initiated logging — the ONLY path that writes FoodLog.
// ---------------------------------------------------------------------------

/**
 * Creates real FoodLog rows for the client from a suggested meal.
 * Semantics mirror POST /food-logs: caller (the client) supplies the write;
 * computed nutrition is stored alongside provenance in nutritionSnapshot with
 * source/loggedSource 'trainer_plan'. Quantities adjustable via per-item
 * quantityG overrides; foodName-only items need explicit macro overrides.
 */
async function logAssignmentMeal(clientUserId, assignmentId, { mealId, loggedAt, items } = {}, tx = getPrisma()) {
  const assignment = await requireClientAssignment(clientUserId, assignmentId, tx);
  if (!['assigned', 'accepted'].includes(assignment.status)) {
    throw httpError(409, `Cannot log from a ${assignment.status} assignment.`);
  }
  const plan = assignment.plan;
  const meal = (plan.meals || []).find((m) => m.id === mealId);
  if (!meal) throw httpError(404, 'Meal not found in this plan.');

  const logged = loggedAt ? new Date(loggedAt) : new Date();
  if (!Number.isFinite(logged.getTime()) || logged.getTime() > Date.now() + 300000) {
    throw httpError(400, 'Invalid loggedAt');
  }

  const overrides = new Map();
  if (items != null) {
    if (!Array.isArray(items)) throw httpError(400, 'Invalid items');
    for (const o of items) {
      if (!o || typeof o.itemId !== 'string') throw httpError(400, 'Invalid item override');
      overrides.set(o.itemId, o);
    }
    for (const id of overrides.keys()) {
      if (!meal.items.some((i) => i.id === id)) throw httpError(400, `Item ${id} not in meal`);
    }
  }
  const selected = overrides.size ? meal.items.filter((i) => overrides.has(i.id)) : meal.items;
  if (!selected.length) throw httpError(400, 'No meal items to log.');

  const refs = await loadItemRefs(plan, tx);
  const needInput = [];
  const rows = [];
  for (const item of selected) {
    const o = overrides.get(item.id) || {};
    const quantityG = o.quantityG != null ? cleanQuantity(o.quantityG) : item.quantityG;
    const name = itemDisplayName(item, refs);
    let nutrition = null;
    let calculated = null;
    if (item.ingredientId) {
      const ingredient = refs.ingredients.get(item.ingredientId);
      if (ingredient && !(ingredient.catalog && !ingredient.catalog.usable)) {
        calculated = nutritionMath.scale(nutritionMath.fromIngredient(ingredient), quantityG);
      }
    } else if (item.recipeId) {
      const recipe = refs.recipes.get(item.recipeId);
      if (recipe && recipe.portionG > 0) {
        const totals = { calories: recipe.calories, proteinG: recipe.proteinG, carbsG: recipe.carbsG, fatG: recipe.fatG, fiberG: recipe.fiberG };
        try { calculated = nutritionMath.scale(totals, (quantityG * 100) / recipe.portionG); } catch (err) { /* needs override */ }
      }
    }
    // Explicit overrides win over computed values (same edit semantics as /food-logs).
    nutrition = {};
    for (const k of ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG']) {
      nutrition[k] = o[k] != null ? Number(o[k]) : (calculated ? calculated[k] : null);
      if (nutrition[k] != null && (!Number.isFinite(nutrition[k]) || nutrition[k] < 0 || nutrition[k] > 100000)) {
        throw httpError(400, `Invalid ${k} override`);
      }
    }
    if (['calories', 'proteinG', 'carbsG', 'fatG'].some((k) => nutrition[k] == null)) {
      needInput.push({ itemId: item.id, item: name });
      continue;
    }
    rows.push({
      id: crypto.randomUUID(),
      userId: clientUserId,
      foodName: name.slice(0, 300),
      mealType: meal.mealType,
      quantityG,
      calories: nutrition.calories,
      proteinG: nutrition.proteinG,
      carbsG: nutrition.carbsG,
      fatG: nutrition.fatG,
      fiberG: nutrition.fiberG,
      ingredientId: item.ingredientId || null,
      nutritionSnapshot: {
        loggedSource: 'trainer_plan',
        source: 'trainer_plan',
        trainerPlanId: plan.id,
        trainerPlanVersion: plan.version,
        trainerMealId: meal.id,
        trainerItemId: item.id,
        grams: quantityG,
        loggedFoodName: name,
        calculated: calculated || null,
      },
      loggedAt: logged,
    });
  }
  if (needInput.length) {
    const err = httpError(400, 'Some items have no resolvable nutrition — supply calories/proteinG/carbsG/fatG overrides or omit them.');
    err.body = { error: err.message, items: needInput };
    throw err;
  }
  const logs = [];
  for (const data of rows) logs.push(await tx.foodLog.create({ data }));
  return logs;
}

// ---------------------------------------------------------------------------
// Lists / detail / progress
// ---------------------------------------------------------------------------

async function listTrainerPlans(trainerUserId, { status } = {}) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(trainerUserId);
  const where = { trainerId: trainer.id };
  if (status) {
    if (!['draft', 'published', 'archived'].includes(status)) throw httpError(400, 'Invalid status filter');
    where.status = status;
  }
  const plans = await prisma.trainerNutritionPlan.findMany({
    where,
    include: { _count: { select: { meals: true, assignments: true } }, targets: true },
    orderBy: { updatedAt: 'desc' },
  });
  return { disclaimer: DISCLAIMER, plans };
}

async function getTrainerPlan(trainerUserId, planId) {
  const prisma = getPrisma();
  const { plan } = await requireOwnedPlan(trainerUserId, planId, prisma);
  const nutrition = await attachNutrition(plan, prisma);
  const assignments = await prisma.trainerNutritionAssignment.findMany({
    where: { planId: plan.id },
    include: { feedback: true },
    orderBy: { assignedAt: 'desc' },
  });
  return { ...plan, meals: nutrition.meals, totals: nutrition.totals, partialTotals: nutrition.partialTotals, complete: nutrition.complete, assignments, disclaimer: DISCLAIMER };
}

async function listClientAssignments(clientUserId) {
  const prisma = getPrisma();
  const assignments = await prisma.trainerNutritionAssignment.findMany({
    where: { clientId: clientUserId },
    include: {
      plan: { select: { id: true, title: true, version: true, status: true, trainerId: true, updatedAt: true } },
    },
    orderBy: { assignedAt: 'desc' },
  });
  return { disclaimer: DISCLAIMER, assignments };
}

async function getClientAssignment(clientUserId, assignmentId) {
  const prisma = getPrisma();
  const assignment = await requireClientAssignment(clientUserId, assignmentId, prisma);
  const nutrition = await attachNutrition(assignment.plan, prisma);
  // The client reads their *own* allergy data — no consent gate on this side.
  const names = await loadClientAllergyNames(clientUserId, prisma);
  const allergyConflicts = await findAllergyConflicts(assignment.plan, names, prisma);
  return {
    ...assignment,
    plan: { ...assignment.plan, meals: nutrition.meals, totals: nutrition.totals, partialTotals: nutrition.partialTotals, complete: nutrition.complete },
    disclaimer: DISCLAIMER,
    allergyConflicts,
  };
}

/**
 * Trainer progress view for a client: assignment statuses plus a nutrition
 * logging summary — populated only when `nutrition_summaries` (or `food_logs`)
 * consent is granted on the relation.
 */
async function getClientProgress(trainerUserId, clientUserId) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(trainerUserId);
  const { relation } = await requireActiveRelation({ trainerId: trainer.id, clientUserId });
  const granted = await getGrantedCategories(relation.id);

  const assignments = await prisma.trainerNutritionAssignment.findMany({
    where: { clientId: clientUserId, plan: { trainerId: trainer.id } },
    include: { plan: { select: { id: true, title: true, version: true, status: true } }, feedback: true },
    orderBy: { assignedAt: 'desc' },
  });

  const result = {
    disclaimer: DISCLAIMER,
    relation: { id: relation.id, status: relation.status, startedAt: relation.startedAt },
    grantedCategories: [...granted],
    assignments: assignments.map((a) => ({
      id: a.id, status: a.status, assignedAt: a.assignedAt, respondedAt: a.respondedAt,
      plan: a.plan, feedbackCount: a.feedback.length,
      latestRating: a.feedback.length ? a.feedback[a.feedback.length - 1].rating : null,
    })),
  };

  if (granted.has('nutrition_summaries') || granted.has('food_logs')) {
    const since = new Date(Date.now() - 30 * 86400000);
    const logs = await prisma.foodLog.findMany({
      where: { userId: clientUserId, loggedAt: { gte: since } },
      select: { calories: true, proteinG: true, carbsG: true, fatG: true, fiberG: true, loggedAt: true, nutritionSnapshot: true },
      orderBy: { loggedAt: 'desc' },
    });
    const days = new Set(logs.map((l) => l.loggedAt.toISOString().slice(0, 10)));
    const sum = (k) => Math.round(logs.reduce((s, l) => s + (l[k] || 0), 0) * 100) / 100;
    result.nutritionSummary = {
      windowDays: 30,
      daysLogged: days.size,
      totalLogs: logs.length,
      trainerPlanLogs: logs.filter((l) => l.nutritionSnapshot && l.nutritionSnapshot.source === 'trainer_plan').length,
      totals: { calories: sum('calories'), proteinG: sum('proteinG'), carbsG: sum('carbsG'), fatG: sum('fatG'), fiberG: sum('fiberG') },
    };
  }
  return result;
}

module.exports = {
  DISCLAIMER,
  createDraft,
  updateDraft,
  publishPlan,
  revisePlan,
  archivePlan,
  previewPlan,
  assignPlan,
  respondToAssignment,
  addFeedback,
  logAssignmentMeal,
  listTrainerPlans,
  getTrainerPlan,
  listClientAssignments,
  getClientAssignment,
  getClientProgress,
};
