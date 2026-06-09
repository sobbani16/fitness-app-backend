// Safety Pipeline — the central validation orchestrator.
// All recommendations pass through this before being shown to users.
//
// Flow: Context → Recommendation → LLM → Validate → Score → Response

const { getPrisma } = require('../../lib/prisma');
const { validateIngredients } = require('./ingredientValidator');
const { validateSupplements } = require('./supplementValidator');
const { validateMealNutrition } = require('./nutritionValidator');

/**
 * Run the full validation pipeline on a recommendation.
 * @param {string} userId
 * @param {object} recommendation - The recommendation to validate.
 * @param {string} recommendation.type - "meal" | "recipe" | "supplement"
 * @param {Array} [recommendation.ingredients] - Ingredients in the meal/recipe.
 * @param {Array} [recommendation.supplements] - Supplements being recommended.
 * @param {object} [recommendation.nutrition] - Nutrition totals.
 * @param {object} [recommendation.targets] - User's targets for this meal.
 * @returns {Promise<{safe: boolean, safetyScore: number, violations: Array, warnings: Array}>}
 */
async function runSafetyPipeline(userId, recommendation) {
  const allViolations = [];
  const allWarnings = [];
  let minScore = 100;

  // 1. Validate ingredients (for meals and recipes).
  if (recommendation.ingredients && recommendation.ingredients.length > 0) {
    const ingResult = await validateIngredients(userId, recommendation.ingredients);
    allViolations.push(...ingResult.violations);
    minScore = Math.min(minScore, ingResult.safetyScore);
  }

  // 2. Validate supplements.
  if (recommendation.supplements && recommendation.supplements.length > 0) {
    const suppResult = await validateSupplements(userId, recommendation.supplements);
    allViolations.push(...suppResult.violations);
    allWarnings.push(...suppResult.timingWarnings.map((tw) => ({
      type: 'timing',
      ...tw,
    })));
    minScore = Math.min(minScore, suppResult.safetyScore);
  }

  // 3. Validate nutrition (for meals/recipes with targets).
  if (recommendation.nutrition && recommendation.targets) {
    const nutResult = await validateMealNutrition(
      userId,
      { ingredients: recommendation.ingredients || [], ...recommendation.nutrition },
      recommendation.targets,
    );
    // Don't double-count ingredient violations.
    allWarnings.push(...nutResult.nutritionWarnings.map((nw) => ({
      type: 'nutrition',
      ...nw,
    })));
    minScore = Math.min(minScore, nutResult.safetyScore);
  }

  const blocks = allViolations.filter((v) => v.severity === 'block');
  const safe = blocks.length === 0;

  // 4. Log the audit.
  const prisma = getPrisma();
  await prisma.safetyAuditLog.create({
    data: {
      userId,
      checkType: `${recommendation.type}_validation`,
      input: {
        type: recommendation.type,
        ingredientCount: (recommendation.ingredients || []).length,
        supplementCount: (recommendation.supplements || []).length,
      },
      result: { safe, violations: allViolations.length, warnings: allWarnings.length },
      safetyScore: minScore,
      passed: safe,
    },
  });

  return {
    safe,
    safetyScore: minScore,
    violations: allViolations,
    warnings: allWarnings,
  };
}

/**
 * Validate a recipe (shorthand).
 */
async function validateRecipe(userId, recipe) {
  return runSafetyPipeline(userId, {
    type: 'recipe',
    ingredients: recipe.ingredients || [],
    nutrition: {
      totalCalories: recipe.totalCalories || 0,
      totalProteinG: recipe.totalProteinG || 0,
      totalCarbsG: recipe.totalCarbsG || 0,
      totalFatG: recipe.totalFatG || 0,
    },
    targets: recipe.targets || null,
  });
}

module.exports = { runSafetyPipeline, validateRecipe };
