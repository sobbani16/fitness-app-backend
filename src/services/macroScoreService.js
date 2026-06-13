// Macro Score Engine
// Calculates daily macro performance score (0-100) for a user.
// Each macro (protein, carbs, fat, fiber) is scored individually, then combined.
//
// Scoring logic per macro:
//   100  = exactly at target
//   90+  = within ±10% of target (green)
//   70+  = within ±30% of target (yellow)
//   <70  = outside ±30% (red)
//
// Overall score = weighted average (protein 35%, carbs 25%, fat 20%, fiber 20%).

const { getPrisma } = require('../lib/prisma');

const WEIGHTS = { protein: 0.35, carbs: 0.25, fat: 0.20, fiber: 0.20 };

const DEFAULT_GOALS = {
  caloriesTarget: 2200,
  proteinTarget: 150,
  carbsTarget: 250,
  fatTarget: 70,
  fiberTarget: 30,
  waterMlTarget: 2000,
};

/**
 * Score a single macro. Returns 0-100.
 * @param {number} actual - Grams consumed.
 * @param {number} target - Grams target.
 * @returns {number} Score (0-100).
 */
function scoreMacro(actual, target) {
  if (target <= 0) return 100;
  const ratio = actual / target;
  // Perfect = 100, linear decay from 100% ratio
  // ±10% → 90+, ±30% → 70+, ±50% → 50, beyond → lower
  const deviation = Math.abs(1 - ratio);
  if (deviation <= 0.10) return Math.round(100 - deviation * 100);
  if (deviation <= 0.30) return Math.round(90 - (deviation - 0.10) * 100);
  if (deviation <= 0.50) return Math.round(70 - (deviation - 0.30) * 100);
  return Math.max(0, Math.round(50 - (deviation - 0.50) * 80));
}

/**
 * Get the traffic-light color for a score.
 */
function scoreColor(score) {
  if (score >= 80) return 'green';
  if (score >= 60) return 'yellow';
  return 'red';
}

/**
 * Get the status for actual vs target.
 * "on_track" | "low" | "high"
 */
function macroStatus(actual, target) {
  if (target <= 0) return 'on_track';
  const ratio = actual / target;
  if (ratio < 0.70) return 'low';
  if (ratio > 1.30) return 'high';
  return 'on_track';
}

/**
 * Generate a tip for a given macro's status.
 */
function macroTip(macroName, actual, target, status) {
  const diff = Math.abs(Math.round(target - actual));
  const tips = {
    protein: {
      low: `You need ${diff}g more protein. Try adding Greek yogurt, chicken breast, or a protein shake.`,
      high: `You're ${diff}g over your protein target. Consider lighter protein sources tomorrow.`,
      on_track: 'Protein intake is on track. Great job!',
    },
    carbs: {
      low: `${diff}g below carb target. Add some whole grains, fruit, or sweet potato.`,
      high: `${diff}g over carb target. Reduce carb intake for better progress.`,
      on_track: 'Carb intake is balanced. Keep it up!',
    },
    fat: {
      low: `${diff}g below fat target. Include healthy fats: avocado, nuts, olive oil.`,
      high: `${diff}g over fat target. Cut back on fried foods or heavy dressings.`,
      on_track: 'Fat intake is on point!',
    },
    fiber: {
      low: `${diff}g below fiber target. Add vegetables, beans, or oats.`,
      high: `${diff}g over fiber target — usually fine, but watch for digestive comfort.`,
      on_track: 'Fiber intake is solid!',
    },
  };
  return (tips[macroName] || {})[status] || '';
}

