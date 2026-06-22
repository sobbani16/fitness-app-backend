// Leo Health Score Engine
// Explainable, 5-component scoring system.
//
// Formula (configurable weights):
//   Macro Adherence:      40%
//   Condition Compliance: 30%
//   Food Quality:         15%
//   Activity Balance:     10%
//   Recovery:             5%
//
// Each component produces: score (0-100) + contributors + insights.

const { getPrisma } = require('../lib/prisma');
const { scoreMacro } = require('./macroScoreService');

const WEIGHTS = {
  macro: 0.40,
  condition: 0.30,
  foodQuality: 0.15,
  activity: 0.10,
  recovery: 0.05,
};

function statusFromScore(score) {
  if (score >= 90) return 'elite';
  if (score >= 80) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 60) return 'fair';
  return 'needs_attention';
}

function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Convert a local calendar date (YYYY-MM-DD) to the start/end UTC timestamps
// so logs stored in UTC line up with the user's local day. This matches the
// simulator/Mac environment where the device and server share a timezone.
function startOfDay(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d, 0, 0, 0, 0);
}
function endOfDay(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d, 23, 59, 59, 999);
}

// ============================================================================
// COMPONENT 1: MACRO ADHERENCE (40%)
// ============================================================================
async function scoreMacroAdherence(userId, dateStr, prisma) {
  const goals = await prisma.macroGoal.findUnique({ where: { userId } });
  const targets = goals || { proteinTarget: 150, carbsTarget: 250, fatTarget: 70, fiberTarget: 30 };

  const logs = await prisma.foodLog.findMany({
    where: { userId, loggedAt: { gte: startOfDay(dateStr), lte: endOfDay(dateStr) } },
  });

  const supplementLogs = await prisma.supplementLog.findMany({
    where: { userId, date: dateStr },
  });

  const intake = logs.reduce(
    (a, l) => ({ protein: a.protein + l.proteinG, carbs: a.carbs + l.carbsG, fat: a.fat + l.fatG, fiber: a.fiber + l.fiberG }),
    { protein: 0, carbs: 0, fat: 0, fiber: 0 },
  );

  for (const s of supplementLogs) {
    intake.protein += s.proteinG;
    intake.carbs += s.carbsG;
    intake.fat += s.fatG;
    intake.fiber += s.fiberG;
  }

  const pScore = scoreMacro(intake.protein, targets.proteinTarget);
  const cScore = scoreMacro(intake.carbs, targets.carbsTarget);
  const fScore = scoreMacro(intake.fat, targets.fatTarget);
  const fiScore = scoreMacro(intake.fiber, targets.fiberTarget);

  const score = Math.round(pScore * 0.35 + cScore * 0.25 + fScore * 0.20 + fiScore * 0.20);

  const contributors = [];
  const insights = [];

  // Protein contributors
  if (intake.protein >= targets.proteinTarget * 0.9) {
    contributors.push({ category: 'macro', itemName: 'Protein Goal', scoreImpact: 10, reason: 'Protein target achieved' });
  } else {
    const deficit = Math.round(targets.proteinTarget - intake.protein);
    contributors.push({ category: 'macro', itemName: 'Protein Goal', scoreImpact: -Math.min(15, Math.round(deficit / 5)), reason: `You are ${deficit}g short of your protein goal` });
    insights.push({ message: `Your protein intake is below target by ${deficit}g.`, severity: deficit > 40 ? 'critical' : 'warning' });
  }

  // Carbs contributors
  if (intake.carbs > targets.carbsTarget * 1.3) {
    const excess = Math.round(intake.carbs - targets.carbsTarget);
    contributors.push({ category: 'macro', itemName: 'Carb Excess', scoreImpact: -Math.min(12, Math.round(excess / 10)), reason: `You exceeded your carb target by ${excess}g` });
    insights.push({ message: `You exceeded your carb target today.`, severity: 'warning' });
  } else if (intake.carbs >= targets.carbsTarget * 0.7) {
    contributors.push({ category: 'macro', itemName: 'Carb Balance', scoreImpact: 5, reason: 'Carb intake within target range' });
  }

  // Fiber
  if (intake.fiber >= targets.fiberTarget * 0.9) {
    contributors.push({ category: 'macro', itemName: 'Fiber Goal', scoreImpact: 8, reason: 'Fiber intake within optimal range' });
  } else {
    contributors.push({ category: 'macro', itemName: 'Fiber Goal', scoreImpact: -5, reason: `Fiber intake below target` });
  }

  // Fat
  if (intake.fat > targets.fatTarget * 1.3) {
    contributors.push({ category: 'macro', itemName: 'Fat Excess', scoreImpact: -8, reason: `Fat intake exceeds target` });
  }

  // Top food contributors
  const allEntries = [...logs, ...supplementLogs.map((s) => ({ foodName: s.supplementName, proteinG: s.proteinG }))];
  const sorted = allEntries.sort((a, b) => b.proteinG - a.proteinG);
  for (const log of sorted.slice(0, 3)) {
    if (log.proteinG > 15) {
      contributors.push({ category: 'macro', itemName: log.foodName, scoreImpact: Math.round(log.proteinG / 5), reason: 'Helped protein target' });
    }
  }

  return { score, contributors, insights, intake, targets };
}

