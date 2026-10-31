// AI weekly meal-plan generation — deterministic safety gate around askJSON.
// The AI proposes dish names, ingredient grams, and estimated macros; this
// module validates structure, numeric sanity, and — critically — every saved
// dietary restriction, exclusion, and allergy against the declared ingredient
// list before a meal can reach the plan. AI output is never trusted directly.

const { askJSON } = require('../aiProvider');
const { httpError } = require('../../lib/errors');
const { assessMeals } = require('./planningPolicy');
const { nutrients } = require('./catalog');

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];
const SHARES = { breakfast: 0.25, lunch: 0.30, dinner: 0.30, snack: 0.15 };

// Keyword families used to verify AI-proposed meals against saved filters.
// Text matching is a best-effort screen, not proof of allergen-free food —
// the UI must keep saying so.
const BANNED_TERMS = {
  vegetarian: ['chicken', 'mutton', 'goat', 'lamb', 'beef', 'pork', 'bacon', 'ham', 'turkey', 'duck', 'fish', 'prawn', 'shrimp', 'crab', 'anchovy', 'tuna', 'salmon', 'meat', 'gelatin', 'lard'],
  vegan: ['chicken', 'mutton', 'goat', 'lamb', 'beef', 'pork', 'bacon', 'ham', 'turkey', 'duck', 'fish', 'prawn', 'shrimp', 'crab', 'anchovy', 'tuna', 'salmon', 'meat', 'gelatin', 'lard', 'milk', 'curd', 'yogurt', 'yoghurt', 'cheese', 'paneer', 'butter', 'ghee', 'cream', 'whey', 'casein', 'egg', 'honey'],
  'dairy-free': ['milk', 'curd', 'yogurt', 'yoghurt', 'cheese', 'paneer', 'butter', 'ghee', 'cream', 'whey', 'casein', 'lactose'],
  'egg-free': ['egg', 'mayonnaise'],
  'soy-free': ['soy', 'soya', 'tofu', 'edamame', 'tempeh'],
  'gluten-free': ['wheat', 'barley', 'rye', 'maida', 'semolina', 'sooji', 'rava', 'bread', 'pasta', 'noodle', 'couscous', 'seitan', 'farro', 'bulgur', 'malt', 'flour', 'roti', 'naan', 'paratha', 'chapati', 'pasta'],
  'nut-free': ['almond', 'cashew', 'walnut', 'pistachio', 'hazelnut', 'pecan', 'macadamia', 'brazil nut', 'nut ', ' nuts'],
  'peanut-free': ['peanut', 'groundnut'],
  'fish-free': ['fish', 'prawn', 'shrimp', 'crab', 'anchovy', 'tuna', 'salmon', 'sardine', 'mackerel', 'cod', 'tilapia', 'surmai', 'pomfret'],
  'shellfish-free': ['prawn', 'shrimp', 'crab', 'lobster', 'oyster', 'mussel', 'clam', 'scallop', 'squid', 'calamari', 'octopus'],
};
const ALLERGY_TERMS = {
  peanut: ['peanut', 'groundnut'], tree_nut: ['almond', 'cashew', 'walnut', 'pistachio', 'hazelnut', 'pecan', 'macadamia'],
  milk: ['milk', 'curd', 'yogurt', 'yoghurt', 'cheese', 'paneer', 'butter', 'ghee', 'cream', 'whey', 'casein', 'lactose'],
  egg: ['egg', 'mayonnaise'], soy: ['soy', 'soya', 'tofu', 'edamame', 'tempeh'],
  wheat: ['wheat', 'maida', 'semolina', 'sooji', 'rava', 'flour', 'bread', 'roti', 'naan', 'paratha', 'chapati'],
  fish: ['fish', 'prawn', 'shrimp', 'crab', 'anchovy', 'tuna', 'salmon', 'sardine', 'mackerel', 'cod', 'tilapia'],
  shellfish: ['prawn', 'shrimp', 'crab', 'lobster', 'oyster', 'mussel', 'clam', 'scallop', 'squid', 'calamari'],
  gluten: BANNED_TERMS['gluten-free'],
};

const num = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;

