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
  const foods = await generateFoodSuggestions({
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
  const intelligence=require('../nutrients/foodIntelligence');
  const recipeIds=[...new Set(safeFoods.map(f=>f.recipeId).filter(Boolean))];
  const foodIntelligence=await intelligence.safe(async()=>{
    const recipes=await prisma.recipe.findMany({where:{id:{in:recipeIds},OR:[{isSystem:true},{creatorId:userId}]},include:{ingredients:true}});
    return intelligence.recipes(recipes,userId,prisma,Object.fromEntries(safeFoods.map(f=>[f.recipeId,f.portionG])));
  },null);

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
    foodIntelligence,
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

async function generateFoodSuggestions({ mealType, caloriesTarget, allergies }) {
  // Suggestions use the same reviewed recipes and central ingredient records as weekly planning.
  const db=getPrisma();
  const recipes=await require('../weekly/centralRecipes').resolveRecipes(await db.recipe.findMany({where:{isSystem:true,mealType},include:{ingredients:true}}),db);
  const {recipeAllowed}=require('../weekly/planningPolicy');
  const restrictions=[];
  const map={'Nut Allergy':'nut-free','Dairy Allergy':'dairy-free','Egg Allergy':'egg-free','Shellfish Allergy':'shellfish-free','Peanut Allergy':'peanut-free','Fish Allergy':'fish-free','Soy Allergy':'soy-free','Gluten Allergy':'gluten-free'};
  for(const allergy of allergies || []){if(!map[allergy])return [];restrictions.push(map[allergy]);}
  const candidate=recipes.filter(r=>recipeAllowed(r,[],restrictions)).sort((a,b)=>Math.abs(a.calories-caloriesTarget)-Math.abs(b.calories-caloriesTarget))[0];
  if(!candidate)return [];
  const factor=Math.max(0.5,Math.min(2,caloriesTarget/candidate.calories));
  const meal=require('../weekly/weeklyDietGenerator').recipeToMeal(candidate,factor);
  return [{name:meal.foodName,recipeId:candidate.id,portionG:meal.portionG,calories:meal.calories,proteinG:meal.proteinG,carbsG:meal.carbsG,fatG:meal.fatG,fiberG:meal.fiberG,nutritionSource:candidate.nutritionSource}];
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
