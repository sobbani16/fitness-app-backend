// Unified, health-aware nutrition recommendation orchestration.
// Stages: (1) user context from logged intake → (2) constraint evaluation
// (allergies + APPROVED condition rules only) → (3) candidate recipes from
// the local catalog → (4) optional AI re-ranking with a minimized payload →
// (5) server-side revalidation. Deterministic output works fully without AI.
const { nutrientStatus } = require('./nutrientStatus');
const { askJSON, aiEnabled } = require('./aiProvider');
const education = require('../../data/foodEducation.json');

const BLOCKED_REVIEW = new Set(['REJECTED']);

function allergenHits(recipe, allergenNames) {
  const text = `${recipe.recipeName} ${(recipe.aliases || []).join(' ')} ${(recipe.ingredients || []).map(i => i.ingredientName).join(' ')}`.toLowerCase();
  const declared = (recipe.allergens || []).map(a => a.toLowerCase());
  return allergenNames.filter(a => declared.includes(a) || text.includes(a));
}

async function constraints(prisma, userId) {
  const allergies = await prisma.userAllergy.findMany({ where: { userId }, include: { allergy: true } });
  const allergenNames = allergies.map(a => a.allergy.name.toLowerCase());
  const conditions = await prisma.userHealthCondition.findMany({ where: { userId, active: true }, include: { condition: { include: { conditionRules: { where: { reviewStatus: 'APPROVED' } } } } } });
  const rules = [];
  for (const uc of conditions) {
    for (const r of uc.condition?.conditionRules || []) {
      // Only reviewed, approved rules may act. Anything else is inert.
      rules.push({ id: r.id, code: r.ruleCode, attribute: r.attribute, action: r.clinicalAction || r.action, severity: r.clinicalSeverity, reason: r.reason, conditionId: uc.conditionId });
    }
  }
  return { allergenNames, rules };
}

async function candidates(prisma, userId, { cuisines, maxCookingMinutes } = {}) {
  const where = { OR: [{ isSystem: true }, { creatorId: userId }] };
  const rows = await prisma.recipe.findMany({
    where,
    select: {
      id: true, recipeName: true, cuisine: true, region: true, aliases: true, allergens: true,
      servings: true, calories: true, proteinG: true, carbsG: true, fatG: true, fiberG: true,
      reviewStatus: true, prepMinutes: true,
      ingredients: { select: { ingredientName: true, amountG: true, optional: true }, take: 40 },
    },
    take: 400,
  });
  return rows.filter(r => !BLOCKED_REVIEW.has(r.reviewStatus))
    .filter(r => !cuisines?.length || cuisines.map(c => c.toLowerCase()).includes((r.cuisine || '').toLowerCase()))
    .filter(r => maxCookingMinutes == null || r.prepMinutes == null || r.prepMinutes <= maxCookingMinutes);
}

function completenessOf(r) {
  if (r.reviewStatus === 'SYSTEM') return 'COMPLETE_FROM_REVIEWED_INPUTS';
  if (r.calories == null && r.proteinG == null) return 'UNKNOWN_COMPOSITION';
  return 'ESTIMATE_WITH_ASSUMPTIONS';
}

function score(r, remaining) {
  // Gap-fit: reward nutrients the user still needs; penalize unknown core data.
  let s = 0;
  for (const [nutrient, gap] of [['proteinG', remaining.proteinG], ['fiberG', remaining.fiberG]]) {
    const v = r[nutrient];
    if (typeof v === 'number' && gap > 0) s += Math.min(1, v / gap) * 2;
    if (v == null) s -= 0.5;
  }
  if (typeof r.calories === 'number' && remaining.calories > 0) {
    if (r.calories <= remaining.calories) s += 1; else s -= Math.min(2, (r.calories - remaining.calories) / remaining.calories);
  }
  return s;
}

function educationFor(r) {
  const text = `${r.recipeName} ${(r.ingredients || []).map(i => i.ingredientName).join(' ')}`.toLowerCase();
  return education.filter(e => e.matches.some(m => text.includes(m)));
}