// Approved nutrient rules can only be enforced on macros the plan actually
// carries. Anything else (sodium, potassium…) stays "unverified" — flagged in
// generationDetails, never treated as compliant.
const MACRO_FIELDS = {
  protein: 'proteinG', 'protein, total': 'proteinG',
  carbohydrate: 'carbsG', 'carbohydrate, by difference': 'carbsG', carbs: 'carbsG',
  fat: 'fatG', 'total fat': 'fatG', 'total lipid (fat)': 'fatG',
  fiber: 'fiberG', 'dietary fiber': 'fiberG', 'fiber, total dietary': 'fiberG',
  energy: 'calories', 'energy, kcal': 'calories', calories: 'calories',
};
function nutrientField(rule) {
  const key = String(rule.nutrient?.code || rule.nutrient?.name || '').toLowerCase().replace(/_/g, ' ');
  return MACRO_FIELDS[key] || null;
}
function comparableLimit(rule, field) {
  const v = Number(rule.thresholdValue);
  if (!Number.isFinite(v) || v < 0) return null;
  const u = String(rule.thresholdUnit || rule.nutrient?.unit || '').toLowerCase();
  if (field === 'calories') return u === 'kcal' ? v : u === 'kj' ? v / 4.184 : null;
  if (u === 'g') return v; if (u === 'mg') return v / 1000; if (u === 'µg' || u === 'mcg' || u === 'ug') return v / 1e6;
  return null;
}
const fieldUnit = f => f === 'calories' ? 'kcal' : 'g';

// Health-condition layer: resolved ingredient attributes vs block/warn rules,
// plus enforceable nutrient thresholds. An ingredient that cannot be resolved
// while block rules are active is unverifiable — the meal is dropped.
function conditionCheck(meal, ctx, resolved) {
  const violations = [], warnings = [], unverified = [];
  const rules = ctx.conditionRules || [];
  const hasBlock = rules.some(r => r.action === 'block');
  for (const ing of meal.ingredients) {
    const res = resolved.get(ing.name);
    if (!res) {
      if (hasBlock) violations.push(`unverifiable ingredient "${ing.name}" — cannot confirm safety under active condition rules`);
      continue;
    }
    for (const rule of rules) if (res.attributes.includes(rule.attribute)) {
      const msg = `${rule.conditionName}: ${rule.reason || rule.attribute} on "${ing.name}"`;
      (rule.action === 'block' ? violations : warnings).push(msg);
    }
  }
  for (const rule of ctx.nutrientRules || []) {
    if (!['LIMIT', 'AVOID_IF_INDICATED'].includes(rule.action)) continue;
    const field = nutrientField(rule);
    const label = rule.nutrient?.name || rule.nutrient?.code || 'nutrient';
    if (!field || rule.thresholdBasis === 'OTHER') { unverified.push(`${rule.conditionName}: "${label}" ${rule.action.toLowerCase()} rule cannot be verified — AI meals do not estimate it`); continue; }
    const limit = comparableLimit(rule, field);
    if (limit == null) { unverified.push(`${rule.conditionName}: "${label}" limit has an unsupported unit`); continue; }
    if (rule.thresholdBasis === 'DAILY') continue; // enforced on day totals below
    if (meal[field] > limit) {
      const msg = `${rule.conditionName}: est. ${label.toLowerCase()} ${meal[field]}${fieldUnit(field)} exceeds ${Math.round(limit * 100) / 100}${fieldUnit(field)} per serving`;
      (rule.severity === 'HIGH' ? violations : warnings).push(msg);
    }
  }
  return { violations, warnings, unverified };
}

// Normalize + bound-check one AI meal record. Returns null when unusable.
function normalizeMeal(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const mealType = String(raw.mealType || '').toLowerCase();
  if (!MEAL_TYPES.includes(mealType)) return null;
  const foodName = String(raw.foodName || '').trim();
  if (!foodName || foodName.length > 120) return null;
  const dayOfWeek = Number.isInteger(raw.dayOfWeek) ? raw.dayOfWeek : index;
  if (dayOfWeek < 0 || dayOfWeek > 6) return null;
  const out = {
    dayOfWeek, mealType, foodName,
    portionG: Math.round(raw.portionG * 10) / 10,
    calories: Math.round(raw.calories * 10) / 10,
    proteinG: Math.round(raw.proteinG * 10) / 10,
    carbsG: Math.round(raw.carbsG * 10) / 10,
    fatG: Math.round(raw.fatG * 10) / 10,
    fiberG: Math.round(raw.fiberG * 10) / 10,
    ingredients: Array.isArray(raw.ingredients)
      ? raw.ingredients.filter(i => i && typeof i.name === 'string' && i.name.trim() && i.name.length <= 80 && num(i.grams, 0, 2000))
        .slice(0, 12).map(i => ({ name: i.name.trim().toLowerCase(), grams: Math.round(i.grams) }))
      : [],
    prepNote: typeof raw.prepNote === 'string' && raw.prepNote.length <= 160 ? raw.prepNote.trim() : undefined,
  };
  if (!num(out.portionG, 30, 1500) || !num(out.calories, 50, 1500)) return null;
  for (const k of nutrients.slice(1)) if (!num(out[k], 0, 300)) return null;
  // Estimated calories must roughly agree with estimated macros.
  const macroKcal = out.proteinG * 4 + out.carbsG * 4 + out.fatG * 9;
  if (macroKcal > 0 && Math.abs(macroKcal - out.calories) / out.calories > 0.4) return null;
  return out;
}

