// Weekly Diet Generator
// Generates 7 days of breakfast/lunch/dinner/snacks.
// Rotates proteins, uses preferences, avoids restricted foods.

const { getPrisma } = require('../../lib/prisma');

// Deterministic meal database. In production, this would query the Ingredient
// table and/or call an LLM for variety.
const MEAL_DB = {
  breakfast: [
    { foodName: 'Oatmeal with berries', portionG: 300, calories: 350, proteinG: 12, carbsG: 55, fatG: 8, fiberG: 7 },
    { foodName: 'Eggs and whole wheat toast', portionG: 250, calories: 380, proteinG: 22, carbsG: 30, fatG: 18, fiberG: 3 },
    { foodName: 'Greek yogurt with granola', portionG: 280, calories: 320, proteinG: 25, carbsG: 40, fatG: 8, fiberG: 3 },
    { foodName: 'Protein smoothie', portionG: 400, calories: 350, proteinG: 35, carbsG: 40, fatG: 5, fiberG: 4 },
    { foodName: 'Avocado toast with egg', portionG: 220, calories: 400, proteinG: 18, carbsG: 35, fatG: 22, fiberG: 6 },
    { foodName: 'Overnight oats', portionG: 300, calories: 370, proteinG: 15, carbsG: 50, fatG: 10, fiberG: 8 },
    { foodName: 'Cottage cheese and fruit', portionG: 300, calories: 280, proteinG: 28, carbsG: 30, fatG: 5, fiberG: 3 },
  ],
  lunch: [
    { foodName: 'Grilled chicken salad', portionG: 350, calories: 450, proteinG: 45, carbsG: 15, fatG: 22, fiberG: 6 },
    { foodName: 'Turkey wrap', portionG: 300, calories: 420, proteinG: 35, carbsG: 40, fatG: 12, fiberG: 4 },
    { foodName: 'Salmon with quinoa', portionG: 350, calories: 520, proteinG: 40, carbsG: 35, fatG: 22, fiberG: 5 },
    { foodName: 'Chicken stir-fry with rice', portionG: 400, calories: 480, proteinG: 38, carbsG: 50, fatG: 12, fiberG: 4 },
    { foodName: 'Lentil soup with bread', portionG: 400, calories: 420, proteinG: 22, carbsG: 55, fatG: 8, fiberG: 12 },
    { foodName: 'Tuna bowl', portionG: 350, calories: 440, proteinG: 42, carbsG: 35, fatG: 14, fiberG: 4 },
    { foodName: 'Chicken breast with sweet potato', portionG: 380, calories: 460, proteinG: 48, carbsG: 40, fatG: 8, fiberG: 5 },
  ],
  dinner: [
    { foodName: 'Lean beef with vegetables', portionG: 400, calories: 500, proteinG: 45, carbsG: 20, fatG: 25, fiberG: 6 },
    { foodName: 'Baked salmon with asparagus', portionG: 350, calories: 480, proteinG: 42, carbsG: 10, fatG: 28, fiberG: 4 },
    { foodName: 'Chicken thigh with brown rice', portionG: 400, calories: 520, proteinG: 40, carbsG: 45, fatG: 18, fiberG: 3 },
    { foodName: 'Shrimp stir-fry', portionG: 380, calories: 400, proteinG: 35, carbsG: 35, fatG: 12, fiberG: 4 },
    { foodName: 'Grilled fish tacos', portionG: 350, calories: 450, proteinG: 38, carbsG: 40, fatG: 14, fiberG: 5 },
    { foodName: 'Turkey meatballs with pasta', portionG: 400, calories: 510, proteinG: 38, carbsG: 50, fatG: 15, fiberG: 4 },
    { foodName: 'Egg frittata with veggies', portionG: 350, calories: 420, proteinG: 30, carbsG: 15, fatG: 25, fiberG: 5 },
  ],
  snack: [
    { foodName: 'Protein bar', portionG: 60, calories: 200, proteinG: 20, carbsG: 22, fatG: 7, fiberG: 3 },
    { foodName: 'Almonds (30g)', portionG: 30, calories: 175, proteinG: 6, carbsG: 6, fatG: 15, fiberG: 3 },
    { foodName: 'Apple with peanut butter', portionG: 180, calories: 250, proteinG: 7, carbsG: 30, fatG: 12, fiberG: 5 },
    { foodName: 'Greek yogurt', portionG: 150, calories: 100, proteinG: 17, carbsG: 6, fatG: 1, fiberG: 0 },
    { foodName: 'Hard boiled eggs (2)', portionG: 100, calories: 155, proteinG: 13, carbsG: 1, fatG: 11, fiberG: 0 },
    { foodName: 'Hummus with veggies', portionG: 200, calories: 180, proteinG: 8, carbsG: 20, fatG: 8, fiberG: 6 },
    { foodName: 'Banana', portionG: 120, calories: 105, proteinG: 1, carbsG: 27, fatG: 0, fiberG: 3 },
  ],
};