// ============================================================================
// COMPONENT 2: CONDITION COMPLIANCE (30%)
// ============================================================================
async function scoreConditionCompliance(userId, dateStr, prisma) {
  const userConditions = await prisma.userHealthCondition.findMany({
    where: { userId, active: true },
    include: { condition: { include: { conditionRules: true } } },
  });

  if (!userConditions.length) {
    return { score: 100, contributors: [], insights: [] };
  }

  const logs = await prisma.foodLog.findMany({
    where: { userId, loggedAt: { gte: startOfDay(dateStr), lte: endOfDay(dateStr) } },
  });

  // Load attributes for all ingredients the user has
  const allIngredients = await prisma.ingredient.findMany({
    include: { attributes: true },
  });
  const attrMap = {};
  for (const ing of allIngredients) {
    attrMap[ing.name.toLowerCase()] = ing.attributes.map((a) => a.attribute);
  }

  let penalties = 0;
  const contributors = [];
  const insights = [];

  for (const uc of userConditions) {
    const rules = uc.condition.conditionRules.filter((r) => r.target === 'ingredient');
    for (const log of logs) {
      const attrs = attrMap[log.foodName.toLowerCase()] || [];
      for (const rule of rules) {
        if (attrs.includes(rule.attribute)) {
          const impact = rule.action === 'block' ? -15 : -8;
          penalties += Math.abs(impact);
          contributors.push({
            category: 'condition',
            itemName: log.foodName,
            scoreImpact: impact,
            reason: rule.reason || `Not ideal for ${uc.condition.name}`,
          });
          if (rule.action === 'block') {
            insights.push({
              message: `You consumed foods that are not ideal for ${uc.condition.name}.`,
              severity: 'critical',
            });
          }
        }
      }
    }
  }

  // Positive: if user ate condition-friendly foods
  const highProteinCount = logs.filter((l) => l.proteinG > 20).length;
  if (highProteinCount >= 2) {
    contributors.push({ category: 'condition', itemName: 'High Protein Meals', scoreImpact: 10, reason: 'Consistent high-protein meals support metabolic health' });
  }

  const vegetableCount = logs.filter((l) => {
    const attrs = attrMap[l.foodName.toLowerCase()] || [];
    return attrs.includes('VEGETARIAN') || attrs.includes('GOITROGENIC') || l.fiberG > 3;
  }).length;
  if (vegetableCount >= 2) {
    contributors.push({ category: 'condition', itemName: 'Vegetables', scoreImpact: 8, reason: 'Vegetable intake supports condition management' });
  }

  const score = Math.max(0, Math.min(100, 100 - penalties));
  return { score, contributors, insights };
}