// Every hard filter re-checks declared ingredients + dish name. Anything the
// AI was told to avoid but used anyway is dropped before it can be shown.
function mealViolations(meal, ctx) {
  const text = ` ${meal.foodName} ${meal.ingredients.map(i => i.name).join(' ')} `.toLowerCase().replace(/[_-]/g, ' ');
  const hits = terms => terms.filter(t => text.includes(` ${t}`) || text.includes(`${t} `) || text.includes(` ${t} `) || (t.includes(' ') && text.includes(t)));
  const violations = [];
  for (const r of ctx.restrictions) {
    if (r.startsWith('exclude:')) {
      const term = r.slice(8).trim();
      if (term && hits([term]).length) violations.push(`excluded ingredient: ${term}`);
    } else if (BANNED_TERMS[r]) {
      const hit = hits(BANNED_TERMS[r]);
      if (hit.length) violations.push(`${r}: matched "${hit[0].trim()}"`);
    }
  }
  for (const allergy of ctx.allergies) {
    const key = String(allergy).toLowerCase().replace(/[^a-z]/g, '_');
    const terms = ALLERGY_TERMS[key] || [String(allergy).toLowerCase()];
    const hit = hits(terms);
    if (hit.length) violations.push(`allergy ${allergy}: matched "${hit[0].trim()}"`);
  }
  const disliked = ctx.dislikedFoods.filter(d => hits([d.toLowerCase()]).length);
  if (disliked.length) violations.push(`disliked food: ${disliked[0]}`);
  return violations;
}

function buildPrompt(ctx) {
  const avoid = [...ctx.restrictions.filter(r => r.startsWith('exclude:')).map(r => r.slice(8)),
    ...ctx.restrictions.filter(r => !r.startsWith('exclude:') && !r.startsWith('cuisine:')).map(r => `anything incompatible with "${r}"`),
    ...ctx.allergies.map(a => `allergen: ${a}`)].join('; ') || 'none';
  const likes = ctx.likedFoods.length ? `Prefer including: ${ctx.likedFoods.join(', ')}.` : '';
  const dislikes = ctx.dislikedFoods.length ? `Avoid these foods too: ${ctx.dislikedFoods.join(', ')}.` : '';
  const cuisine = ctx.cuisines.length ? `Cuisine preference: ${ctx.cuisines.join(', ')}.` : 'Any everyday cuisine.';
  const equip = ctx.equipment.length ? `Only this equipment is available: ${ctx.equipment.join(', ')}.` : 'No equipment constraint.';
  return [
    `Plan 7 days of meals for one adult, exactly one ${MEAL_TYPES.join(' / ')} per day (28 meals total, dayOfWeek 0-6).`,
    `Daily totals must approximate per-person targets: ${ctx.caloriesTarget} kcal, ${ctx.proteinTarget}g protein, ${ctx.carbsTarget}g carbs, ${ctx.fatTarget}g fat, ${ctx.fiberG || ctx.fiberTarget}g fiber. Meal shares roughly: breakfast 25%, lunch 30%, dinner 30%, snack 15% of calories.`,
    `HARD SAFETY RULE — never include, even as a minor ingredient or garnish: ${avoid}. Declaring an ingredient that violates this rule makes the entire plan unsafe.`,
    `${cuisine} ${equip} Preparation style: ${ctx.mealPrepStyle.replaceAll('_', ' ')}. ${likes} ${dislikes}`,
    `Use realistic dish names (e.g. "chicken curry", "vegetable pulav"). For each meal list actual ingredients with grams per serving (weighed edible portions). calories/proteinG/carbsG/fatG/fiberG are your best per-serving estimates — they must be consistent with the listed ingredients.`,
    'Vary dishes across days; no identical meal twice in a week.',
  ].join('\n');
}

const INSTRUCTIONS = 'You are a meal-planning assistant producing structured weekly meal plans as JSON. Rules listed in the request are binding; safety exclusions are absolute and apply to all ingredients, sauces, and garnishes. Values are honest estimates, never fabricated precision.';

async function requestPlan(ctx, extraNote = '') {
  const properties = {
    days: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          dayOfWeek: { type: 'integer' }, mealType: { type: 'string' }, foodName: { type: 'string' },
          portionG: { type: 'number' }, calories: { type: 'number' }, proteinG: { type: 'number' },
          carbsG: { type: 'number' }, fatG: { type: 'number' }, fiberG: { type: 'number' },
          ingredients: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, grams: { type: 'number' } }, required: ['name', 'grams'] } },
          prepNote: { type: 'string' },
        },
        required: ['dayOfWeek', 'mealType', 'foodName', 'portionG', 'calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'ingredients', 'prepNote'],
      },
    },
  };
  const raw = await askJSON('weekly_meal_plan', properties, INSTRUCTIONS, buildPrompt(ctx) + extraNote, null, ctx.userId, { maxOutputTokens: 6000 });
  return Array.isArray(raw?.days) ? raw.days : null;
}

