// What Should I Eat Now — rule-based meal suggestions with hard eligibility.
//
// Pipeline (order matters, never bypassed):
//   1. resolve local meal occasion (user timezone)
//   2. load context: goals/targets, preferences, restrictions, history, plan
//   3. HARD filters — allergies, NEVER_RECOMMEND foods, dietary restrictions.
//      Ranking, energy context, and any future AI re-rank can NEVER override
//      these; ineligible recipes are removed before scoring.
//   4. rank eligible recipes by occasion fit, preference, familiarity, and
//      portion sanity (occasion share of the intake target — NOT "calories
//      left to fill"; an empty food log is not a deficit to force-feed)
//   5. return options with human-readable reasons
//
// Energy context is attached for display only. Suggestions do not scale to a
// provisional deficit, and nothing here prescribes compensation eating.
//
// LIMITATION: eligibility matches ingredient/recipe names to allergen and
// restriction keyword lists. It is deterministic and conservative, but it is
// not clinical advice — unknown ingredient lists can't be proven safe.

const { getUserEnergySummary } = require('./energySummary');

const OCCASION_WINDOWS = [
  { occasion: 'breakfast', from: 5, to: 10.5 },
  { occasion: 'lunch', from: 10.5, to: 15 },
  { occasion: 'snack', from: 15, to: 17.5 },
  { occasion: 'dinner', from: 17.5, to: 22.5 },
];
const OCCASION_TARGET_SHARE = { breakfast: 0.25, lunch: 0.3, snack: 0.12, dinner: 0.35 };

// Keyword expansions for allergen + restriction matching (lowercase substrings).
const ALLERGEN_KEYWORDS = {
  peanut: ['peanut', 'groundnut'],
  nuts: ['almond', 'walnut', 'cashew', 'pecan', 'pistachio', 'hazelnut', 'macadamia', 'nut'],
  tree_nuts: ['almond', 'walnut', 'cashew', 'pecan', 'pistachio', 'hazelnut', 'macadamia', 'nut'],
  dairy: ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'whey', 'casein', 'dairy', 'ghee', 'paneer'],
  milk: ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'whey', 'casein', 'dairy', 'ghee'],
  shellfish: ['shrimp', 'prawn', 'crab', 'lobster', 'shellfish', 'mussel', 'clam', 'oyster', 'scallop', 'squid'],
  fish: ['fish', 'salmon', 'tuna', 'cod', 'tilapia', 'sardine', 'anchovy', 'mackerel'],
  egg: ['egg', 'omelet', 'omelette', 'mayonnaise', 'mayo'],
  gluten: ['wheat', 'barley', 'rye', 'bread', 'pasta', 'flour', 'gluten', 'semolina', 'couscous', 'seitan', 'roti', 'naan'],
  wheat: ['wheat', 'bread', 'pasta', 'flour', 'semolina', 'couscous', 'roti', 'naan'],
  soy: ['soy', 'soya', 'tofu', 'edamame', 'tempeh'],
  sesame: ['sesame', 'tahini'],
};
const MEAT_KEYWORDS = ['chicken', 'beef', 'pork', 'lamb', 'mutton', 'turkey', 'bacon', 'ham', 'sausage', 'meat', 'fish', 'salmon', 'tuna', 'shrimp', 'prawn', 'crab'];
const NON_VEGAN_EXTRA = ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'ghee', 'paneer', 'egg', 'honey', 'whey'];
const RESTRICTION_KEYWORDS = {
  vegetarian: MEAT_KEYWORDS,
  vegan: [...MEAT_KEYWORDS, ...NON_VEGAN_EXTRA],
  gluten_free: ALLERGEN_KEYWORDS.gluten,
  dairy_free: ALLERGEN_KEYWORDS.dairy,
  nut_free: ALLERGEN_KEYWORDS.nuts,
  egg_free: ALLERGEN_KEYWORDS.egg,
  low_carb: ['sugar', 'bread', 'pasta', 'rice', 'potato', 'noodle'],
  pescatarian: MEAT_KEYWORDS.filter(k => !['fish', 'salmon', 'tuna', 'shrimp', 'prawn', 'crab'].includes(k)),
};

function localHour(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? now.getUTCHours());
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return h + m / 60;
}

function resolveOccasion(timeZone, now = new Date(), override) {
  if (override && OCCASION_WINDOWS.some(w => w.occasion === override)) return override;
  const h = localHour(timeZone, now);
  const win = OCCASION_WINDOWS.find(w => h >= w.from && h < w.to);
  return win ? win.occasion : 'snack';
}