// ============================================================================
// COMPONENT 3: FOOD QUALITY (15%)
// ============================================================================
async function scoreFoodQuality(userId, dateStr, prisma) {
  const logs = await prisma.foodLog.findMany({
    where: { userId, loggedAt: { gte: startOfDay(dateStr), lte: endOfDay(dateStr) } },
  });

  if (!logs.length) return { score: 50, contributors: [], insights: [] };

  const contributors = [];
  let qualityPoints = 0;
  let totalItems = logs.length;

  for (const log of logs) {
    const name = log.foodName.toLowerCase();
    // Simple heuristic: high protein + low sugar = quality, processed/sugar = bad
    if (log.proteinG > 15 && log.carbsG < log.proteinG) {
      qualityPoints += 1;
      if (log.proteinG > 25) {
        contributors.push({ category: 'food_quality', itemName: log.foodName, scoreImpact: 5, reason: 'High-quality protein source' });
      }
    } else if (log.carbsG > 50 && log.fiberG < 2) {
      qualityPoints -= 1;
      contributors.push({ category: 'food_quality', itemName: log.foodName, scoreImpact: -10, reason: 'High sugar/refined carb food reduced score' });
    } else {
      qualityPoints += 0.5;
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(50 + (qualityPoints / totalItems) * 50)));
  const insights = [];
  if (score < 60) {
    insights.push({ message: 'Food quality is low today. Choose whole foods over processed options.', severity: 'warning' });
  }

  return { score, contributors, insights };
}

// ============================================================================
// COMPONENT 4: ACTIVITY BALANCE (10%)
// ============================================================================
async function scoreActivity(userId, dateStr, prisma) {
  const workouts = await prisma.workoutSession.findMany({
    where: { userId, startedAt: { gte: startOfDay(dateStr), lte: endOfDay(dateStr) } },
  });

  const stepsRecord = await prisma.dailySteps.findFirst({
    where: { userId, date: startOfDay(dateStr) },
  });
  const steps = stepsRecord?.steps || 0;

  const totalMinutes = workouts.reduce((s, w) => s + (w.durationMinutes || 0), 0);
  const contributors = [];
  const insights = [];

  let score;
  if (totalMinutes >= 30) {
    score = 100;
    contributors.push({ category: 'activity', itemName: 'Workout Completed', scoreImpact: 10, reason: `${totalMinutes} min of activity today` });
  } else if (totalMinutes > 0) {
    score = 60 + Math.round((totalMinutes / 30) * 40);
    contributors.push({ category: 'activity', itemName: 'Light Activity', scoreImpact: 5, reason: `${totalMinutes} min logged — aim for 30+` });
  } else if (steps >= 6000) {
    score = 80 + Math.min(20, Math.round((steps - 6000) / 200));
    contributors.push({ category: 'activity', itemName: 'Steps', scoreImpact: 6, reason: `${steps.toLocaleString()} steps today` });
  } else if (steps > 0) {
    score = 40 + Math.round((steps / 6000) * 40);
    contributors.push({ category: 'activity', itemName: 'Steps', scoreImpact: 3, reason: `${steps.toLocaleString()} steps — aim for 6,000+` });
  } else {
    score = 40;
    contributors.push({ category: 'activity', itemName: 'No Activity', scoreImpact: -5, reason: 'No workout or steps logged today' });
    insights.push({ message: 'No activity logged today. A 30-minute walk can boost your score.', severity: 'info' });
  }

  return { score, contributors, insights };
}

// ============================================================================
// COMPONENT 5: RECOVERY (5%)
// ============================================================================
async function scoreRecovery(userId, dateStr, prisma) {
  const yesterday = new Date(dateStr);
  yesterday.setDate(yesterday.getDate() - 1);

  const sleep = await prisma.sleepLog.findMany({
    where: { userId, sleepEnd: { gte: startOfDay(isoDate(yesterday)), lte: endOfDay(dateStr) } },
    orderBy: { sleepEnd: 'desc' },
    take: 1,
  });

  const waterLogs = await prisma.waterLog.findMany({
    where: { userId, loggedAt: { gte: startOfDay(dateStr), lte: endOfDay(dateStr) } },
  });
  const waterMl = waterLogs.reduce((s, w) => s + (w.amountMl || 0), 0);
  const goals = await prisma.macroGoal.findUnique({ where: { userId } });
  const waterTarget = goals?.waterMlTarget || 2000;

  const contributors = [];
  const insights = [];
  let sleepScore = 70;
  let waterScore = 70;

  if (sleep.length > 0) {
    const hours = sleep[0].hoursSlept || 0;
    if (hours >= 7) {
      sleepScore = 95;
      contributors.push({ category: 'recovery', itemName: 'Sleep', scoreImpact: 5, reason: `${hours.toFixed(1)}h sleep — optimal recovery` });
    } else if (hours >= 6) {
      sleepScore = 75;
      contributors.push({ category: 'recovery', itemName: 'Sleep', scoreImpact: 2, reason: `${hours.toFixed(1)}h sleep — adequate` });
    } else {
      sleepScore = 45;
      contributors.push({ category: 'recovery', itemName: 'Poor Sleep', scoreImpact: -5, reason: `Only ${hours.toFixed(1)}h sleep — recovery impaired` });
      insights.push({ message: 'Sleep was below 6 hours. Recovery score is reduced.', severity: 'warning' });
    }
  }

  if (waterMl >= waterTarget * 0.9) {
    waterScore = 95;
    contributors.push({ category: 'recovery', itemName: 'Hydration', scoreImpact: 4, reason: `${waterMl}ml water — well hydrated` });
  } else if (waterMl >= waterTarget * 0.5) {
    waterScore = 70;
    contributors.push({ category: 'recovery', itemName: 'Hydration', scoreImpact: 1, reason: `${waterMl}ml water — keep drinking` });
  } else {
    waterScore = 45;
    const diff = waterTarget - waterMl;
    contributors.push({ category: 'recovery', itemName: 'Hydration', scoreImpact: -3, reason: `${waterMl}ml water — ${diff}ml below target` });
    insights.push({ message: `Water intake is below target by ${diff}ml.`, severity: 'warning' });
  }

  const score = Math.round((sleepScore + waterScore) / 2);

  return { score, contributors, insights };
}

