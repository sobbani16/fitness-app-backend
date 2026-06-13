// Diet Adherence Engine
// Calculates how closely a user followed their weekly plan.

const { getPrisma } = require('../../lib/prisma');

function adherenceStatus(pct) {
  if (pct >= 85) return 'excellent';
  if (pct >= 70) return 'good';
  if (pct >= 50) return 'poor';
  return 'very_poor';
}

function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Calculate adherence for a given week.
 * @param {string} userId
 * @param {string} weekStartDate - YYYY-MM-DD (Monday)
 */
async function calculateAdherence(userId, weekStartDate) {
  const prisma = getPrisma();

  // Load the plan for this week
  const plan = await prisma.weeklyNutritionPlan.findUnique({
    where: { userId_weekStartDate: { userId, weekStartDate } },
    include: { meals: true },
  });

  if (!plan || !plan.meals.length) {
    return {
      adherencePercent: 0,
      status: 'very_poor',
      caloriesTarget: 0,
      caloriesActual: 0,
      proteinTarget: 0,
      proteinActual: 0,
      mealsPlanned: 0,
      mealsLogged: 0,
      explanation: 'No plan found for this week.',
    };
  }

  // Load actual food logs for the week (7 days from weekStartDate)
  const start = new Date(`${weekStartDate}T00:00:00.000Z`);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const foodLogs = await prisma.foodLog.findMany({
    where: { userId, loggedAt: { gte: start, lt: end } },
  });

  const mealsPlanned = plan.meals.length;
  const mealsLogged = foodLogs.length;

  // Sum planned macros
  const plannedCals = plan.meals.reduce((s, m) => s + m.calories, 0) / 7;
  const plannedProtein = plan.meals.reduce((s, m) => s + m.proteinG, 0) / 7;

  // Sum actual macros (daily avg)
  const actualCals = foodLogs.reduce((s, l) => s + (l.calories || 0), 0) / 7;
  const actualProtein = foodLogs.reduce((s, l) => s + (l.proteinG || 0), 0) / 7;

  // Adherence = how close actual is to planned (capped at 100%)
  const calAdherence = plannedCals > 0 ? Math.min(1, 1 - Math.abs(actualCals - plannedCals) / plannedCals) : 0;
  const protAdherence = plannedProtein > 0 ? Math.min(1, 1 - Math.abs(actualProtein - plannedProtein) / plannedProtein) : 0;
  const mealAdherence = mealsPlanned > 0 ? Math.min(1, mealsLogged / mealsPlanned) : 0;

  const adherencePercent = Math.round((calAdherence * 0.4 + protAdherence * 0.3 + mealAdherence * 0.3) * 100);
  const status = adherenceStatus(adherencePercent);

  let explanation;
  if (adherencePercent >= 85) {
    explanation = 'Great job! You closely followed your plan this week.';
  } else if (adherencePercent >= 70) {
    explanation = 'Good effort. Minor deviations from the plan.';
  } else if (adherencePercent >= 50) {
    explanation = 'Adherence was below target. Consider simpler meals next week.';
  } else {
    explanation = 'Significant deviation from the plan. Calories will not be adjusted.';
  }

  // Store
  const result = {
    adherencePercent,
    status,
    caloriesTarget: Math.round(plannedCals),
    caloriesActual: Math.round(actualCals),
    proteinTarget: Math.round(plannedProtein),
    proteinActual: Math.round(actualProtein),
    mealsPlanned,
    mealsLogged,
    explanation,
  };

  await prisma.dietAdherenceScore.upsert({
    where: { userId_weekStartDate: { userId, weekStartDate } },
    update: result,
    create: { userId, weekStartDate, ...result },
  });

  return result;
}

module.exports = { calculateAdherence, adherenceStatus };
