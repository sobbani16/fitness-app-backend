// Weekly Diet Generator
// Generates 7 days of breakfast/lunch/dinner/snacks from the Recipe catalog.
// Rotates proteins, respects user dislikes/restrictions, and links meals to recipes.

const { getPrisma } = require('../../lib/prisma');

const PROTEIN_SOURCES = ['chicken', 'salmon', 'turkey', 'beef', 'shrimp', 'tuna', 'egg', 'fish', 'lentil'];

function recipeToMeal(recipe) {
  return {
    recipeId: recipe.id,
    foodName: recipe.recipeName,
    portionG: recipe.portionG || recipe.servings * 100,
    calories: recipe.calories || 0,
    proteinG: recipe.proteinG || 0,
    carbsG: recipe.carbsG || 0,
    fatG: recipe.fatG || 0,
    fiberG: recipe.fiberG || 0,
  };
}

/**
 * Generate a 7-day meal plan using recipes from the DB.
 * @param {{recipesByType: Record<string, Array>, caloriesTarget: number, proteinTarget: number, carbsTarget: number, fatTarget: number, fiberTarget: number, dislikedFoods: string[], restrictions: string[], mealPrepStyle: string}} ctx
 * @returns {Array<{dayOfWeek: number, mealType: string, ...meal}>}
 */
function generateWeeklyMeals(ctx) {
  const meals = [];
  const usedBreakfasts = new Set();
  const usedLunches = new Set();
  const usedDinners = new Set();
  const recentProtein = [];

  const disliked = new Set((ctx.dislikedFoods || []).map((f) => f.toLowerCase()));
  const restrictions = new Set((ctx.restrictions || []).map((r) => r.toLowerCase()));

  function hasDislikedOrRestricted(name, ingredients) {
    const lowerName = name.toLowerCase();
    if (disliked.has(lowerName)) return true;
    for (const d of disliked) { if (lowerName.includes(d)) return true; }
    for (const r of restrictions) {
      if (lowerName.includes(r)) return true;
      if (ingredients && ingredients.some((i) => i.ingredientName.toLowerCase().includes(r))) return true;
    }
    return false;
  }

  function filterPool(pool) {
    return pool.filter((r) => !hasDislikedOrRestricted(r.recipeName, r.ingredients));
  }

  function pickMeal(pool, usedSet) {
    const available = pool.filter((r) => !usedSet.has(r.id));
    const preferred = available.filter((r) => {
      const protein = PROTEIN_SOURCES.find((p) => r.recipeName.toLowerCase().includes(p));
      return !protein || !recentProtein.includes(protein);
    });
    const choice = (preferred.length ? preferred : available.length ? available : pool)[0];
    if (!choice) return null;
    usedSet.add(choice.id);
    const protein = PROTEIN_SOURCES.find((p) => choice.recipeName.toLowerCase().includes(p));
    if (protein) {
      recentProtein.push(protein);
      if (recentProtein.length > 3) recentProtein.shift();
    }
    return choice;
  }

  const bPool = filterPool(ctx.recipesByType.breakfast || []);
  const lPool = filterPool(ctx.recipesByType.lunch || []);
  const dPool = filterPool(ctx.recipesByType.dinner || []);
  const sPool = filterPool(ctx.recipesByType.snack || []);

  if (!bPool.length || !lPool.length || !dPool.length) {
    throw new Error('Not enough recipes available after applying preferences/restrictions.');
  }

  for (let day = 0; day < 7; day++) {
    if (usedBreakfasts.size >= bPool.length) usedBreakfasts.clear();
    if (usedLunches.size >= lPool.length) usedLunches.clear();
    if (usedDinners.size >= dPool.length) usedDinners.clear();

    const prepNote = ctx.mealPrepStyle === 'weekly_prep' && day === 0 ? 'Meal prep day'
      : ctx.mealPrepStyle === 'twice_weekly_prep' && (day === 0 || day === 3) ? 'Meal prep day'
      : 'Cook fresh';

    const breakfast = pickMeal(bPool, usedBreakfasts);
    meals.push({ dayOfWeek: day, mealType: 'breakfast', ...recipeToMeal(breakfast), prepNote });

    const lunch = pickMeal(lPool, usedLunches);
    meals.push({ dayOfWeek: day, mealType: 'lunch', ...recipeToMeal(lunch), prepNote });

    const dinner = pickMeal(dPool, usedDinners);
    meals.push({ dayOfWeek: day, mealType: 'dinner', ...recipeToMeal(dinner), prepNote });

    const dayCalories = breakfast.calories + lunch.calories + dinner.calories;
    if (dayCalories < ctx.caloriesTarget - 150 && sPool.length) {
      const snack = sPool[day % sPool.length];
      meals.push({ dayOfWeek: day, mealType: 'snack', ...recipeToMeal(snack), prepNote: null });
    }
  }

  return meals;
}