// ============================================================================
// MAIN ENTRY: Calculate full Health Score
// ============================================================================
async function calculateHealthScore(userId, date) {
  const prisma = getPrisma();
  const dateStr = date || isoDate();

  const [macro, condition, quality, activity, recovery] = await Promise.all([
    scoreMacroAdherence(userId, dateStr, prisma),
    scoreConditionCompliance(userId, dateStr, prisma),
    scoreFoodQuality(userId, dateStr, prisma),
    scoreActivity(userId, dateStr, prisma),
    scoreRecovery(userId, dateStr, prisma),
  ]);

  const overallScore = Math.round(
    macro.score * WEIGHTS.macro +
    condition.score * WEIGHTS.condition +
    quality.score * WEIGHTS.foodQuality +
    activity.score * WEIGHTS.activity +
    recovery.score * WEIGHTS.recovery,
  );

  const allContributors = [
    ...macro.contributors,
    ...condition.contributors,
    ...quality.contributors,
    ...activity.contributors,
    ...recovery.contributors,
  ];

  const allInsights = [
    ...macro.insights,
    ...condition.insights,
    ...quality.insights,
    ...activity.insights,
    ...recovery.insights,
  ];

  const status = statusFromScore(overallScore);

  // Persist to DB
  const existing = await prisma.healthScore.findUnique({
    where: { userId_date: { userId, date: dateStr } },
  });

  let healthScore;
  if (existing) {
    // Delete old contributors/insights, then update
    await prisma.scoreContributor.deleteMany({ where: { healthScoreId: existing.id } });
    await prisma.healthScoreInsight.deleteMany({ where: { healthScoreId: existing.id } });
    healthScore = await prisma.healthScore.update({
      where: { id: existing.id },
      data: {
        score: overallScore,
        status,
        macroScore: macro.score,
        conditionScore: condition.score,
        foodQualityScore: quality.score,
        activityScore: activity.score,
        recoveryScore: recovery.score,
      },
    });
  } else {
    healthScore = await prisma.healthScore.create({
      data: {
        userId,
        date: dateStr,
        score: overallScore,
        status,
        macroScore: macro.score,
        conditionScore: condition.score,
        foodQualityScore: quality.score,
        activityScore: activity.score,
        recoveryScore: recovery.score,
      },
    });
  }

  // Store contributors and insights
  if (allContributors.length > 0) {
    await prisma.scoreContributor.createMany({
      data: allContributors.map((c) => ({ healthScoreId: healthScore.id, ...c })),
    });
  }
  if (allInsights.length > 0) {
    await prisma.healthScoreInsight.createMany({
      data: allInsights.map((i) => ({ healthScoreId: healthScore.id, ...i })),
    });
  }

  // Top 3 contributors (sorted by absolute impact)
  const topContributors = [...allContributors]
    .sort((a, b) => Math.abs(b.scoreImpact) - Math.abs(a.scoreImpact))
    .slice(0, 5);

  return {
    id: healthScore.id,
    date: dateStr,
    score: overallScore,
    status,
    components: {
      macro: { score: macro.score, weight: WEIGHTS.macro },
      condition: { score: condition.score, weight: WEIGHTS.condition },
      foodQuality: { score: quality.score, weight: WEIGHTS.foodQuality },
      activity: { score: activity.score, weight: WEIGHTS.activity },
      recovery: { score: recovery.score, weight: WEIGHTS.recovery },
    },
    topContributors,
    insights: allInsights,
    allContributors,
  };
}

