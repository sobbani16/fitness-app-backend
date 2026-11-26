const { getPrisma } = require('../../lib/prisma');
const { httpError } = require('../../lib/errors');
const A = require('../allergens');

// Build an allergen assessor bound to the owner. A recipe swapped into a
// plan must face the same allergy policy as generation and confirmDay —
// conflicts are never offered; unknown composition is surfaced, not hidden.
async function allergenAssessor(prisma, userId, recipes) {
  const user = await A.loadUserAllergies(prisma, userId);
  if (!user.keys.length && !user.custom.length) return () => null;
  const ids = [...new Set(recipes.flatMap((r) => (r.ingredients || []).map((i) => i.ingredientId)))];
  const info = await A.ingredientAllergenInfo(prisma, ids);
  return (recipe) => A.assess(A.recipeItem(recipe, info), user);
}

const CALORIE_WINDOW = 50;
const PROTEIN_SOURCES = ['chicken', 'salmon', 'turkey', 'beef', 'shrimp', 'tuna', 'egg', 'fish', 'lentil'];

async function loadUserFilters(userId) {
  const prisma = getPrisma();
  const prefs = await prisma.foodPreference.findMany({ where: { userId } });
  const disliked = new Set(
    prefs.filter((p) => p.preference === 'DISLIKE' || p.preference === 'NEVER_RECOMMEND').map((p) => p.foodName.toLowerCase())
  );
  const liked = prefs.filter((p) => p.preference === 'LOVE' || p.preference === 'LIKE').map((p) => p.foodName.toLowerCase());
  const planPrefs = await prisma.userPlanningPreferences.findUnique({ where: { userId } });
  const restrictions = new Set((planPrefs?.dietaryRestrictions || []).map((r) => r.toLowerCase()));
  return { disliked, liked, restrictions, preferences: planPrefs || {} };
}

function isAllowed(recipe, disliked, restrictions, preferences = {}) {
  return require('./planningPolicy').recipeAllowed(recipe, disliked, restrictions, preferences);
}

function proteinInName(name) {
  return PROTEIN_SOURCES.find((p) => name.toLowerCase().includes(p));
}

async function getAlternatives(weeklyMealId, userId) {
  const prisma = getPrisma();
  const meal = await prisma.weeklyMeal.findUnique({
    where: { id: weeklyMealId },
    include: { plan: true, recipe: { include: { ingredients: true } } },
  });
  if (!meal) throw new Error('Meal not found.');
  if (meal.plan.userId !== userId) throw httpError(404, 'Meal not found.');

  const { disliked, liked, restrictions, preferences } = await loadUserFilters(meal.plan.userId);

  const allAlternatives = await prisma.recipe.findMany({
    where: { mealType: meal.mealType, isSystem: true },
    include: { ingredients: true },
  });

  const assess = await allergenAssessor(prisma, meal.plan.userId, allAlternatives);
  const scored = allAlternatives
    .filter((r) => {
      if (r.id === meal.recipeId) return false;
      if (!isAllowed(r, disliked, restrictions, preferences)) return false;
      // Allergy-conflicting recipes are never offered as substitutes.
      const v = assess(r);
      return !v || v.status !== 'conflict';
    })
    .map((r) => {
      const calDiff = Math.abs(r.calories - meal.calories);
      const isLiked = liked.some((f) => r.recipeName.toLowerCase().includes(f)) ? 1 : 0;
      const v = assess(r);
      return { ...r, calDiff, isLiked, allergyStatus: v?.status || 'not_applicable' };
    })
    .filter((r) => r.calDiff <= CALORIE_WINDOW)
    .sort((a, b) => {
      if (b.isLiked !== a.isLiked) return b.isLiked - a.isLiked;
      return a.calDiff - b.calDiff;
    });

  return scored;
}

async function swapMeal(weeklyMealId, newRecipeId, userId, { acknowledgeUnknownAllergens = false } = {}) {
  const prisma = getPrisma();
  const meal = await prisma.weeklyMeal.findUnique({
    where: { id: weeklyMealId },
    include: { plan: true, recipe: { include: { ingredients: true } } },
  });
  if (!meal) throw new Error('Meal not found.');
  if (meal.plan.userId !== userId) throw httpError(404, 'Meal not found.');
  if (meal.confirmedByUser) throw new Error('This day is confirmed. Contact your trainer to change it.');

  const newRecipe = await prisma.recipe.findUnique({
    where: { id: newRecipeId },
    include: { ingredients: true },
  });
  if (!newRecipe) throw new Error('Recipe not found.');
  if (newRecipe.mealType !== meal.mealType) throw new Error('Recipe type does not match meal type.');

  const { disliked, restrictions, preferences } = await loadUserFilters(meal.plan.userId);
  if (!isAllowed(newRecipe, disliked, restrictions, preferences)) throw new Error('Recipe conflicts with preferences or restrictions.');

  // Substitution recheck: same verdicts as confirmDay — conflict never swaps
  // in; unknown composition requires the same explicit acknowledgment.
  const verdict = (await allergenAssessor(prisma, meal.plan.userId, [newRecipe]))(newRecipe);
  if (verdict?.status === 'conflict') {
    throw Object.assign(httpError(409, 'Recipe conflicts with your recorded allergies.'), { code: 'ALLERGY_CONFLICT', details: { conflicts: verdict.conflicts } });
  }
  if (verdict?.status === 'unknown' && !acknowledgeUnknownAllergens) {
    throw Object.assign(httpError(409, 'Recipe composition is unknown — swapping requires explicit acknowledgment.'), { code: 'ALLERGY_COMPOSITION_UNKNOWN', details: { unknowns: verdict.unknown } });
  }

  // P6-002: the swap write and the dependent rebalance are ONE atomic unit —
  // a mid-rebalance failure must never leave the plan half-swapped with the
  // day's macros no longer matching targets.
  await prisma.$transaction(async (tx) => {
    await tx.weeklyMeal.update({
      where: { id: weeklyMealId },
      data: {
        recipeId: newRecipe.id,
        foodName: newRecipe.recipeName,
        portionG: newRecipe.portionG || newRecipe.servings * 100,
        calories: newRecipe.calories || 0,
        proteinG: newRecipe.proteinG || 0,
        carbsG: newRecipe.carbsG || 0,
        fatG: newRecipe.fatG || 0,
        fiberG: newRecipe.fiberG || 0,
      },
    });

    await rebalanceDay(meal.planId, meal.dayOfWeek, meal.plan.userId, {
      disliked,
      restrictions,
      skipMealId: weeklyMealId,
      preferences,
    }, tx);
  });

  return prisma.weeklyMeal.findUnique({ where: { id: weeklyMealId }, include: { recipe: { include: { ingredients: true } } } });
}

