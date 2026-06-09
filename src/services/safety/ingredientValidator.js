// Ingredient Safety Validator
// Checks ingredients against a user's health conditions and returns violations.

const { getPrisma } = require('../../lib/prisma');

/**
 * Validate a list of ingredients against a user's health conditions.
 * @param {string} userId
 * @param {Array<{name: string, ingredientId?: string}>} ingredients
 * @returns {Promise<{safe: boolean, safetyScore: number, violations: Array}>}
 */
async function validateIngredients(userId, ingredients) {
  const prisma = getPrisma();

  // Load user's active conditions.
  const userConditions = await prisma.userHealthCondition.findMany({
    where: { userId, active: true },
    include: { condition: { include: { conditionRules: true } } },
  });

  if (!userConditions.length) {
    return { safe: true, safetyScore: 100, violations: [] };
  }

  // Build a set of condition rules targeting ingredients.
  const rules = [];
  for (const uc of userConditions) {
    for (const rule of uc.condition.conditionRules) {
      if (rule.target === 'ingredient') {
        rules.push({ ...rule, conditionName: uc.condition.name });
      }
    }
  }

  if (!rules.length) {
    return { safe: true, safetyScore: 100, violations: [] };
  }

  // Load attributes for each ingredient.
  const violations = [];
  for (const ing of ingredients) {
    let attrs = [];
    if (ing.ingredientId) {
      const rows = await prisma.ingredientAttribute.findMany({
        where: { ingredientId: ing.ingredientId },
      });
      attrs = rows.map((r) => r.attribute);
    }

    // Check each rule against the ingredient's attributes.
    for (const rule of rules) {
      if (attrs.includes(rule.attribute)) {
        violations.push({
          entityType: 'ingredient',
          entityName: ing.name,
          attribute: rule.attribute,
          conditionName: rule.conditionName,
          severity: rule.action,
          reason: rule.reason,
        });
      }
    }
  }

  const blocks = violations.filter((v) => v.severity === 'block');
  const warns = violations.filter((v) => v.severity === 'warn');
  const safetyScore = Math.max(0, 100 - blocks.length * 25 - warns.length * 10);

  return {
    safe: blocks.length === 0,
    safetyScore,
    violations,
  };
}

module.exports = { validateIngredients };
