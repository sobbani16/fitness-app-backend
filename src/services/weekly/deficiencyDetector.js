// Deficiency Detection Engine
// Analyzes past weeks to detect consistent nutritional gaps.

const { getPrisma } = require('../../lib/prisma');

/**
 * Detect nutritional deficiencies over the past N days.
 * @param {string} userId
 * @param {number} days
 * @returns {Promise<Array<{category: string, message: string, priority: number}>>}
 */
async function detectDeficiencies(userId, days = 14) {
  const prisma = getPrisma();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const goals = await prisma.macroGoal.findUnique({ where: { userId } });
  const targets = goals || { proteinTarget: 150, carbsTarget: 250, fatTarget: 70, fiberTarget: 30, waterMlTarget: 2000 };

  // Get daily macro scores for the period
  const scores = await prisma.dailyMacroScore.findMany({
    where: { userId, date: { gte: since.toISOString().slice(0, 10) } },
    orderBy: { date: 'asc' },
  });

  if (scores.length < 3) return [];

  const recommendations = [];
  const avgProtein = scores.reduce((s, d) => s + d.proteinG, 0) / scores.length;
  const avgFiber = scores.reduce((s, d) => s + d.fiberG, 0) / scores.length;
  const avgWater = scores.reduce((s, d) => s + d.waterMl, 0) / scores.length;
  const avgCarbs = scores.reduce((s, d) => s + d.carbsG, 0) / scores.length;

  if (avgProtein < targets.proteinTarget * 0.75) {
    const deficit = Math.round(targets.proteinTarget - avgProtein);
    recommendations.push({
      category: 'protein',
      message: `Increase protein by ${deficit}g daily. You've averaged ${Math.round(avgProtein)}g vs ${targets.proteinTarget}g target.`,
      priority: 1,
    });
  }

  if (avgFiber < targets.fiberTarget * 0.7) {
    const deficit = Math.round(targets.fiberTarget - avgFiber);
    recommendations.push({
      category: 'fiber',
      message: `Increase fiber by ${deficit}g daily. Add vegetables to lunch and dinner.`,
      priority: 2,
    });
  }

  if (avgWater < targets.waterMlTarget * 0.6) {
    recommendations.push({
      category: 'hydration',
      message: `Poor hydration detected. You've averaged ${Math.round(avgWater)}ml vs ${targets.waterMlTarget}ml goal.`,
      priority: 2,
    });
  }

  if (avgCarbs > targets.carbsTarget * 1.3) {
    recommendations.push({
      category: 'carbs',
      message: `Consistently over carb target. Average ${Math.round(avgCarbs)}g vs ${targets.carbsTarget}g.`,
      priority: 3,
    });
  }

  // Check adherence trend
  const adherenceScores = await prisma.dietAdherenceScore.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 4,
  });

  if (adherenceScores.length >= 2) {
    const avgAdherence = adherenceScores.reduce((s, a) => s + a.adherencePercent, 0) / adherenceScores.length;
    if (avgAdherence < 60) {
      recommendations.push({
        category: 'adherence',
        message: `Meal adherence has been low (${Math.round(avgAdherence)}%). Try simpler meals that are easier to follow.`,
        priority: 1,
      });
    }
  }

  return recommendations.sort((a, b) => a.priority - b.priority);
}

module.exports = { detectDeficiencies };
