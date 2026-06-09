// Meal Recommendation Service
// Generates personalized meal recommendations based on user context,
// validates them through the safety pipeline, and returns safe suggestions.

const { getPrisma } = require('../../lib/prisma');
const { buildUserContext } = require('./contextBuilder');
const { runSafetyPipeline } = require('./safetyPipeline');

// Default macro targets by goal type.
const GOAL_TARGETS = {
  weight_loss: { caloriesPerKg: 22, proteinPerKg: 2.0, carbPct: 0.35, fatPct: 0.30 },
  muscle_gain: { caloriesPerKg: 32, proteinPerKg: 2.2, carbPct: 0.45, fatPct: 0.25 },
  maintain: { caloriesPerKg: 26, proteinPerKg: 1.8, carbPct: 0.40, fatPct: 0.30 },
  body_recomposition: { caloriesPerKg: 26, proteinPerKg: 2.2, carbPct: 0.35, fatPct: 0.30 },
};

// Meal distribution (percentage of daily targets).
const MEAL_SPLIT = {
  breakfast: 0.25,
  lunch: 0.35,
  dinner: 0.30,
  snack: 0.10,
};

/**
 * Generate a meal recommendation for a user.
 * @param {string} userId
 * @param {object} [opts] - Optional overrides.
 * @param {string} [opts.goalType] - Override goal type.
 * @param {number} [opts.weightKg] - Override weight.
 * @returns {Promise<object>} Validated meal recommendation.
 */
async function generateMealRecommendation(userId, opts = {}) {
  const prisma = getPrisma();
  const context = await buildUserContext(userId);

  // Determine user's goal and weight.
  const goalType = opts.goalType || 'maintain';
  const weightKg = opts.weightKg || context.currentWeight || 75;
  const targets = GOAL_TARGETS[goalType] || GOAL_TARGETS.maintain;

  // Calculate daily targets.
  const dailyCalories = Math.round(targets.caloriesPerKg * weightKg);
  const dailyProtein = Math.round(targets.proteinPerKg * weightKg);
  const dailyCarbs = Math.round((dailyCalories * targets.carbPct) / 4);
  const dailyFat = Math.round((dailyCalories * targets.fatPct) / 9);

  // Determine which meal to recommend based on time of day.
  const mealType = determineMealType(context.timeOfDay, context.today.mealCount);
  const split = MEAL_SPLIT[mealType] || 0.30;

  // Remaining macros for the day.
  const remainingCalories = Math.max(0, dailyCalories - context.today.calories);
  const remainingProtein = Math.max(0, dailyProtein - context.today.proteinG);
  const remainingCarbs = Math.max(0, dailyCarbs - context.today.carbsG);
  const remainingFat = Math.max(0, dailyFat - context.today.fatG);

  // Meal targets (min of split-based or remaining).
  const mealCalories = Math.min(Math.round(dailyCalories * split), remainingCalories);
  const mealProtein = Math.min(Math.round(dailyProtein * split), remainingProtein);
  const mealCarbs = Math.min(Math.round(dailyCarbs * split), remainingCarbs);
  const mealFat = Math.min(Math.round(dailyFat * split), remainingFat);

  // Generate food suggestions based on targets and context.
  const foods = generateFoodSuggestions({
    mealType,
    caloriesTarget: mealCalories,
    proteinTarget: mealProtein,
    carbsTarget: mealCarbs,
    fatTarget: mealFat,
    conditions: context.conditions,
    allergies: context.allergies,
    workoutCompleted: context.today.workoutCompleted,
    recoveryScore: context.recovery.score,
  });

  // Generate reasoning.
  const reasoning = generateReasoning(context, {
    mealType, mealCalories, mealProtein, remainingCalories, remainingProtein,
    dailyCalories, dailyProtein,
  });

  // Validate through safety pipeline.
  const safetyResult = await runSafetyPipeline(userId, {
    type: 'meal',
    ingredients: foods.map((f) => ({ name: f.name, ingredientId: f.ingredientId })),
    nutrition: {
      totalCalories: foods.reduce((s, f) => s + (f.calories || 0), 0),
      totalProteinG: foods.reduce((s, f) => s + (f.proteinG || 0), 0),
      totalCarbsG: foods.reduce((s, f) => s + (f.carbsG || 0), 0),
      totalFatG: foods.reduce((s, f) => s + (f.fatG || 0), 0),
    },
    targets: { caloriesTarget: mealCalories, proteinTarget: mealProtein, carbsTarget: mealCarbs, fatTarget: mealFat },
  });

  // Filter out blocked foods.
  const blockedNames = new Set(
    safetyResult.violations
      .filter((v) => v.severity === 'block')
      .map((v) => v.entityName),
  );
  const safeFoods = foods.filter((f) => !blockedNames.has(f.name));

  // Store recommendation.
  const recommendation = await prisma.mealRecommendation.create({
    data: {
      userId,
      mealType,
      caloriesTarget: mealCalories,
      proteinTarget: mealProtein,
      carbsTarget: mealCarbs,
      fatTarget: mealFat,
      foods: safeFoods,
      reasoning,
      safetyScore: safetyResult.safetyScore,
    },
  });

  // Store violations.
  if (safetyResult.violations.length > 0) {
    await prisma.recommendationViolation.createMany({
      data: safetyResult.violations.map((v) => ({
        recommendationId: recommendation.id,
        userId,
        entityType: v.entityType,
        entityName: v.entityName,
        attribute: v.attribute,
        conditionName: v.conditionName,
        severity: v.severity,
        reason: v.reason,
      })),
    });
  }

  return {
    id: recommendation.id,
    mealType,
    caloriesTarget: mealCalories,
    proteinTarget: mealProtein,
    carbsTarget: mealCarbs,
    fatTarget: mealFat,
    foods: safeFoods,
    reasoning,
    safetyScore: safetyResult.safetyScore,
    violations: safetyResult.violations,
    warnings: safetyResult.warnings,
    dailySummary: {
      caloriesConsumed: context.today.calories,
      caloriesRemaining: remainingCalories,
      proteinConsumed: context.today.proteinG,
      proteinRemaining: remainingProtein,
      waterMl: context.today.waterMl,
    },
  };
}

