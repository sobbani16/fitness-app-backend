// Nutrition Validator
// Validates meal plans, recipes, and food logs against user targets and conditions.

const { validateIngredients } = require('./ingredientValidator');

/**
 * Validate a recipe or meal plan.
 * @param {string} userId
 * @param {{ingredients: Array, totalCalories: number, totalProteinG: number, totalCarbsG: number, totalFatG: number}} meal
 * @param {{caloriesTarget: number, proteinTarget: number, carbsTarget?: number, fatTarget?: number}} targets
 * @returns {Promise<{safe: boolean, safetyScore: number, violations: Array, nutritionWarnings: Array}>}
 */
async function validateMealNutrition(userId, meal, targets) {
  // 1. Check ingredients against user conditions.
  const ingredientResult = await validateIngredients(userId, meal.ingredients || []);

  // 2. Check nutritional targets.
  const nutritionWarnings = [];

  if (targets) {
    if (meal.totalCalories > targets.caloriesTarget * 1.3) {
      nutritionWarnings.push({
        type: 'calories_excess',
        message: `This meal has ${Math.round(meal.totalCalories)} kcal, which is ${Math.round((meal.totalCalories / targets.caloriesTarget - 1) * 100)}% over your target.`,
      });
    }

    if (targets.proteinTarget && meal.totalProteinG < targets.proteinTarget * 0.5) {
      nutritionWarnings.push({
        type: 'protein_low',
        message: `Only ${Math.round(meal.totalProteinG)}g protein — well below your ${targets.proteinTarget}g target for this meal.`,
      });
    }

    if (targets.carbsTarget && meal.totalCarbsG > targets.carbsTarget * 1.5) {
      nutritionWarnings.push({
        type: 'carbs_excess',
        message: `${Math.round(meal.totalCarbsG)}g carbs — exceeds your ${targets.carbsTarget}g target by ${Math.round(meal.totalCarbsG - targets.carbsTarget)}g.`,
      });
    }

    if (targets.fatTarget && meal.totalFatG > targets.fatTarget * 1.5) {
      nutritionWarnings.push({
        type: 'fat_excess',
        message: `${Math.round(meal.totalFatG)}g fat — exceeds your ${targets.fatTarget}g target.`,
      });
    }
  }

  // Combine safety scores.
  const nutritionPenalty = nutritionWarnings.length * 5;
  const safetyScore = Math.max(0, ingredientResult.safetyScore - nutritionPenalty);

  return {
    safe: ingredientResult.safe && nutritionWarnings.filter((w) => w.type.includes('excess')).length < 2,
    safetyScore,
    violations: ingredientResult.violations,
    nutritionWarnings,
  };
}

module.exports = { validateMealNutrition };