async function suggestMeals(prisma, userId, opts = {}) {
  const status = await nutrientStatus(prisma, userId, { days: 1 });
  const logged = status.nutrients;
  const remaining = {
    calories: logged.calories.reference != null && logged.calories.value != null ? Math.max(0, logged.calories.reference - logged.calories.value) : null,
    proteinG: logged.proteinG.reference != null ? Math.max(0, logged.proteinG.reference - (logged.proteinG.value || 0)) : null,
    fiberG: logged.fiberG.reference != null ? Math.max(0, logged.fiberG.reference - (logged.fiberG.value || 0)) : null,
  };
  const { allergenNames, rules } = await constraints(prisma, userId);
  const blockAttrs = rules.filter(r => ['BLOCK', 'block'].includes(r.action)).map(r => String(r.attribute || '').toLowerCase());
  const warnRules = rules.filter(r => !['BLOCK', 'block'].includes(r.action));
  const pool = await candidates(prisma, userId, opts);
  const eligible = [], rejected = [];
  for (const r of pool) {
    const hits = allergenHits(r, allergenNames);
    if (hits.length) { rejected.push({ recipeId: r.id, reason: `allergen: ${hits.join(', ')}` }); continue; }
    const ingr = (r.ingredients || []).map(i => i.ingredientName.toLowerCase()).join(' ');
    if (blockAttrs.some(a => a && ingr.includes(a))) { rejected.push({ recipeId: r.id, reason: 'condition-blocked' }); continue; }
    eligible.push(r);
  }
  const ranked = eligible
    .map(r => ({ r, s: score(r, remaining) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, opts.limit || 8);
  // Stage 4: optional AI re-rank + explanation. Payload is minimized: targets,
  // gaps, exclusion summary and eligible IDs only — no identifiers, no records.
  let aiUsed = false;
  if (opts.allowAi && ranked.length > 1 && aiEnabled()) {
    try {
      const eligibleIds = ranked.map(x => x.r.id);
      const payload = {
        occasion: opts.occasion || 'meal',
        nutrition: {
          remaining, loggedCompleteness: status.completeness,
        },
        constraints: { allergenExclusions: allergenNames.length, reviewedRuleCount: rules.length },
        preferences: { cuisines: opts.cuisines || [], maxCookingMinutes: opts.maxCookingMinutes || null },
        eligibleRecipeIds: eligibleIds,
      };
      const out = await askJSON(
        'humai_recipe_rerank_v1',
        { rankedIds: { type: 'array', items: { type: 'string' }, description: 'subset of eligibleRecipeIds in best order' }, briefWhy: { type: 'string', description: 'one sentence, nutritional trade-off only, no medical claims' } },
        'Re-rank recipe IDs for the user. Never add IDs not in eligibleRecipeIds. No diagnosis, no health claims.',
        JSON.stringify(payload), null, userId, { purpose: 'nutrition_recommendation' });
      const ids = Array.isArray(out?.rankedIds) ? out.rankedIds.filter(id => eligibleIds.includes(id)) : [];
      if (ids.length) {
        const pos = new Map(ids.map((id, i) => [id, i]));
        ranked.sort((a, b) => (pos.get(a.r.id) ?? 99) - (pos.get(b.r.id) ?? 99));
        if (typeof out.briefWhy === 'string' && out.briefWhy.length < 300) ranked.aiNote = out.briefWhy;
        aiUsed = true;
      }
    } catch { aiUsed = false; } // deterministic fallback is the contract
  }
  const items = ranked.map(({ r, s }) => ({
    recipeId: r.id, recipeName: r.recipeName, cuisine: r.cuisine, servings: r.servings,
    perServing: { calories: r.calories ?? null, proteinG: r.proteinG ?? null, carbsG: r.carbsG ?? null, fatG: r.fatG ?? null, fiberG: r.fiberG ?? null },
    completeness: completenessOf(r), reviewStatus: r.reviewStatus, score: Math.round(s * 100) / 100,
    why: buildWhy(r, remaining),
    warnings: warnRules.map(w => w.reason).filter(Boolean).slice(0, 3),
    education: educationFor(r).map(e => ({ title: e.title, points: e.points, portionNote: e.portionNote })),
  }));
  return {
    items, aiPersonalized: aiUsed, rejectedCount: rejected.length,
    context: { remaining, loggedCompleteness: status.completeness, constraintsApplied: { allergens: allergenNames.length, reviewedRules: rules.length } },
    disclaimer: 'Suggestions use logged intake and reviewed rules only. Missing nutrients are unknown, not zero. Not medical advice.',
  };
}

function buildWhy(r, remaining) {
  const why = [];
  if (remaining.proteinG > 0 && typeof r.proteinG === 'number' && r.proteinG > 0)
    why.push(`Your logged protein is below the reference; one serving provides ~${r.proteinG} g.`);
  if (remaining.fiberG > 0 && typeof r.fiberG === 'number' && r.fiberG > 0)
    why.push(`Fiber logged is below the reference; this adds ~${r.fiberG} g per serving.`);
  if (!why.length) why.push('Fits your remaining logged intake today.');
  if (r.fiberG == null) why.push('Fiber content unknown — not counted as zero.');
  return why;
}
module.exports = { suggestMeals };
