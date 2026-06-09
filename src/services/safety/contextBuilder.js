// Context Builder — assembles the full user context for Leo's recommendations.
// This is loaded before any recommendation is generated.

const { getPrisma } = require('../../lib/prisma');

/**
 * Build the full context for a user's recommendation request.
 * @param {string} userId
 * @returns {Promise<object>} Full user context for the recommendation engine.
 */
async function buildUserContext(userId) {
  const prisma = getPrisma();

  // Load all relevant user data in parallel.
  const [
    healthConditions,
    allergies,
    supplements,
    recentMeals,
    recentWorkouts,
    waterLogs,
    sleepLogs,
    weightEntries,
  ] = await Promise.all([
    prisma.userHealthCondition.findMany({
      where: { userId, active: true },
      include: { condition: true },
    }),
    prisma.userAllergy.findMany({
      where: { userId },
      include: { allergy: true },
    }),
    prisma.userSupplement.findMany({
      where: { userId },
      include: { supplement: true },
    }),
    prisma.foodLog.findMany({
      where: { userId, loggedAt: { gte: startOfToday() } },
      orderBy: { loggedAt: 'desc' },
    }),
    prisma.workoutSession.findMany({
      where: { userId, startedAt: { gte: startOfToday() } },
    }),
    prisma.waterLog.findMany({
      where: { userId, loggedAt: { gte: startOfToday() } },
    }),
    prisma.sleepLog.findMany({
      where: { userId, sleepEnd: { gte: yesterday() } },
      orderBy: { sleepEnd: 'desc' },
      take: 1,
    }),
    prisma.weightEntry.findMany({
      where: { userId },
      orderBy: { recordedAt: 'desc' },
      take: 1,
    }),
  ]);

  // Compute today's totals.
  const todayCalories = recentMeals.reduce((sum, m) => sum + (m.calories || 0), 0);
  const todayProtein = recentMeals.reduce((sum, m) => sum + (m.proteinG || 0), 0);
  const todayCarbs = recentMeals.reduce((sum, m) => sum + (m.carbsG || 0), 0);
  const todayFat = recentMeals.reduce((sum, m) => sum + (m.fatG || 0), 0);
  const todayWaterMl = waterLogs.reduce((sum, w) => sum + (w.amountMl || 0), 0);
  const workoutCompleted = recentWorkouts.length > 0;
  const caloriesBurned = recentWorkouts.reduce((sum, w) => sum + (w.caloriesBurned || 0), 0);
  const lastSleep = sleepLogs[0] || null;
  const currentWeight = weightEntries[0]?.weightKg || null;

  // Compute recovery score (0-100) based on sleep and workout load.
  const recoveryScore = computeRecoveryScore(lastSleep, recentWorkouts);

  // Determine time of day.
  const hour = new Date().getHours();
  let timeOfDay = 'morning';
  if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
  else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
  else if (hour >= 21) timeOfDay = 'night';

  return {
    userId,
    conditions: healthConditions.map((hc) => hc.condition.name),
    allergies: allergies.map((a) => a.allergy.name),
    supplements: supplements.map((us) => ({
      id: us.supplement.id,
      name: us.supplement.name,
      calories: us.supplement.calories,
      proteinG: us.supplement.proteinG,
    })),
    today: {
      calories: todayCalories,
      proteinG: todayProtein,
      carbsG: todayCarbs,
      fatG: todayFat,
      waterMl: todayWaterMl,
      mealCount: recentMeals.length,
      workoutCompleted,
      caloriesBurned,
    },
    recovery: {
      score: recoveryScore,
      lastSleepHours: lastSleep?.hoursSlept || null,
      lastSleepScore: lastSleep?.sleepScore || null,
    },
    currentWeight,
    timeOfDay,
  };
}

function computeRecoveryScore(sleep, workouts) {
  let score = 70; // baseline
  if (sleep) {
    const hours = sleep.hoursSlept || 0;
    if (hours >= 7) score += 20;
    else if (hours >= 6) score += 10;
    else score -= 10;
    if (sleep.sleepScore) score += (sleep.sleepScore - 50) / 5;
  }
  // Heavy workout load reduces recovery.
  const totalMinutes = workouts.reduce((s, w) => s + (w.durationMinutes || 0), 0);
  if (totalMinutes > 90) score -= 15;
  else if (totalMinutes > 60) score -= 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

module.exports = { buildUserContext };
