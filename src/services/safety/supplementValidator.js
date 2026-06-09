// Supplement Safety Validator
// Checks supplements against a user's conditions and timing rules.

const { getPrisma } = require('../../lib/prisma');

/**
 * Validate a list of supplements against a user's health conditions.
 * @param {string} userId
 * @param {Array<{name: string, supplementId?: string}>} supplements
 * @returns {Promise<{safe: boolean, safetyScore: number, violations: Array, timingWarnings: Array}>}
 */
async function validateSupplements(userId, supplements) {
  const prisma = getPrisma();

  // Load user's active conditions.
  const userConditions = await prisma.userHealthCondition.findMany({
    where: { userId, active: true },
    include: { condition: { include: { conditionRules: true } } },
  });

  // Build condition rules targeting supplements.
  const conditionRules = [];
  for (const uc of userConditions) {
    for (const rule of uc.condition.conditionRules) {
      if (rule.target === 'supplement') {
        conditionRules.push({ ...rule, conditionName: uc.condition.name });
      }
    }
  }

  const violations = [];
  const timingWarnings = [];

  for (const supp of supplements) {
    if (!supp.supplementId) continue;

    // Load supplement attributes.
    const attrs = await prisma.supplementAttribute.findMany({
      where: { supplementId: supp.supplementId },
    });
    const attrSet = attrs.map((a) => a.attribute);

    // Check condition rules against supplement attributes.
    for (const rule of conditionRules) {
      if (attrSet.includes(rule.attribute)) {
        violations.push({
          entityType: 'supplement',
          entityName: supp.name,
          attribute: rule.attribute,
          conditionName: rule.conditionName,
          severity: rule.action,
          reason: rule.reason,
        });
      }
    }

    // Load supplement-specific rules (timing/interactions).
    const suppRules = await prisma.supplementRule.findMany({
      where: { supplementId: supp.supplementId },
      include: { condition: true },
    });

    for (const sr of suppRules) {
      // If the rule is condition-specific, check if user has that condition.
      if (sr.conditionId) {
        const hasCondition = userConditions.some((uc) => uc.conditionId === sr.conditionId);
        if (!hasCondition) continue;
      }
      timingWarnings.push({
        supplement: supp.name,
        ruleType: sr.ruleType,
        description: sr.description,
        gapHours: sr.gapHours,
        conflictsWith: sr.conflictsWith,
      });
    }
  }

  const blocks = violations.filter((v) => v.severity === 'block');
  const warns = violations.filter((v) => v.severity === 'warn');
  const safetyScore = Math.max(0, 100 - blocks.length * 25 - warns.length * 10);

  return {
    safe: blocks.length === 0,
    safetyScore,
    violations,
    timingWarnings,
  };
}

module.exports = { validateSupplements };