async function rebalanceDay(planId, dayOfWeek, userId, filters, db) {
  const prisma = db || getPrisma();
  const plan = await prisma.weeklyNutritionPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new Error('Plan not found.');

  const dayMeals = await prisma.weeklyMeal.findMany({
    where: { planId, dayOfWeek },
    include: { recipe: { include: { ingredients: true } } },
    orderBy: [{ mealType: 'asc' }],
  });

  const skipMealId = filters.skipMealId;
  const lockedMeals = dayMeals.filter((m) => m.confirmedByUser || m.id === skipMealId);
  const unlockedMeals = dayMeals.filter((m) => !m.confirmedByUser && m.id !== skipMealId);

  const remainingCalories = Math.max(0, plan.caloriesTarget - lockedMeals.reduce((s, m) => s + m.calories, 0));
  const remainingProtein = Math.max(0, plan.proteinTarget - lockedMeals.reduce((s, m) => s + m.proteinG, 0));
  const remainingCarbs = Math.max(0, plan.carbsTarget - lockedMeals.reduce((s, m) => s + m.carbsG, 0));
  const remainingFat = Math.max(0, plan.fatTarget - lockedMeals.reduce((s, m) => s + m.fatG, 0));

  const unlockedCount = unlockedMeals.length;
  if (unlockedCount === 0) return;

  const targetCaloriesPerMeal = remainingCalories / unlockedCount;
  const targetProteinPerMeal = remainingProtein / unlockedCount;
  const targetCarbsPerMeal = remainingCarbs / unlockedCount;
  const targetFatPerMeal = remainingFat / unlockedCount;

  const allRecipes = await prisma.recipe.findMany({
    where: { isSystem: true },
    include: { ingredients: true },
  });

  // rebalance is an automatic server-side write — there is no user in the
  // loop to acknowledge, so allergen-conflicting AND composition-unknown
  // recipes are both ineligible as replacements (stricter than manual swap,
  // which can 409+ack). Keeping the meal's current recipe introduces no new
  // hazard, so the fallback is exempt.
  const assess = userId ? await allergenAssessor(prisma, userId, allRecipes) : null;
  const allergyEligible = (r) => {
    if (!assess) return true;
    const v = assess(r);
    return !v || (v.status !== 'conflict' && v.status !== 'unknown');
  };

  const usedIds = new Set(lockedMeals.map((m) => m.recipeId));
  const dayProtein = new Set();

  for (const meal of unlockedMeals) {
    const candidates = allRecipes
      .filter((r) => r.mealType === meal.mealType && r.id !== meal.recipeId && !usedIds.has(r.id))
      .filter((r) => allergyEligible(r) && isAllowed(r, filters.disliked, filters.restrictions, filters.preferences))
      .map((r) => {
        const protein = proteinInName(r.recipeName);
        const score =
          Math.abs((r.calories || 0) - targetCaloriesPerMeal) * 2 +
          Math.abs((r.proteinG || 0) - targetProteinPerMeal) * 4 +
          Math.abs((r.carbsG || 0) - targetCarbsPerMeal) +
          Math.abs((r.fatG || 0) - targetFatPerMeal) +
          (protein && dayProtein.has(protein) ? 30 : 0);
        return { ...r, score };
      })
      .sort((a, b) => a.score - b.score);

    const best = candidates[0] || allRecipes.find((r) => r.id === meal.recipeId && isAllowed(r, filters.disliked, filters.restrictions, filters.preferences));
    if (best) {
      usedIds.add(best.id);
      const protein = proteinInName(best.recipeName);
      if (protein) dayProtein.add(protein);
      await prisma.weeklyMeal.update({
        where: { id: meal.id },
        data: {
          recipeId: best.id,
          foodName: best.recipeName,
          portionG: best.portionG || best.servings * 100,
          calories: best.calories || 0,
          proteinG: best.proteinG || 0,
          carbsG: best.carbsG || 0,
          fatG: best.fatG || 0,
          fiberG: best.fiberG || 0,
        },
      });
    }
  }
}

module.exports = { getAlternatives, swapMeal, rebalanceDay };