function determineMealType(timeOfDay, mealCount) {
  if (mealCount === 0) return 'breakfast';
  if (timeOfDay === 'morning') return mealCount < 1 ? 'breakfast' : 'snack';
  if (timeOfDay === 'afternoon') return mealCount < 2 ? 'lunch' : 'snack';
  if (timeOfDay === 'evening') return 'dinner';
  return 'snack';
}

function generateFoodSuggestions({ mealType, caloriesTarget, proteinTarget, conditions, allergies, workoutCompleted }) {
  // Deterministic food database for recommendations.
  // In production, this would query the Ingredient table and optionally call an LLM.
  const FOOD_SUGGESTIONS = {
    breakfast: [
      { name: 'Oatmeal', portionG: 80, calories: 311, proteinG: 14, carbsG: 53, fatG: 6 },
      { name: 'Greek yogurt', portionG: 200, calories: 118, proteinG: 20, carbsG: 7, fatG: 1 },
      { name: 'Eggs (2 whole)', portionG: 100, calories: 155, proteinG: 13, carbsG: 1, fatG: 11 },
      { name: 'Banana', portionG: 120, calories: 107, proteinG: 1, carbsG: 28, fatG: 0 },
      { name: 'Whole wheat toast', portionG: 60, calories: 160, proteinG: 6, carbsG: 28, fatG: 2 },
    ],
    lunch: [
      { name: 'Chicken breast', portionG: 200, calories: 330, proteinG: 62, carbsG: 0, fatG: 7 },
      { name: 'Brown rice', portionG: 150, calories: 185, proteinG: 4, carbsG: 38, fatG: 2 },
      { name: 'Mixed vegetables', portionG: 150, calories: 50, proteinG: 3, carbsG: 10, fatG: 0 },
      { name: 'Quinoa', portionG: 150, calories: 180, proteinG: 7, carbsG: 32, fatG: 3 },
      { name: 'Salmon', portionG: 150, calories: 312, proteinG: 30, carbsG: 0, fatG: 20 },
    ],
    dinner: [
      { name: 'Grilled chicken thigh', portionG: 200, calories: 380, proteinG: 44, carbsG: 0, fatG: 22 },
      { name: 'Sweet potato', portionG: 200, calories: 180, proteinG: 4, carbsG: 42, fatG: 0 },
      { name: 'Steamed broccoli', portionG: 150, calories: 51, proteinG: 4, carbsG: 11, fatG: 1 },
      { name: 'Lean beef', portionG: 150, calories: 250, proteinG: 36, carbsG: 0, fatG: 11 },
      { name: 'Avocado', portionG: 80, calories: 128, proteinG: 2, carbsG: 7, fatG: 12 },
    ],
    snack: [
      { name: 'Almonds', portionG: 30, calories: 174, proteinG: 6, carbsG: 7, fatG: 15 },
      { name: 'Protein shake', portionG: 31, calories: 120, proteinG: 24, carbsG: 3, fatG: 2 },
      { name: 'Apple', portionG: 150, calories: 78, proteinG: 0, carbsG: 21, fatG: 0 },
      { name: 'Cottage cheese', portionG: 150, calories: 147, proteinG: 18, carbsG: 5, fatG: 6 },
    ],
  };

  const pool = FOOD_SUGGESTIONS[mealType] || FOOD_SUGGESTIONS.lunch;

  // Filter out allergens (basic).
  const allergenMap = {
    'Nut Allergy': ['Almonds'],
    'Dairy Allergy': ['Greek yogurt', 'Cottage cheese', 'Protein shake'],
    'Egg Allergy': ['Eggs (2 whole)'],
    'Shellfish Allergy': [],
  };
  const blocked = new Set();
  for (const allergy of allergies) {
    for (const food of (allergenMap[allergy] || [])) {
      blocked.add(food);
    }
  }

  const filtered = pool.filter((f) => !blocked.has(f.name));

  // Select foods to approximately meet targets.
  const selected = [];
  let cals = 0;
  let prot = 0;
  for (const food of filtered) {
    if (cals >= caloriesTarget) break;
    selected.push(food);
    cals += food.calories;
    prot += food.proteinG;
  }

  // If protein is still low after workout, prioritize protein.
  if (workoutCompleted && prot < proteinTarget * 0.8) {
    const proteinFood = filtered.find((f) => f.proteinG > 20 && !selected.includes(f));
    if (proteinFood) selected.push(proteinFood);
  }

  return selected;
}

function generateReasoning(context, targets) {
  const lines = [];

  if (context.today.proteinG < targets.dailyProtein * 0.5 && context.timeOfDay !== 'morning') {
    lines.push(`Protein is low today (${context.today.proteinG}g of ${targets.dailyProtein}g). Prioritize high-protein foods.`);
  }

  if (targets.remainingCalories < 300 && context.timeOfDay !== 'night') {
    lines.push(`You have only ${targets.remainingCalories} kcal remaining. Choose a light meal.`);
  }

  if (context.today.workoutCompleted) {
    lines.push('Post-workout: prioritize protein and carbs for recovery.');
  }

  if (context.recovery.score < 50) {
    lines.push('Recovery score is low. Consider anti-inflammatory foods and extra rest.');
  }

  if (context.today.waterMl < 1500 && context.timeOfDay !== 'morning') {
    lines.push(`Water intake is low (${context.today.waterMl}ml). Aim for 2000ml+ today.`);
  }

  if (!lines.length) {
    lines.push(`${targets.mealType.charAt(0).toUpperCase() + targets.mealType.slice(1)}: target ${targets.mealCalories} kcal with ${targets.mealProtein}g protein.`);
  }

  return lines.join(' ');
}

module.exports = { generateMealRecommendation };