// Expand a user-entered name like "peanuts", "tree nut", "dairy allergy" into
// keyword lists. Unknown names still match literally so custom allergies work.
function keywordsFor(name) {
  const n = String(name).toLowerCase().replace(/[\s-]+/g, '_');
  const hits = new Set([String(name).toLowerCase()]);
  for (const [key, words] of Object.entries(ALLERGEN_KEYWORDS)) {
    if (n.includes(key) || key.includes(n) || words.some(w => n.includes(w))) {
      for (const w of words) hits.add(w);
      hits.add(key.replace(/_/g, ' '));
    }
  }
  return [...hits];
}

function textOf(recipe) {
  const parts = [recipe.recipeName, recipe.description, recipe.cuisine,
    ...(recipe.ingredients || []).map(i => i.ingredientName)];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

async function getMealSuggestions(prisma, userId, { occasion, limit = 5, now = new Date(), timeZone } = {}) {
  const energy = await getUserEnergySummary(prisma, userId, { timeZone, now });
  if (!energy) return null;
  const tz = energy.timeZone;
  const occ = resolveOccasion(tz, now, occasion);

  const [allergies, prefs, planning, planItems, recentLogs, recipes, userConditions, ingredients] = await Promise.all([
    prisma.userAllergy.findMany({ where: { userId }, include: { allergy: true } }),
    prisma.foodPreference.findMany({ where: { userId } }),
    prisma.userPlanningPreferences.findUnique({ where: { userId } }).catch(() => null),
    prisma.mealPlanItem.findMany({
      where: { mealPlan: { clientId: userId, active: true }, mealType: occ },
      select: { foodName: true, calories: true, proteinG: true, quantityG: true, mealType: true },
      take: 20,
    }).catch(() => []),
    prisma.foodLog.findMany({
      where: { userId, loggedAt: { gte: new Date(now.getTime() - 90 * 86400000) } },
      select: { foodName: true, mealType: true, loggedAt: true },
      take: 400,
      orderBy: { loggedAt: 'desc' },
    }),
    prisma.recipe.findMany({
      where: {
        OR: [{ isSystem: true }, { creatorId: userId }],
        calories: { not: null },
      },
      include: { ingredients: { select: { ingredientName: true } } },
      take: 400,
    }),
    prisma.userHealthCondition.findMany({
      where: { userId, active: true },
      include: { condition: { include: { conditionRules: true } } },
    }).catch(() => []),
    prisma.ingredient.findMany({ include: { attributes: true } }).catch(() => []),
  ]);

  // Ingredient-name → attribute map for clinician-specified condition rules.
  const attrMap = {};
  for (const ing of ingredients) attrMap[ing.name.toLowerCase()] = ing.attributes.map(a => a.attribute);
  const attrsFor = (name) => attrMap[String(name || '').toLowerCase()] || [];

  // ---- HARD eligibility filters -------------------------------------------
  const blockedKeywords = new Set();
  for (const a of allergies) for (const w of keywordsFor(a.allergy?.name)) blockedKeywords.add(w);
  for (const p of prefs.filter(p => p.preference === 'NEVER_RECOMMEND')) blockedKeywords.add(p.foodName.toLowerCase());
  const restrictions = (planning?.dietaryRestrictions || []).map(r => String(r).toLowerCase());
  for (const r of restrictions) {
    const key = r.replace(/[\s-]+/g, '_');
    for (const w of RESTRICTION_KEYWORDS[key] || [r]) blockedKeywords.add(w);
  }

  // Clinician-specified restrictions: active health conditions with 'block'
  // rules on ingredient attributes are hard stops, same as allergies.
  const blockedAttrs = new Set();
  const conditionNames = [];
  for (const uc of userConditions) {
    const rules = uc.condition?.conditionRules || [];
    if (rules.some(r => r.target === 'ingredient' && r.action === 'block')) {
      conditionNames.push(uc.condition.name);
      for (const r of rules) {
        if (r.target === 'ingredient' && r.action === 'block') blockedAttrs.add(r.attribute);
      }
    }
  }
  const violatesCondition = (recipe) =>
    (recipe.ingredients || []).some(i => attrsFor(i.ingredientName).some(a => blockedAttrs.has(a)));

  const eligible = recipes.filter(r => {
    const t = textOf(r);
    if ([...blockedKeywords].some(k => k && t.includes(k))) return false;
    if (blockedAttrs.size && violatesCondition(r)) return false;
    return true;
  });
  const excludedCount = recipes.length - eligible.length;

  // ---- context signals -----------------------------------------------------
  const likes = new Map(prefs.filter(p => ['LOVE', 'LIKE'].includes(p.preference)).map(p => [p.foodName.toLowerCase(), p.preference === 'LOVE' ? 2 : 1]));
  const dislikes = new Set(prefs.filter(p => p.preference === 'DISLIKE').map(p => p.foodName.toLowerCase()));
  // Familiarity: token frequency of recently logged foods for this occasion.
  const history = recentLogs.filter(l => l.mealType === occ);
  const tokenFreq = {};
  for (const l of history) for (const tok of String(l.foodName).toLowerCase().split(/[^a-z]+/)) {
    if (tok.length >= 4) tokenFreq[tok] = (tokenFreq[tok] || 0) + 1;
  }
  const targetKcal = energy.target?.intakeKcal ?? null;
  const shareTarget = targetKcal != null ? targetKcal * (OCCASION_TARGET_SHARE[occ] ?? 0.25) : null;

  // ---- scoring -------------------------------------------------------------
  const scored = eligible.map(r => {
    let score = 0;
    const reasons = [];
    const t = textOf(r);
    if (r.mealType === occ) { score += 40; reasons.push(`Made for ${occ}`); }
    else if (!r.mealType) score += 10;
    for (const [name, w] of likes) if (t.includes(name)) { score += 25 * w; reasons.push('Matches your stated food preferences'); break; }
    for (const d of dislikes) if (t.includes(d)) score -= 30;
    const histHits = Object.keys(tokenFreq).filter(tok => t.includes(tok)).length;
    if (histHits > 0) { score += Math.min(20, histHits * 7); reasons.push(`Similar to ${occ}s you've previously logged`); }
    if (Number.isFinite(r.proteinG) && r.proteinG >= 20) { score += 10; reasons.push(`Provides a protein-containing ${occ} option`); }
    if (shareTarget != null && Number.isFinite(r.calories)) {
      const off = Math.abs(r.calories - shareTarget) / shareTarget;
      if (off <= 0.5) score += Math.round(15 * (1 - off * 2));
    }
    if (r.rating >= 4) score += 5;
    return { r, score, reasons };
  }).sort((a, b) => b.score - a.score || a.r.recipeName.localeCompare(b.r.recipeName));

  const options = scored.slice(0, limit).map(({ r, reasons }) => ({
    recipeId: r.id,
    name: r.recipeName,
    mealType: r.mealType || occ,
    cuisine: r.cuisine || null,
    servings: r.servings,
    nutrition: { calories: r.calories, proteinG: r.proteinG, carbsG: r.carbsG, fatG: r.fatG, fiberG: r.fiberG },
    portionG: r.portionG ?? null,
    reasons,
  }));

  // Trainer/nutritionist plan items for this occasion — surfaced as options,
  // never overridden by ranking.
  const planOptions = planItems.map(i => ({
    recipeId: null,
    name: i.foodName,
    mealType: occ,
    cuisine: null,
    nutrition: { calories: i.calories, proteinG: i.proteinG },
    reasons: ['From your active nutritionist plan'],
    fromPlan: true,
  })).filter(i => {
    const n = i.name.toLowerCase();
    if ([...blockedKeywords].some(k => k && n.includes(k))) return false;
    if (attrsFor(n).some(a => blockedAttrs.has(a))) return false;
    return true;
  });

  return {
    version: 'meal-suggest-v1',
    occasion: occ,
    timeZone: tz,
    generatedAt: now.toISOString(),
    context: {
      intakeTargetKcal: targetKcal,
      intakeTargetSource: energy.target?.source ?? null,
      loggedKcalToday: energy.intake.loggedKcal,
      intakeCompleteness: energy.intake.completeness,
      projectedExpenditureKcal: energy.expenditure.projectedDayKcal,
      note: 'Suggestions do not scale to a provisional energy deficit — logged intake may be incomplete, and meals are sized to typical occasion shares of your target.',
    },
    eligibility: {
      allergiesChecked: allergies.length,
      restrictionsApplied: restrictions,
      conditionBlocksApplied: conditionNames,
      excludedRecipes: excludedCount,
      disclaimer: 'Eligibility filters use ingredient-name matching and active health-condition block rules — deterministic but not a clinical guarantee.',
    },
    options: [...planOptions, ...options].slice(0, limit),
    emptyReason: options.length + planOptions.length === 0
      ? 'No eligible recipes matched. Try fewer restrictions, or log foods you like so suggestions can personalize.'
      : null,
  };
}

module.exports = { getMealSuggestions, resolveOccasion, keywordsFor, OCCASION_TARGET_SHARE };
