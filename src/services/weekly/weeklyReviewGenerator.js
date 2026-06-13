// Weekly Review Generator
// Produces end-of-week report with stats, result, and recommendations.

const { getPrisma } = require('../../lib/prisma');
const { detectDeficiencies } = require('./deficiencyDetector');

function overallResult(adherence, healthScore) {
  const avg = (adherence + healthScore) / 2;
  if (avg >= 85) return 'excellent';
  if (avg >= 70) return 'good';
  if (avg >= 55) return 'fair';
  return 'poor';
}

/**
 * Generate a weekly review for a completed plan.
 * @param {string} userId
 * @param {string} planId
 * @param {string} weekStartDate
 */
async function generateWeeklyReview(userId, planId, weekStartDate) {
  const prisma = getPrisma();

  const start = new Date(`${weekStartDate}T00:00:00.000Z`);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const endStr = end.toISOString().slice(0, 10);

  // Weight start/end
  const weights = await prisma.weightEntry.findMany({
    where: { userId, recordedAt: { gte: start, lt: end } },
    orderBy: { recordedAt: 'asc' },
  });
  const weightStart = weights.length > 0 ? weights[0].weightKg : null;
  const weightEnd = weights.length > 0 ? weights[weights.length - 1].weightKg : null;

  // Food logs averages
  const foodLogs = await prisma.foodLog.findMany({
    where: { userId, loggedAt: { gte: start, lt: end } },
  });
  const totalCals = foodLogs.reduce((s, l) => s + (l.calories || 0), 0);
  const totalProtein = foodLogs.reduce((s, l) => s + (l.proteinG || 0), 0);
  const daysWithLogs = new Set(foodLogs.map((l) => l.loggedAt.toISOString().slice(0, 10))).size || 1;
  const caloriesAvg = Math.round(totalCals / daysWithLogs);
  const proteinAvg = Math.round(totalProtein / daysWithLogs);

  // Health scores avg
  const healthScores = await prisma.healthScore.findMany({
    where: { userId, date: { gte: weekStartDate, lt: endStr } },
  });
  const healthScoreAvg = healthScores.length > 0
    ? Math.round(healthScores.reduce((s, h) => s + h.score, 0) / healthScores.length)
    : null;

  // Compliance (condition score avg)
  const compliancePercent = healthScores.length > 0
    ? Math.round(healthScores.reduce((s, h) => s + h.conditionScore, 0) / healthScores.length)
    : null;

  // Adherence
  const adherence = await prisma.dietAdherenceScore.findUnique({
    where: { userId_weekStartDate: { userId, weekStartDate } },
  });
  const adherencePercent = adherence?.adherencePercent ?? null;

  const result = overallResult(adherencePercent || 0, healthScoreAvg || 0);

  // Determine recommendation
  let recommendation = 'Maintain calories.';
  if (weightStart && weightEnd && weightEnd < weightStart - 0.3) {
    recommendation = 'Maintain calories. Weight loss is progressing well.';
  } else if (adherencePercent && adherencePercent < 70) {
    recommendation = 'Focus on adherence before adjusting calories.';
  }

  // Generate summary narrative
  const lines = [];
  if (weightStart && weightEnd) {
    lines.push(`Weight: ${weightStart.toFixed(1)}kg → ${weightEnd.toFixed(1)}kg`);
  }
  lines.push(`Calories: ${caloriesAvg} avg/day`);
  lines.push(`Protein: ${proteinAvg}g avg/day`);
  if (healthScoreAvg) lines.push(`Health Score: ${healthScoreAvg} avg`);
  if (compliancePercent) lines.push(`Disease Compliance: ${compliancePercent}%`);
  if (adherencePercent) lines.push(`Adherence: ${adherencePercent}%`);
  lines.push(`Result: ${result.charAt(0).toUpperCase() + result.slice(1)} progress.`);
  lines.push(`Recommendation: ${recommendation}`);

  const summary = lines.join('\n');

  // Store review
  const review = await prisma.weeklyReview.upsert({
    where: { planId },
    update: {
      weightStart, weightEnd, caloriesAvg, proteinAvg,
      healthScoreAvg, compliancePercent, adherencePercent,
      overallResult: result, recommendation, summary,
    },
    create: {
      planId, userId, weekStartDate,
      weightStart, weightEnd, caloriesAvg, proteinAvg,
      healthScoreAvg, compliancePercent, adherencePercent,
      overallResult: result, recommendation, summary,
    },
  });

  // Detect deficiencies and store as recommendations
  const deficiencies = await detectDeficiencies(userId, 14);
  if (deficiencies.length > 0) {
    await prisma.weeklyRecommendation.createMany({
      data: deficiencies.map((d) => ({
        reviewId: review.id,
        category: d.category,
        message: d.message,
        priority: d.priority,
      })),
    });
  }

  // Notification
  await prisma.notification.create({
    data: {
      userId,
      type: 'review_ready',
      title: 'Weekly Review Available',
      body: `Your weekly review for ${weekStartDate} is ready. ${result.charAt(0).toUpperCase() + result.slice(1)} progress!`,
    },
  });

  return { reviewId: review.id, result, summary, recommendations: deficiencies };
}

module.exports = { generateWeeklyReview };