/**
 * Full plan generation: load recipes, generate meals, store to DB.
 * Shopping list is generated separately after day confirmation.
 */
async function generateWeeklyPlan(userId, weekStartDate, ctx) {
  const prisma = getPrisma();

  // Load food preferences and planning preferences
  const prefs = await prisma.foodPreference.findMany({ where: { userId } });
  const dislikedFoods = prefs
    .filter((p) => p.preference === 'DISLIKE' || p.preference === 'NEVER_RECOMMEND')
    .map((p) => p.foodName);
  const likedFoods = prefs
    .filter((p) => p.preference === 'LOVE' || p.preference === 'LIKE')
    .map((p) => p.foodName);

  const planPrefs = await prisma.userPlanningPreferences.findUnique({ where: { userId } });
  const restrictions = planPrefs?.dietaryRestrictions || [];

  // Load all system recipes with their ingredients
  const allRecipes = await prisma.recipe.findMany({
    where: { isSystem: true },
    include: { ingredients: true },
  });

  const recipesByType = {};
  for (const r of allRecipes) {
    const type = r.mealType || 'snack';
    if (!recipesByType[type]) recipesByType[type] = [];
    recipesByType[type].push(r);
  }

  // Boost liked foods to the top of each pool
  for (const type of Object.keys(recipesByType)) {
    recipesByType[type].sort((a, b) => {
      const aLiked = likedFoods.some((f) => a.recipeName.toLowerCase().includes(f.toLowerCase())) ? 1 : 0;
      const bLiked = likedFoods.some((f) => b.recipeName.toLowerCase().includes(f.toLowerCase())) ? 1 : 0;
      return bLiked - aLiked;
    });
  }

  const meals = generateWeeklyMeals({
    ...ctx,
    recipesByType,
    dislikedFoods,
    restrictions,
    mealPrepStyle: planPrefs?.mealPrepStyle || 'daily_cooking',
  });

  // Create or update plan
  const plan = await prisma.weeklyNutritionPlan.upsert({
    where: { userId_weekStartDate: { userId, weekStartDate } },
    update: {
      status: 'active',
      caloriesTarget: ctx.caloriesTarget,
      proteinTarget: ctx.proteinTarget,
      carbsTarget: ctx.carbsTarget,
      fatTarget: ctx.fatTarget,
      fiberTarget: ctx.fiberTarget,
      explanation: ctx.explanation || null,
    },
    create: {
      userId,
      weekStartDate,
      caloriesTarget: ctx.caloriesTarget,
      proteinTarget: ctx.proteinTarget,
      carbsTarget: ctx.carbsTarget,
      fatTarget: ctx.fatTarget,
      fiberTarget: ctx.fiberTarget,
      explanation: ctx.explanation || null,
    },
  });

  // Reset previous meals and shopping list
  await prisma.weeklyMeal.deleteMany({ where: { planId: plan.id } });
  await prisma.weeklyShoppingList.deleteMany({ where: { planId: plan.id } });

  // Insert meals
  await prisma.weeklyMeal.createMany({
    data: meals.map((m) => ({ planId: plan.id, ...m })),
  });

  // Create notification
  await prisma.notification.create({
    data: {
      userId,
      type: 'plan_ready',
      title: 'Your Weekly Plan Is Ready',
      body: `Your personalized meal plan for the week of ${weekStartDate} is ready. Customize and confirm each day!`,
    },
  });

  return {
    planId: plan.id,
    weekStartDate,
    caloriesTarget: ctx.caloriesTarget,
    proteinTarget: ctx.proteinTarget,
    mealsCount: meals.length,
  };
}

module.exports = { generateWeeklyMeals, generateWeeklyPlan };
