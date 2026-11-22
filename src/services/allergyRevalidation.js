// Re-check stored weekly-plan meals against the user's CURRENT allergies.
// Plans are persisted documents, so an allergy saved after generation must be
// applied to them explicitly: on every allergy change (PUT /me/allergies) and
// on every plan read (GET /weekly-plan). Fail closed: 'unknown' composition is
// reported as needing review, never as safe.
const A = require('./allergens');

function mealItem(meal, plan, info) {
  if (meal.recipe) return A.recipeItem(meal.recipe, info);
  const ai = (plan.generationDetails?.ai?.ingredients || []).find(x => x.dayOfWeek === meal.dayOfWeek && x.mealType === meal.mealType);
  return { name: meal.foodName, lines: (ai?.ingredients || []).map(i => ({ name: i.name, resolved: true })) };
}

async function checkPlan(prisma, plan, allergies) {
  const ids = plan.meals.flatMap(m => (m.recipe?.ingredients || []).map(l => l.ingredientId));
  const info = await A.ingredientAllergenInfo(prisma, ids);
  const conflicts = [], unknown = [];
  for (const m of plan.meals) {
    const r = A.assess(mealItem(m, plan, info), allergies);
    const ref = { mealId: m.id, dayOfWeek: m.dayOfWeek, mealType: m.mealType, foodName: m.foodName, confirmedByUser: m.confirmedByUser };
    if (r.status === 'conflict') conflicts.push({ ...ref, allergens: [...new Set(r.conflicts.map(c => c.allergen))] });
    else if (r.status === 'unknown') unknown.push({ ...ref, allergens: [...new Set(r.unknown.map(c => c.allergen))], reasons: [...new Set(r.unknown.map(c => c.reason))].slice(0, 3) });
  }
  return {
    checkedAt: new Date().toISOString(), allergens: [...allergies.keys, ...allergies.custom],
    status: !allergies.keys.length && !allergies.custom.length ? 'not_applicable' : conflicts.length ? 'conflicts' : unknown.length ? 'needs_review' : 'clear',
    conflicts, unknown,
  };
}

const include = { meals: { include: { recipe: { include: { ingredients: true } } } } };

// Called after an allergy change: re-check and persist the result on each active plan.
async function revalidateActivePlans(prisma, userId, allergies) {
  const plans = await prisma.weeklyNutritionPlan.findMany({ where: { userId, status: 'active' }, include });
  const out = [];
  for (const plan of plans) {
    const check = await checkPlan(prisma, plan, allergies);
    await prisma.weeklyNutritionPlan.update({ where: { id: plan.id }, data: { generationDetails: { ...(plan.generationDetails || {}), allergyCheck: check } } });
    out.push({ planId: plan.id, weekStartDate: plan.weekStartDate, status: check.status, conflicts: check.conflicts.length, needsReview: check.unknown.length });
  }
  return { weeklyPlans: out };
}

module.exports = { checkPlan, revalidateActivePlans, mealItem };