function isoDate(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function startOfDay(dateStr) {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function endOfDay(dateStr) {
  return new Date(`${dateStr}T23:59:59.999Z`);
}

/**
 * Get or create macro goals for a user.
 */
async function getGoals(userId) {
  const prisma = getPrisma();
  let goals = await prisma.macroGoal.findUnique({ where: { userId } });
  if (!goals) {
    goals = await prisma.macroGoal.create({ data: { userId, ...DEFAULT_GOALS } });
  }
  return goals;
}

/**
 * Update macro goals for a user.
 */
async function updateGoals(userId, updates) {
  const prisma = getPrisma();
  return prisma.macroGoal.upsert({
    where: { userId },
    update: { ...updates, source: updates.source || 'custom' },
    create: { userId, ...DEFAULT_GOALS, ...updates, source: updates.source || 'custom' },
  });
}

/**
 * Calculate the macro score for a user on a given date.
 * @param {string} userId
 * @param {string} [date] - YYYY-MM-DD, defaults to today.
 * @returns {Promise<object>} Full macro score breakdown.
 */
async function calculateScore(userId, date) {
  const prisma = getPrisma();
  const dateStr = date || isoDate();
  const goals = await getGoals(userId);

  // Sum today's food logs.
  const logs = await prisma.foodLog.findMany({
    where: {
      userId,
      loggedAt: { gte: startOfDay(dateStr), lte: endOfDay(dateStr) },
    },
  });

  const intake = logs.reduce(
    (acc, l) => {
      acc.calories += l.calories || 0;
      acc.proteinG += l.proteinG || 0;
      acc.carbsG += l.carbsG || 0;
      acc.fatG += l.fatG || 0;
      acc.fiberG += l.fiberG || 0;
      return acc;
    },
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  );

  // Sum water logs.
  const waterLogs = await prisma.waterLog.findMany({
    where: {
      userId,
      loggedAt: { gte: startOfDay(dateStr), lte: endOfDay(dateStr) },
    },
  });
  const waterMl = waterLogs.reduce((s, w) => s + (w.amountMl || 0), 0);

  // Score each macro.
  const proteinScore = scoreMacro(intake.proteinG, goals.proteinTarget);
  const carbsScore = scoreMacro(intake.carbsG, goals.carbsTarget);
  const fatScore = scoreMacro(intake.fatG, goals.fatTarget);
  const fiberScore = scoreMacro(intake.fiberG, goals.fiberTarget);
  const hydrationScore = scoreMacro(waterMl, goals.waterMlTarget);

  const overallScore = Math.round(
    proteinScore * WEIGHTS.protein +
    carbsScore * WEIGHTS.carbs +
    fatScore * WEIGHTS.fat +
    fiberScore * WEIGHTS.fiber,
  );

  // Build breakdown with colors and tips.
  const breakdown = {
    protein: {
      actual: Math.round(intake.proteinG * 10) / 10,
      target: goals.proteinTarget,
      score: proteinScore,
      color: scoreColor(proteinScore),
      status: macroStatus(intake.proteinG, goals.proteinTarget),
      tip: macroTip('protein', intake.proteinG, goals.proteinTarget, macroStatus(intake.proteinG, goals.proteinTarget)),
    },
    carbs: {
      actual: Math.round(intake.carbsG * 10) / 10,
      target: goals.carbsTarget,
      score: carbsScore,
      color: scoreColor(carbsScore),
      status: macroStatus(intake.carbsG, goals.carbsTarget),
      tip: macroTip('carbs', intake.carbsG, goals.carbsTarget, macroStatus(intake.carbsG, goals.carbsTarget)),
    },
    fat: {
      actual: Math.round(intake.fatG * 10) / 10,
      target: goals.fatTarget,
      score: fatScore,
      color: scoreColor(fatScore),
      status: macroStatus(intake.fatG, goals.fatTarget),
      tip: macroTip('fat', intake.fatG, goals.fatTarget, macroStatus(intake.fatG, goals.fatTarget)),
    },
    fiber: {
      actual: Math.round(intake.fiberG * 10) / 10,
      target: goals.fiberTarget,
      score: fiberScore,
      color: scoreColor(fiberScore),
      status: macroStatus(intake.fiberG, goals.fiberTarget),
      tip: macroTip('fiber', intake.fiberG, goals.fiberTarget, macroStatus(intake.fiberG, goals.fiberTarget)),
    },
  };

  const result = {
    date: dateStr,
    overallScore,
    overallColor: scoreColor(overallScore),
    calories: { actual: Math.round(intake.calories), target: goals.caloriesTarget },
    hydration: {
      actual: waterMl,
      target: goals.waterMlTarget,
      score: hydrationScore,
      color: scoreColor(hydrationScore),
    },
    breakdown,
    mealCount: logs.length,
  };

  // Cache the score.
  await prisma.dailyMacroScore.upsert({
    where: { userId_date: { userId, date: dateStr } },
    update: {
      overallScore, proteinScore, carbsScore, fatScore, fiberScore, hydrationScore,
      proteinG: intake.proteinG, carbsG: intake.carbsG, fatG: intake.fatG,
      fiberG: intake.fiberG, waterMl, calories: intake.calories,
    },
    create: {
      userId, date: dateStr,
      overallScore, proteinScore, carbsScore, fatScore, fiberScore, hydrationScore,
      proteinG: intake.proteinG, carbsG: intake.carbsG, fatG: intake.fatG,
      fiberG: intake.fiberG, waterMl, calories: intake.calories,
    },
  });

  return result;
}

/**
 * Get trend data over a period.
 * @param {string} userId
 * @param {number} days - Number of days to look back.
 * @returns {Promise<Array>} Array of daily scores, oldest first.
 */
async function getTrend(userId, days = 7) {
  const prisma = getPrisma();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = isoDate(since);

  const scores = await prisma.dailyMacroScore.findMany({
    where: { userId, date: { gte: sinceStr } },
    orderBy: { date: 'asc' },
  });

  return scores.map((s) => ({
    date: s.date,
    overallScore: s.overallScore,
    protein: s.proteinScore,
    carbs: s.carbsScore,
    fat: s.fatScore,
    fiber: s.fiberScore,
    hydration: s.hydrationScore,
    calories: s.calories,
  }));
}

module.exports = {
  scoreMacro,
  scoreColor,
  macroStatus,
  macroTip,
  getGoals,
  updateGoals,
  calculateScore,
  getTrend,
};
