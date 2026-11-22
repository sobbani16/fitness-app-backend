// Normalized User Constraint Engine (Phase 1)
//
// Single authoritative object that merges server-side user records with
// request-level overrides. Every recipe surface (match, generate, customize,
// suggest) consumes THIS object instead of trusting client JSON.
//
// Rules:
//   - Server records are authoritative. Request params may NARROW the result
//     set (extra exclusions, extra allergies, fewer appliances) but can never
//     widen it — a client cannot remove a saved allergy or restriction.
//   - Constraint classes stay distinct: medical / allergy / intolerance /
//     pattern / dislike / limit / soft / equipment / availability / unknown.
//   - Unresolved information is recorded in `unknown` — never treated as safe.
//   - Only APPROVED clinical rules produce blocked attributes; DRAFT rules are
//     inert (same posture as mealSuggestion/foodIntel/conditionEvaluation).

const { getPrisma } = require('../../lib/prisma');
const { normalize } = require('../ingredientCsv');
const { keywordsFor, ALLERGEN_KEYWORDS } = require('../mealSuggestion');

const CONSTRAINTS_VERSION = 'recipe-constraints-v1';

// Animal-derived additives that appear on labels/compound ingredients rather
// than recipe titles — shared vocabulary (same list foodIntel uses).
const LABEL_ANIMAL_TERMS = ['gelatin', 'gelatine', 'lard', 'tallow', 'carmine', 'cochineal', 'isinglass', 'rennet'];

const MEAT_TERMS = ['chicken', 'beef', 'pork', 'lamb', 'mutton', 'turkey', 'bacon', 'ham', 'sausage', 'meat', 'fish', 'salmon', 'tuna', 'shrimp', 'prawn', 'crab'];
const FISH_TERMS = ['fish', 'salmon', 'tuna', 'cod', 'tilapia', 'sardine', 'anchovy', 'mackerel'];
const SHELLFISH_TERMS = ['shrimp', 'prawn', 'crab', 'lobster', 'shellfish', 'mussel', 'clam', 'oyster', 'scallop', 'squid'];
const DAIRY_TERMS = ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'whey', 'casein', 'dairy', 'ghee', 'paneer'];
const EGG_TERMS = ['egg', 'omelet', 'omelette', 'mayonnaise', 'mayo'];
const GLUTEN_TERMS = ['wheat', 'barley', 'rye', 'bread', 'pasta', 'flour', 'gluten', 'semolina', 'couscous', 'seitan', 'roti', 'naan'];
const NUT_TERMS = ['almond', 'walnut', 'cashew', 'pecan', 'pistachio', 'hazelnut', 'macadamia', 'nut'];
const SOY_TERMS = ['soy', 'soya', 'tofu', 'edamame', 'tempeh'];
const PORK_TERMS = ['pork', 'lard', 'bacon', 'ham', 'pancetta', 'prosciutto', 'chorizo', 'pepperoni'];
const ALCOHOL_TERMS = ['alcohol', 'wine', 'beer', 'rum', 'vodka', 'whiskey', 'brandy', 'liqueur'];

