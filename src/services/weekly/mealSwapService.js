const { getPrisma } = require('../../lib/prisma');

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
  return { disliked, liked, restrictions };
}

function isAllowed(recipe, disliked, restrictions) {
  const name = recipe.recipeName.toLowerCase();
  if (disliked.has(name)) return false;
  for (const d of disliked) { if (name.includes(d)) return false; }
  for (const r of restrictions) {
    if (name.includes(r)) return false;
    if (recipe.ingredients?.some((i) => i.ingredientName.toLowerCase().includes(r))) return false;
  }
  return true;
}

function proteinInName(name) {
  return PROTEIN_SOURCES.find((p) => name.toLowerCase().includes(p));
}

async function getAlternatives(weeklyMealId) {
  const prisma = getPrisma();
  const meal = await prisma.weeklyMeal.findUnique({
    where: { id: weeklyMealId },
    include: { plan: true, recipe: { include: { ingredients: true } } },
  });
  if (!meal) throw new Error('Meal not found.');

  const { disliked, liked, restrictions } = await loadUserFilters(meal.plan.userId);

  const allAlternatives = await prisma.recipe.findMany({
    where: { mealType: meal.mealType, isSystem: true },
    include: { ingredients: true },
  });

  const scored = allAlternatives
    .filter((r) => r.id !== meal.recipeId && isAllowed(r, disliked, restrictions))
    .map((r) => {
      const calDiff = Math.abs(r.calories - meal.calories);
      const isLiked = liked.some((f) => r.recipeName.toLowerCase().includes(f)) ? 1 : 0;
      return { ...r, calDiff, isLiked };
    })
    .filter((r) => r.calDiff <= CALORIE_WINDOW)
    .sort((a, b) => {
      if (b.isLiked !== a.isLiked) return b.isLiked - a.isLiked;
      return a.calDiff - b.calDiff;
    });

  return scored;
}

async function swapMeal(weeklyMealId, newRecipeId) {
  const prisma = getPrisma();
  const meal = await prisma.weeklyMeal.findUnique({
    where: { id: weeklyMealId },
    include: { plan: true, recipe: { include: { ingredients: true } } },
  });
  if (!meal) throw new Error('Meal not found.');
  if (meal.confirmedByUser) throw new Error('This day is confirmed. Contact your trainer to change it.');

  const newRecipe = await prisma.recipe.findUnique({
    where: { id: newRecipeId },
    include: { ingredients: true },
  });
  if (!newRecipe) throw new Error('Recipe not found.');
  if (newRecipe.mealType !== meal.mealType) throw new Error('Recipe type does not match meal type.');

  const { disliked, restrictions } = await loadUserFilters(meal.plan.userId);
  if (!isAllowed(newRecipe, disliked, restrictions)) throw new Error('Recipe conflicts with preferences or restrictions.');

  // Update this meal with the new recipe
  await prisma.weeklyMeal.update({
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

  // Re-balance remaining meals for the day, preserving the meal just swapped
  await rebalanceDay(meal.planId, meal.dayOfWeek, meal.plan.userId, {
    disliked,
    restrictions,
    skipMealId: weeklyMealId,
  });

  return prisma.weeklyMeal.findUnique({ where: { id: weeklyMealId }, include: { recipe: { include: { ingredients: true } } } });
}

async function rebalanceDay(planId, dayOfWeek, userId, filters) {
  const prisma = getPrisma();
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

  const usedIds = new Set(lockedMeals.map((m) => m.recipeId));
  const dayProtein = new Set();

  for (const meal of unlockedMeals) {
    const candidates = allRecipes
      .filter((r) => r.mealType === meal.mealType && r.id !== meal.recipeId && !usedIds.has(r.id))
      .filter((r) => isAllowed(r, filters.disliked, filters.restrictions))
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

    const best = candidates[0] || allRecipes.find((r) => r.id === meal.recipeId);
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