async function generateAiWeeklyMeals(ctx) {
  const dropped = [];
  const notes = [];
  const mealWarnings = [];
  const unverified = [];
  const resolve = ctx.resolveIngredients || (async () => new Map());

  // Hard-filter pass: saved filters first, then the health-condition layer
  // (ingredient attributes resolved against the verified catalog). On any
  // violation the dish is dropped — AI output is never trusted directly.
  const check = async list => {
    const names = [...new Set(list.flatMap(m => m.ingredients.map(i => i.name)))];
    const resolved = await resolve(names);
    const out = [];
    for (const m of list) {
      const c = conditionCheck(m, ctx, resolved);
      const all = [...mealViolations(m, ctx), ...c.violations];
      if (all.length) { dropped.push({ dayOfWeek: m.dayOfWeek, mealType: m.mealType, foodName: m.foodName, violations: all }); continue; }
      if (c.warnings.length) mealWarnings.push({ dayOfWeek: m.dayOfWeek, mealType: m.mealType, foodName: m.foodName, warnings: [...new Set(c.warnings)] });
      unverified.push(...c.unverified);
      out.push(m);
    }
    return out;
  };

  let meals = await check(((await requestPlan(ctx)) || []).map(normalizeMeal).filter(Boolean));
  if (dropped.length) {
    const names = [...new Set(dropped.map(d => d.foodName))].slice(0, 8).join(', ');
    const raw = await requestPlan(ctx, `\nYour previous suggestions ${names} violated the safety exclusions. Do not propose them or their key ingredients again.`);
    const filled = new Set(meals.map(m => `${m.dayOfWeek}:${m.mealType}`));
    // The retry proposes a full week; only let it fill slots left empty by filtering.
    meals = [...meals, ...(await check((raw || []).map(normalizeMeal).filter(Boolean))).filter(m => !filled.has(`${m.dayOfWeek}:${m.mealType}`))];
  }

  // Coverage: every day needs breakfast/lunch/dinner (snack optional).
  for (let day = 0; day < 7; day++) {
    const types = new Set(meals.filter(m => m.dayOfWeek === day).map(m => m.mealType));
    const missing = ['breakfast', 'lunch', 'dinner'].filter(t => !types.has(t));
    if (missing.length) throw httpError(422, `The AI plan could not be fully verified against your filters (day ${day + 1} missing ${missing.join(', ')}). No unverified meal is shown — relax a filter or try again.`);
  }
  // One meal per type per day; drop duplicates deterministically.
  const seen = new Set();
  meals = meals.filter(m => { const k = `${m.dayOfWeek}:${m.mealType}`; if (seen.has(k)) { dropped.push({ dayOfWeek: m.dayOfWeek, mealType: m.mealType, foodName: m.foodName, violations: ['duplicate slot'] }); return false; } seen.add(k); return true; })
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || MEAL_TYPES.indexOf(a.mealType) - MEAL_TYPES.indexOf(b.mealType));
  if (meals.length > 28) meals = meals.slice(0, 28);

  const dayAssessment = assessMeals(meals, ctx);
  // Approved DAILY nutrient limits apply to the sum of a day's meals.
  for (const rule of ctx.nutrientRules || []) {
    if (!['LIMIT', 'AVOID_IF_INDICATED'].includes(rule.action) || rule.thresholdBasis !== 'DAILY') continue;
    const field = nutrientField(rule);
    const limit = field && comparableLimit(rule, field);
    if (!field || limit == null) continue;
    const label = rule.nutrient?.name || rule.nutrient?.code || 'nutrient';
    for (let d = 0; d < 7; d++) {
      const total = meals.filter(m => m.dayOfWeek === d).reduce((s, m) => s + m[field], 0);
      if (total > limit) dayAssessment[d].warnings.push(`${rule.conditionName}: est. ${label.toLowerCase()} ${Math.round(total * 10) / 10}${fieldUnit(field)} exceeds ${Math.round(limit * 100) / 100}${fieldUnit(field)}/day`);
    }
  }
  if (dayAssessment.some(d => d.warnings.length)) notes.push('Some days deviate from targets or condition guidance; gaps are flagged per day.');
  if ([...new Set(unverified)].length) notes.push('Some condition guidance could not be verified on estimated nutrients — treat flagged meals with extra care.');
  return { meals, meta: { dropped, notes: [...notes, ...new Set(unverified)], dayAssessment, mealWarnings } };
}

module.exports = { generateAiWeeklyMeals, mealViolations, normalizeMeal, conditionCheck, BANNED_TERMS };