const PROTEIN_SOURCES = ['chicken', 'salmon', 'turkey', 'beef', 'shrimp', 'tuna', 'egg', 'fish', 'lentil'];

/**
 * Generate a 7-day meal plan.
 * @param {{userId: string, caloriesTarget: number, proteinTarget: number, carbsTarget: number, fatTarget: number, fiberTarget: number, dislikedFoods: string[], restrictions: string[], mealPrepStyle: string}} ctx
 * @returns {Array<{dayOfWeek: number, mealType: string, ...meal}>}
 */
function generateWeeklyMeals(ctx) {
  const meals = [];
  const usedBreakfasts = new Set();
  const usedLunches = new Set();
  const usedDinners = new Set();
  const recentProtein = [];

  const disliked = new Set((ctx.dislikedFoods || []).map((f) => f.toLowerCase()));

  // Filter meals based on restrictions/dislikes
  function filterPool(pool) {
    return pool.filter((m) => {
      const name = m.foodName.toLowerCase();
      if (disliked.has(name)) return false;
      for (const d of disliked) { if (name.includes(d)) return false; }
      return true;
    });
  }

  // Pick a meal avoiding repeats and rotating protein
  function pickMeal(pool, usedSet) {
    const available = pool.filter((m) => !usedSet.has(m.foodName));
    // Prefer meals with different protein source
    const preferred = available.filter((m) => {
      const protein = PROTEIN_SOURCES.find((p) => m.foodName.toLowerCase().includes(p));
      return !protein || !recentProtein.includes(protein);
    });
    const choice = (preferred.length ? preferred : available.length ? available : pool)[0];
    usedSet.add(choice.foodName);
    // Track protein source
    const protein = PROTEIN_SOURCES.find((p) => choice.foodName.toLowerCase().includes(p));
    if (protein) {
      recentProtein.push(protein);
      if (recentProtein.length > 3) recentProtein.shift();
    }
    return choice;
  }

  const bPool = filterPool(MEAL_DB.breakfast);
  const lPool = filterPool(MEAL_DB.lunch);
  const dPool = filterPool(MEAL_DB.dinner);
  const sPool = filterPool(MEAL_DB.snack);

  for (let day = 0; day < 7; day++) {
    // Reset used sets weekly if we run out
    if (usedBreakfasts.size >= bPool.length) usedBreakfasts.clear();
    if (usedLunches.size >= lPool.length) usedLunches.clear();
    if (usedDinners.size >= dPool.length) usedDinners.clear();

    const prepNote = ctx.mealPrepStyle === 'weekly_prep' && day === 0 ? 'Meal prep day'
      : ctx.mealPrepStyle === 'twice_weekly_prep' && (day === 0 || day === 3) ? 'Meal prep day'
      : 'Cook fresh';

    const breakfast = pickMeal(bPool, usedBreakfasts);
    meals.push({ dayOfWeek: day, mealType: 'breakfast', ...breakfast, prepNote });

    const lunch = pickMeal(lPool, usedLunches);
    meals.push({ dayOfWeek: day, mealType: 'lunch', ...lunch, prepNote });

    const dinner = pickMeal(dPool, usedDinners);
    meals.push({ dayOfWeek: day, mealType: 'dinner', ...dinner, prepNote });

    // Snack — pick one or two based on calorie budget
    const dayCalories = breakfast.calories + lunch.calories + dinner.calories;
    if (dayCalories < ctx.caloriesTarget - 150) {
      const snack = sPool[day % sPool.length];
      meals.push({ dayOfWeek: day, mealType: 'snack', ...snack, prepNote: null });
    }
  }

  return meals;
}