// ============================================================================
// ACTION ENGINE: Ranked improvement suggestions
// ============================================================================
async function getImprovementActions(userId, date) {
  const prisma = getPrisma();
  const dateStr = date || isoDate();

  const goals = await prisma.macroGoal.findUnique({ where: { userId } });
  const targets = goals || { proteinTarget: 150, carbsTarget: 250, fatTarget: 70, fiberTarget: 30, waterMlTarget: 2000 };

  const logs = await prisma.foodLog.findMany({
    where: { userId, loggedAt: { gte: startOfDay(dateStr), lte: endOfDay(dateStr) } },
  });
  const waterLogs = await prisma.waterLog.findMany({
    where: { userId, loggedAt: { gte: startOfDay(dateStr), lte: endOfDay(dateStr) } },
  });

  const intake = logs.reduce(
    (a, l) => ({ protein: a.protein + l.proteinG, carbs: a.carbs + l.carbsG, fat: a.fat + l.fatG, fiber: a.fiber + l.fiberG }),
    { protein: 0, carbs: 0, fat: 0, fiber: 0 },
  );
  const waterMl = waterLogs.reduce((s, w) => s + (w.amountMl || 0), 0);

  const actions = [];

  // Protein
  if (intake.protein < targets.proteinTarget * 0.8) {
    const diff = Math.round(targets.proteinTarget - intake.protein);
    actions.push({
      action: `Add ${diff}g more protein`,
      suggestion: 'Try Greek yogurt, chicken breast, or a protein shake.',
      potentialGain: Math.min(8, Math.round(diff / 5)),
      priority: 1,
    });
  }

  // Water
  if (waterMl < targets.waterMlTarget * 0.6) {
    const diff = targets.waterMlTarget - waterMl;
    actions.push({
      action: `Drink ${diff}ml more water`,
      suggestion: `${Math.round(diff / 250)} more glasses today.`,
      potentialGain: 4,
      priority: 2,
    });
  }

  // Activity
  const workouts = await prisma.workoutSession.findMany({
    where: { userId, startedAt: { gte: startOfDay(dateStr), lte: endOfDay(dateStr) } },
  });
  if (workouts.length === 0) {
    actions.push({
      action: 'Walk 30 minutes',
      suggestion: 'Even a light walk improves your activity score significantly.',
      potentialGain: 5,
      priority: 3,
    });
  }

  // Fiber
  if (intake.fiber < targets.fiberTarget * 0.7) {
    const diff = Math.round(targets.fiberTarget - intake.fiber);
    actions.push({
      action: `Increase fiber intake by ${diff}g`,
      suggestion: 'Add vegetables, beans, or oats to your next meal.',
      potentialGain: 3,
      priority: 4,
    });
  }

  // Excess carbs
  if (intake.carbs > targets.carbsTarget * 1.3) {
    actions.push({
      action: 'Replace sugary snacks with Greek yogurt',
      suggestion: 'Swap refined carbs for protein-rich alternatives.',
      potentialGain: 6,
      priority: 2,
    });
  }

  // Sort by potential gain descending
  actions.sort((a, b) => b.potentialGain - a.potentialGain);

  const totalPotentialGain = actions.reduce((s, a) => s + a.potentialGain, 0);

  return { actions, totalPotentialGain };
}

// ============================================================================
// TREND
// ============================================================================
async function getHealthScoreTrend(userId, days = 7) {
  const prisma = getPrisma();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = isoDate(since);

  return prisma.healthScore.findMany({
    where: { userId, date: { gte: sinceStr } },
    orderBy: { date: 'asc' },
    select: {
      date: true,
      score: true,
      status: true,
      macroScore: true,
      conditionScore: true,
      foodQualityScore: true,
      activityScore: true,
      recoveryScore: true,
    },
  });
}

module.exports = {
  calculateHealthScore,
  getImprovementActions,
  getHealthScoreTrend,
  statusFromScore,
  WEIGHTS,
};