// Canonical restriction vocabulary (underscore form). Each maps to mechanism
// sets consumed by validators: text terms (ingredient/recipe text), banned
// catalog categories, banned nutritionSource.tags, banned IngredientAttribute
// values. `unverifiable` flags restrictions we can partially enforce but can
// never fully certify — surfaces must label these, never claim compliance.
const RESTRICTIONS = {
  vegetarian:   { terms: [...MEAT_TERMS, ...LABEL_ANIMAL_TERMS], categories: ['animal protein', 'seafood'], tags: ['meat', 'fish', 'shellfish'] },
  eggetarian:   { terms: [...MEAT_TERMS, ...LABEL_ANIMAL_TERMS], categories: ['animal protein', 'seafood'], tags: ['meat', 'fish', 'shellfish'] },
  vegan:        { terms: [...MEAT_TERMS, 'milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'ghee', 'paneer', 'egg', 'honey', 'whey', 'casein', ...LABEL_ANIMAL_TERMS], categories: ['animal protein', 'seafood', 'dairy', 'eggs'], tags: ['animal', 'milk', 'egg'] },
  pescatarian:  { terms: MEAT_TERMS.filter(t => !['fish', 'salmon', 'tuna', 'shrimp', 'prawn', 'crab'].includes(t)), categories: ['animal protein'], tags: ['meat'] },
  gluten_free:  { terms: GLUTEN_TERMS, tags: ['gluten'], attributes: ['CONTAINS_GLUTEN'] },
  dairy_free:   { terms: DAIRY_TERMS, categories: ['dairy'], tags: ['milk'] },
  nut_free:     { terms: NUT_TERMS, categories: ['nuts'], tags: ['nuts'], attributes: ['NUT'] },
  peanut_free:  { terms: ['peanut', 'groundnut'], tags: ['peanuts'], attributes: ['PEANUT'] },
  egg_free:     { terms: EGG_TERMS, categories: ['eggs'], tags: ['egg'] },
  soy_free:     { terms: SOY_TERMS, tags: ['soy'] },
  fish_free:    { terms: FISH_TERMS, categories: ['seafood'], tags: ['fish'] },
  shellfish_free: { terms: SHELLFISH_TERMS, tags: ['shellfish'] },
  low_carb:     { terms: ['sugar', 'bread', 'pasta', 'rice', 'potato', 'noodle'], tags: [] },
  // Religious/ethical patterns: partial enforcement + explicit unverifiable
  // marker. We never claim certification — composition/sourcing/slaughter
  // method are outside our data.
  halal:  { terms: [...PORK_TERMS, ...ALCOHOL_TERMS, ...LABEL_ANIMAL_TERMS], unverifiable: ['slaughter method', 'certification', 'cross-contact'] },
  kosher: { terms: [...PORK_TERMS, ...SHELLFISH_TERMS, ...LABEL_ANIMAL_TERMS], unverifiable: ['certification', 'meat/dairy separation', 'utensil status'] },
  jain:   { terms: [...MEAT_TERMS, 'egg', 'onion', 'garlic', 'potato', 'honey', ...LABEL_ANIMAL_TERMS], categories: ['animal protein', 'seafood', 'eggs'], unverifiable: ['root-vegetable completeness', 'preparation'] },
};
const CANONICAL_RESTRICTIONS = new Set(Object.keys(RESTRICTIONS));

function canonRestriction(r) {
  const k = String(r || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return k;
}

// Singular/plural tolerant membership check. `set` holds normalized terms;
// variants cover peanut/peanuts, nut/nuts without stemming false-positives
// (we only try +s/-s, never substring stemming of other words).
function hasTerm(set, term) {
  const t = normalize(term);
  if (!t) return false;
  if (set.has(t)) return true;
  if (t.endsWith('s') && set.has(t.slice(0, -1))) return true;
  if (set.has(`${t}s`)) return true;
  return false;
}

function variantSet(terms) {
  const s = new Set();
  for (const t of terms) {
    const n = normalize(t);
    if (!n) continue;
    s.add(n);
    if (n.endsWith('s') && !n.endsWith('ss')) s.add(n.slice(0, -1));
    else s.add(`${n}s`);
  }
  return s;
}

// Word/phrase-boundary text matching with optional trailing plural 's' on the
// final word. 'egg' matches 'egg'/'eggs' but not 'eggplant'; 'nut' doesn't
// match 'walnut'/'coconut' (specific nuts are listed separately); 'peanut'
// matches 'peanut butter'. Multi-word terms match as phrases.
const _termReCache = new Map();
function textHasTerm(text, term) {
  const t = normalize(term);
  if (!t) return false;
  let re = _termReCache.get(t);
  if (!re) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(?:^|[^a-z0-9])${esc}s?(?:[^a-z0-9]|$)`, 'i');
    if (_termReCache.size > 500) _termReCache.delete(_termReCache.keys().next().value);
    _termReCache.set(t, re);
  }
  return re.test(String(text || ''));
}

/**
 * Load the normalized constraint object for a user.
 *
 * @param {string} userId
 * @param {object} [request] — permitted request-level narrowing:
 *   { allergies:[], diet:[], restrictions:[], exclusions:[], equipment:[],
 *     cuisine, maxPrepMinutes, servings }
 * @returns {Promise<NormalizedConstraints>}
 */
async function loadConstraints(userId, request = {}) {
  const prisma = getPrisma();
  const [allergies, userConditions, prefs, planning, inventory, macroGoal] = await Promise.all([
    prisma.userAllergy.findMany({ where: { userId }, include: { allergy: true } }).catch(() => []),
    prisma.userHealthCondition.findMany({
      where: { userId, active: true },
      include: { condition: { include: { conditionRules: { where: { reviewStatus: 'APPROVED' } } } } },
    }).catch(() => []),
    prisma.foodPreference.findMany({ where: { userId } }).catch(() => []),
    prisma.userPlanningPreferences.findUnique({ where: { userId } }).catch(() => null),
    prisma.foodInventory.findMany({ where: { userId } }).catch(() => []),
    prisma.macroGoal.findUnique({ where: { userId } }).catch(() => null),
  ]);

  // ---- allergies ----------------------------------------------------------
  // Server allergy names expand through the canonical keyword map
  // (peanut → peanut/groundnut…); request allergies are unioned — narrowing only.
  const allergenSources = [
    ...allergies.map(a => ({ name: a.allergy?.name, source: 'profile' })).filter(a => a.name),
    ...(Array.isArray(request.allergies) ? request.allergies : []).map(n => ({ name: n, source: 'request' })),
  ];
  const allergenTerms = new Set();
  for (const a of allergenSources) for (const w of keywordsFor(a.name)) allergenTerms.add(normalize(w));

  // ---- medical conditions (APPROVED rules only) ---------------------------
  const medicalConditions = [];
  const blockedAttributes = new Set();
  const warnRules = [];
  for (const uc of userConditions) {
    const cond = uc.condition;
    if (!cond) continue;
    const rules = (cond.conditionRules || []).map(r => ({
      id: r.id, code: r.ruleCode || null, attribute: r.attribute, target: r.target,
      action: r.clinicalAction || r.action, severity: r.clinicalSeverity || null,
      reason: r.reason || null, version: r.version || null,
    }));
    medicalConditions.push({ id: cond.id, name: cond.name, severity: uc.severity || null, kind: classifyCondition(cond.name), rules });
    for (const r of rules) {
      if (r.target === 'ingredient' && r.action === 'block' && r.attribute) blockedAttributes.add(r.attribute);
      else if (r.attribute) warnRules.push({ attribute: r.attribute, action: r.action, reason: r.reason, conditionName: cond.name });
    }
  }

  // ---- exclusions + dietary patterns --------------------------------------
  const excludeTerms = new Set();
  const bannedCategories = new Set();
  const bannedTags = new Set();
  const bannedAttributes = new Set();
  const patterns = [];
  const unverifiable = [];

  for (const p of prefs) {
    const n = normalize(p.foodName);
    if (!n) continue;
    if (p.preference === 'NEVER_RECOMMEND') excludeTerms.add(n);
  }

  const savedRestrictions = Array.isArray(planning?.dietaryRestrictions) ? planning.dietaryRestrictions : [];
  const requestRestrictions = [
    ...(Array.isArray(request.diet) ? request.diet : []),
    ...(Array.isArray(request.restrictions) ? request.restrictions : []),
  ];
  for (const [raw, source] of [
    ...savedRestrictions.map(r => [r, 'profile']),
    ...requestRestrictions.map(r => [r, 'request']),
  ]) {
    const key = canonRestriction(raw);
    if (key.startsWith('exclude_') || key.startsWith('exclude:')) {
      const term = normalize(key.replace(/^exclude[_:]/, '').replace(/_/g, ' '));
      if (term) excludeTerms.add(term);
      patterns.push({ key, kind: 'exclude', source });
      continue;
    }
    if (key.startsWith('cuisine_') || key.startsWith('cuisine:')) continue; // soft preference, not exclusion
    const mech = RESTRICTIONS[key];
    if (!mech) {
      // Unknown restrictions are recorded — never silently ignored (the old
      // planningPolicy recipeAllowed already refuses unknown saved values).
      unverifiable.push({ key, reason: 'unsupported restriction — enforced as literal name match only' });
      const literal = normalize(String(raw).replace(/[_-]+/g, ' '));
      if (literal) excludeTerms.add(literal);
      patterns.push({ key, kind: 'unknown', source });
      continue;
    }
    for (const t of mech.terms || []) excludeTerms.add(t);
    for (const c of mech.categories || []) bannedCategories.add(normalize(c));
    for (const t of mech.tags || []) bannedTags.add(normalize(t));
    for (const a of mech.attributes || []) bannedAttributes.add(a);
    for (const u of mech.unverifiable || []) unverifiable.push({ key, reason: `cannot verify ${u}` });
    patterns.push({ key, kind: 'pattern', source });
  }
  for (const t of Array.isArray(request.exclusions) ? request.exclusions : []) {
    const n = normalize(t);
    if (n) excludeTerms.add(n);
  }

  const soft = {
    dislikes: prefs.filter(p => p.preference === 'DISLIKE').map(p => normalize(p.foodName)).filter(Boolean),
    likes: prefs.filter(p => ['LOVE', 'LIKE'].includes(p.preference)).map(p => ({ name: normalize(p.foodName), love: p.preference === 'LOVE' })),
    cuisines: savedRestrictions.filter(r => String(r).toLowerCase().startsWith('cuisine:')).map(r => String(r).slice(8)),
    budgetLevel: planning?.budgetLevel || null,
    cookingSkill: planning?.cookingSkill || null,
    householdSize: planning?.householdSize || null,
    mealPrepStyle: planning?.mealPrepStyle || null,
  };

  // Equipment: request may narrow to a subset of owned gear (can't conjure
  // appliances) — but a request list is also accepted as the current-truth
  // narrowing for profiles that predate the field.
  const profileEquipment = Array.isArray(planning?.availableEquipment) ? planning.availableEquipment : [];
  const requestEquipment = Array.isArray(request.equipment) ? request.equipment.map(normalize) : null;
  const equipment = requestEquipment && requestEquipment.length ? requestEquipment : profileEquipment;

  const limits = macroGoal ? {
    caloriesTarget: macroGoal.caloriesTarget, proteinTarget: macroGoal.proteinTarget,
    carbsTarget: macroGoal.carbsTarget, fatTarget: macroGoal.fatTarget,
    fiberTarget: macroGoal.fiberTarget, source: `macro_goal:${macroGoal.source || 'default'}`,
  } : null;

  const availability = {
    items: inventory.map(i => ({ name: normalize(i.foodName), quantityG: i.quantityG ?? null, expiresAt: i.expirationDate || null })),
  };

  const unknown = [];
  if (!planning) unknown.push({ field: 'planningPreferences', reason: 'no saved preferences — equipment/restriction filters limited' });
  if (!macroGoal) unknown.push({ field: 'macroGoal', reason: 'no targets — nutritional fit uses portion sanity only' });
  unknown.push(...unverifiable);

  const hard = {
    allergenTerms,
    excludeTerms,
    bannedCategories,
    bannedTags,
    bannedAttributes: new Set([...bannedAttributes, ...blockedAttributes]),
    patterns,
    medicalConditions,
    warnRules,
  };

  return {
    version: CONSTRAINTS_VERSION,
    userId,
    generatedAt: new Date().toISOString(),
    hard,
    soft,
    limits,
    equipment,
    availability,
    unknown,
    request: {
      cuisine: request.cuisine || null,
      maxPrepMinutes: Number.isFinite(Number(request.maxPrepMinutes)) ? Number(request.maxPrepMinutes) : null,
      servings: Number.isFinite(Number(request.servings)) ? Number(request.servings) : null,
    },
    provenance: {
      sources: ['userAllergy', 'userHealthCondition+conditionRule(APPROVED)', 'foodPreference', 'userPlanningPreferences', 'foodInventory', 'macroGoal'],
      narrowingOnly: true,
    },
  };
}

function classifyCondition(name) {
  const n = normalize(name);
  if (/intolerance|sensitivity|malabsorption/.test(n)) return 'intolerance';
  if (/allergy|allergic/.test(n)) return 'allergy_like';
  return 'condition';
}

/**
 * Does a resolved ingredient/recipe violate hard constraints?
 * Shared checker so match/customize/generate apply identical semantics.
 *
 * @param {object} hard — constraints.hard
 * @param {object} subject — { text, allergens[], category, tags[], attributes[] }
 * @returns {null | {ruleId: string, severity:'block', reason: string}}
 */
function violatesHard(hard, subject) {
  const text = subject.text || '';
  for (const t of hard.allergenTerms) {
    if (t && textHasTerm(text, t)) return { ruleId: 'ALLERGEN_TEXT', severity: 'block', reason: `contains allergen-related ingredient "${t}"` };
  }
  for (const a of subject.allergens || []) {
    if (hasTerm(hard.allergenTerms, a)) return { ruleId: 'ALLERGEN_DECLARED', severity: 'block', reason: `declared allergen "${normalize(a)}" matches user allergy` };
  }
  for (const t of hard.excludeTerms) {
    if (t && textHasTerm(text, t)) return { ruleId: 'EXCLUDED_TERM', severity: 'block', reason: `contains excluded item "${t}"` };
  }
  if (subject.category && hasTerm(hard.bannedCategories, subject.category)) {
    return { ruleId: 'BANNED_CATEGORY', severity: 'block', reason: `category "${subject.category}" conflicts with dietary pattern` };
  }
  for (const t of subject.tags || []) {
    if (hasTerm(hard.bannedTags, t)) return { ruleId: 'BANNED_TAG', severity: 'block', reason: `tag "${normalize(t)}" conflicts with dietary pattern` };
  }
  for (const a of subject.attributes || []) {
    if (hard.bannedAttributes.has(a)) return { ruleId: 'CONDITION_ATTR', severity: 'block', reason: `ingredient attribute "${a}" blocked by a health-condition rule` };
  }
  return null;
}

module.exports = {
  CONSTRAINTS_VERSION,
  loadConstraints,
  violatesHard,
  hasTerm,
  textHasTerm,
  variantSet,
  canonRestriction,
  RESTRICTIONS,
  CANONICAL_RESTRICTIONS,
  LABEL_ANIMAL_TERMS,
};