/**
 * Generate aggregated shopping list from meals.
 */
function generateShoppingList(meals, inventory = []) {
  const agg = {};
  for (const meal of meals) {
    const key = meal.foodName;
    if (!agg[key]) {
      agg[key] = { foodName: key, quantityG: 0, category: guessCategory(meal) };
    }
    agg[key].quantityG += meal.portionG;
  }

  const inventoryMap = {};
  for (const inv of inventory) {
    inventoryMap[inv.foodName.toLowerCase()] = inv.quantityG;
  }

  return Object.values(agg).map((item) => {
    const invQty = inventoryMap[item.foodName.toLowerCase()] || 0;
    const needed = Math.max(0, item.quantityG - invQty);
    return {
      foodName: item.foodName,
      quantityG: needed,
      quantityDisplay: formatQuantity(item.foodName, needed),
      category: item.category,
      inInventory: invQty >= item.quantityG,
    };
  }).filter((item) => item.quantityG > 0);
}

function guessCategory(meal) {
  const name = meal.foodName.toLowerCase();
  if (['chicken', 'beef', 'salmon', 'turkey', 'shrimp', 'tuna', 'fish', 'egg'].some((p) => name.includes(p))) return 'protein';
  if (['rice', 'oat', 'bread', 'pasta', 'quinoa', 'potato'].some((c) => name.includes(c))) return 'carbs';
  if (['yogurt', 'cheese', 'cottage', 'milk'].some((d) => name.includes(d))) return 'dairy';
  if (['apple', 'banana', 'berr', 'fruit'].some((f) => name.includes(f))) return 'produce';
  return 'other';
}

function formatQuantity(name, grams) {
  if (grams >= 1000) return `${(grams / 1000).toFixed(1)}kg`;
  if (name.toLowerCase().includes('egg')) return `${Math.ceil(grams / 50)} eggs`;
  if (name.toLowerCase().includes('yogurt')) return `${Math.ceil(grams / 150)} servings`;
  return `${Math.round(grams)}g`;
}

/**
 * Full plan generation: meals + shopping list + store to DB.
 */
async function generateWeeklyPlan(userId, weekStartDate, ctx) {
  const prisma = getPrisma();

  // Load user inventory
  const inventory = await prisma.foodInventory.findMany({ where: { userId } });

  // Load food preferences
  const prefs = await prisma.foodPreference.findMany({ where: { userId } });
  const dislikedFoods = prefs
    .filter((p) => p.preference === 'DISLIKE' || p.preference === 'NEVER_RECOMMEND')
    .map((p) => p.foodName);

  // Load planning preferences
  const planPrefs = await prisma.userPlanningPreferences.findUnique({ where: { userId } });

  const meals = generateWeeklyMeals({
    ...ctx,
    dislikedFoods,
    mealPrepStyle: planPrefs?.mealPrepStyle || 'daily_cooking',
  });

  const shoppingItems = generateShoppingList(meals, inventory);

  // Create plan
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

  // Delete old meals/shopping for this plan (in case of regeneration)
  await prisma.weeklyMeal.deleteMany({ where: { planId: plan.id } });
  await prisma.weeklyShoppingList.deleteMany({ where: { planId: plan.id } });

  // Insert meals
  await prisma.weeklyMeal.createMany({
    data: meals.map((m) => ({ planId: plan.id, ...m })),
  });

  // Insert shopping list
  if (shoppingItems.length > 0) {
    const list = await prisma.weeklyShoppingList.create({
      data: { planId: plan.id },
    });
    await prisma.weeklyShoppingItem.createMany({
      data: shoppingItems.map((item) => ({ shoppingListId: list.id, ...item })),
    });
  }

  // Create notification
  await prisma.notification.create({
    data: {
      userId,
      type: 'plan_ready',
      title: 'Your Weekly Plan Is Ready',
      body: `Your personalized meal plan for the week of ${weekStartDate} is ready. Check it out!`,
    },
  });

  return {
    planId: plan.id,
    weekStartDate,
    caloriesTarget: ctx.caloriesTarget,
    proteinTarget: ctx.proteinTarget,
    mealsCount: meals.length,
    shoppingItemsCount: shoppingItems.length,
  };
}

module.exports = { generateWeeklyMeals, generateShoppingList, generateWeeklyPlan };
