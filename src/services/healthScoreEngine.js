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
const { dayRangeUtc, resolveZone } = require('./localDay');
const { BY_KEY } = require('./nutrientCatalog');

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
// Fallback macro targets when a user has no MacroGoal: FDA Daily Values, the
// same basis score-v2 falls back to — never the old hardcoded demo values.
function fallbackTargets() {
  return {
    proteinTarget: BY_KEY.proteinG.referenceIntake,
    carbsTarget: BY_KEY.carbsG.referenceIntake,
    fatTarget: BY_KEY.fatG.referenceIntake,
    fiberTarget: BY_KEY.fiberG.referenceIntake,
    waterMlTarget: 2000, // product default — not a clinical target
  };
}
// UTC bounds of the user's LOCAL calendar day — never the server's timezone.
function dayWindow(dateStr, tz) {
  const { startUtc, endUtc } = dayRangeUtc(dateStr, tz);
  return { start: startUtc, end: endUtc };
}
async function userTz(prisma, userId) {
  const u = await prisma.user?.findUnique({ where: { id: userId }, select: { timeZone: true } }).catch(() => null);
  return resolveZone(u?.timeZone);
}

// ============================================================================
// COMPONENT 1: MACRO ADHERENCE (40%)
// ============================================================================
async function scoreMacroAdherence(userId, dateStr, prisma, tz) {
  const goals = await prisma.macroGoal.findUnique({ where: { userId } });
  const targets = goals || fallbackTargets();
  const win = dayWindow(dateStr, tz);

  const logs = await prisma.foodLog.findMany({
    where: { userId, loggedAt: { gte: win.start, lt: win.end } },
  });

  const supplementLogs = await prisma.supplementLog.findMany({
    where: { userId, date: dateStr },
  });

  // Missing logs are not zero intake — without food records there is no
  // measurable adherence, so the component reports unavailable.
  if (!logs.length && !supplementLogs.length) {
    return { score: null, available: false, contributors: [], insights: [] };
  }

  // Supplements count toward the availability gate only — their nutrient
  // claims are never merged into food totals (composition/dose comparability
  // is not guaranteed; a shake can be logged as both food and supplement).
  const intake = logs.reduce(
    (a, l) => ({ protein: a.protein + l.proteinG, carbs: a.carbs + l.carbsG, fat: a.fat + l.fatG, fiber: a.fiber + l.fiberG }),
    { protein: 0, carbs: 0, fat: 0, fiber: 0 },
  );

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
  const allEntries = [...logs];
  const sorted = allEntries.sort((a, b) => b.proteinG - a.proteinG);
  for (const log of sorted.slice(0, 3)) {
    if (log.proteinG > 15) {
      contributors.push({ category: 'macro', itemName: log.foodName, scoreImpact: Math.round(log.proteinG / 5), reason: 'Helped protein target' });
    }
  }

  return { score, available: true, contributors, insights, intake, targets };
}

// ============================================================================
// COMPONENT 2: CONDITION COMPLIANCE (30%)
// ============================================================================
async function scoreConditionCompliance(userId, dateStr, prisma, tz) {
  const userConditions = await prisma.userHealthCondition.findMany({
    where: { userId, active: true },
    include: { condition: { include: { conditionRules: { where: { reviewStatus: 'APPROVED' } } } } },
  });

  // No recorded conditions is unknown, not a perfect score.
  if (!userConditions.length) {
    return { score: null, available: false, contributors: [], insights: [] };
  }

  const win = dayWindow(dateStr, tz);
  const logs = await prisma.foodLog.findMany({
    where: { userId, loggedAt: { gte: win.start, lt: win.end } },
  });

  // Load attributes for all ingredients the user has
  if (!logs.length) return { score: null, available: false, contributors: [], insights: [] };
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
  // A given (food, attribute) pair penalizes once — logging the same item
  // twice must not stack duplicate penalties.
  const applied = new Set();

  for (const uc of userConditions) {
    const rules = uc.condition.conditionRules.filter((r) => r.target === 'ingredient');
    for (const log of logs) {
      const attrs = attrMap[log.foodName.toLowerCase()] || [];
      for (const rule of rules) {
        const pairKey = `${log.foodName.toLowerCase()}|${rule.attribute}`;
        if (attrs.includes(rule.attribute) && !applied.has(pairKey)) {
          applied.add(pairKey);
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
  return { score, available: true, contributors, insights };
}

// ============================================================================
// COMPONENT 3: FOOD QUALITY (15%)
// ============================================================================
async function scoreFoodQuality(userId, dateStr, prisma, tz) {
  const win = dayWindow(dateStr, tz);
  const logs = await prisma.foodLog.findMany({
    where: { userId, loggedAt: { gte: win.start, lt: win.end } },
  });

  // No food records means nothing to evaluate — unavailable, not mid-range.
  if (!logs.length) return { score: null, available: false, contributors: [], insights: [] };

  const contributors = [];
  let qualityPoints = 0;
  let totalItems = logs.length;
  // Guard: a flagged food contributes credit/penalty once per day, no matter
  // how many times it is logged. (Previously the same item stacked penalties.)
  const flagged = new Set();

  for (const log of logs) {
    const name = log.foodName.toLowerCase();
    // Simple heuristic: protein-dominant = quality; refined-carb-dominant,
    // fiber-poor = penalized. NOTE: carbs are not sugar — wording must not
    // imply a sugar measurement. Per-100g/micronutrient quality waits for v2.
    if (log.proteinG > 15 && log.carbsG < log.proteinG) {
      if (!flagged.has(name)) {
        qualityPoints += 1;
        flagged.add(name);
        if (log.proteinG > 25) {
          contributors.push({ category: 'food_quality', itemName: log.foodName, scoreImpact: 5, reason: 'High-quality protein source' });
        }
      }
    } else if (log.carbsG > 50 && log.fiberG < 2) {
      if (!flagged.has(name)) {
        qualityPoints -= 1;
        flagged.add(name);
        contributors.push({ category: 'food_quality', itemName: log.foodName, scoreImpact: -10, reason: 'Refined-carb-dominant item (low fiber) reduced score' });
      }
    } else {
      qualityPoints += 0.5;
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(50 + (qualityPoints / totalItems) * 50)));
  const insights = [];
  if (score < 60) {
    insights.push({ message: 'Food quality is low today. Choose whole foods over processed options.', severity: 'warning' });
  }

  return { score, available: true, contributors, insights };
}

// ============================================================================
// COMPONENT 4: ACTIVITY BALANCE (10%)
// ============================================================================
async function scoreActivity(userId, dateStr, prisma, tz) {
  const win = dayWindow(dateStr, tz);
  const workouts = await prisma.workoutSession.findMany({
    where: { userId, startedAt: { gte: win.start, lt: win.end } },
  });

  const stepsRecord = await prisma.dailySteps.findFirst({
    where: { userId, date: { gte: win.start, lt: win.end } },
  });
  const steps = stepsRecord?.steps || 0;

  // No recorded activity is unknown — rest days are valid and absence of
  // logs is not evidence of inactivity.
  if (!workouts.length && !stepsRecord) {
    return { score: null, available: false, contributors: [], insights: [] };
  }

  const totalMinutes = workouts.reduce((s, w) => s + (w.durationMinutes || 0), 0);
  const contributors = [];
  const insights = [];

  let score;
  if (totalMinutes >= 30) {
    score = 100;
    contributors.push({ category: 'activity', itemName: 'Workout Completed', scoreImpact: 10, reason: `${totalMinutes} min of activity today` });
  } else if (totalMinutes > 0) {
    score = 60 + Math.round((totalMinutes / 30) * 40);
    contributors.push({ category: 'activity', itemName: 'Light Activity', scoreImpact: 5, reason: `${totalMinutes} min logged today` });
  } else if (steps >= 6000) {
    score = 80 + Math.min(20, Math.round((steps - 6000) / 200));
    contributors.push({ category: 'activity', itemName: 'Steps', scoreImpact: 6, reason: `${steps.toLocaleString()} steps today` });
  } else if (steps > 0) {
    score = 40 + Math.round((steps / 6000) * 40);
    contributors.push({ category: 'activity', itemName: 'Steps', scoreImpact: 3, reason: `${steps.toLocaleString()} steps today` });
  } else {
    score = 40;
    contributors.push({ category: 'activity', itemName: 'No Activity', scoreImpact: 0, reason: 'Steps recorded; no workout minutes — rest day or untracked activity' });
  }

  return { score, available: true, contributors, insights };
}

// ============================================================================
// COMPONENT 5: RECOVERY (5%)
// ============================================================================
async function scoreRecovery(userId, dateStr, prisma, tz) {
  const prevKey = new Date(Date.parse(dateStr + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const prevStart = dayRangeUtc(prevKey, tz).startUtc;
  const win = dayWindow(dateStr, tz);

  const sleep = await prisma.sleepLog.findMany({
    where: { userId, sleepEnd: { gte: prevStart, lt: win.end } },
    orderBy: { sleepEnd: 'desc' },
    take: 1,
  });

  const waterLogs = await prisma.waterLog.findMany({
    where: { userId, loggedAt: { gte: win.start, lt: win.end } },
  });
  const waterMl = waterLogs.reduce((s, w) => s + (w.amountMl || 0), 0);
  const goals = await prisma.macroGoal.findUnique({ where: { userId } });
  const waterTarget = goals?.waterMlTarget || fallbackTargets().waterMlTarget;

  const contributors = [];
  const insights = [];
  // Score only what was recorded: missing sleep or water logs are unknown,
  // not a default 70. Both missing → the whole component is unavailable.
  const parts = [];
  let sleepScore = null;
  let waterScore = null;

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
    parts.push(sleepScore);
  }

  if (!waterLogs.length) {
    return parts.length
      ? { score: Math.round(parts.reduce((s, v) => s + v, 0) / parts.length), available: true, contributors, insights }
      : { score: null, available: false, contributors: [], insights: [] };
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
  parts.push(waterScore);

  const score = Math.round(parts.reduce((s, v) => s + v, 0) / parts.length);
  return { score, available: true, contributors, insights };
}

// ============================================================================
// MAIN ENTRY: Calculate full Health Score
// ============================================================================
async function calculateHealthScore(userId, date) {
  const prisma = getPrisma();
  const dateStr = date || isoDate();
  const tz = await userTz(prisma, userId);

  const [macro, condition, quality, activity, recovery] = await Promise.all([
    scoreMacroAdherence(userId, dateStr, prisma, tz),
    scoreConditionCompliance(userId, dateStr, prisma, tz),
    scoreFoodQuality(userId, dateStr, prisma, tz),
    scoreActivity(userId, dateStr, prisma, tz),
    scoreRecovery(userId, dateStr, prisma, tz),
  ]);

  // Only components with real records contribute; weights renormalize over
  // what is available so missing data never masquerades as a measurement.
  const parts = [
    ['macro', macro, WEIGHTS.macro],
    ['condition', condition, WEIGHTS.condition],
    ['foodQuality', quality, WEIGHTS.foodQuality],
    ['activity', activity, WEIGHTS.activity],
    ['recovery', recovery, WEIGHTS.recovery],
  ];
  const available = parts.filter(([, c]) => c.available && Number.isFinite(c.score));
  const weightTotal = available.reduce((s, [, , w]) => s + w, 0);
  const overallScore = weightTotal > 0
    ? Math.round(available.reduce((s, [, c, w]) => s + c.score * w, 0) / weightTotal)
    : null;
  const coverage = { available: available.length, total: parts.length };

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

  const status = overallScore == null ? 'insufficient_data' : statusFromScore(overallScore);

  // Persist to DB — but only a real score; an all-unknown day is left
  // unrecorded rather than stored as a misleading zero.
  const existing = await prisma.healthScore.findUnique({
    where: { userId_date: { userId, date: dateStr } },
  });

  let healthScore;
  if (overallScore == null) {
    if (existing) await prisma.healthScore.delete({ where: { id: existing.id } });
    healthScore = null;
  } else if (existing) {
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
  if (healthScore && allContributors.length > 0) {
    await prisma.scoreContributor.createMany({
      data: allContributors.map((c) => ({ healthScoreId: healthScore.id, ...c })),
    });
  }
  if (healthScore && allInsights.length > 0) {
    await prisma.healthScoreInsight.createMany({
      data: allInsights.map((i) => ({ healthScoreId: healthScore.id, ...i })),
    });
  }

  // Top 3 contributors (sorted by absolute impact)
  const topContributors = [...allContributors]
    .sort((a, b) => Math.abs(b.scoreImpact) - Math.abs(a.scoreImpact))
    .slice(0, 5);

  return {
    id: healthScore?.id ?? null,
    date: dateStr,
    score: overallScore,
    status,
    coverage,
    components: {
      macro: { score: macro.score, weight: WEIGHTS.macro, available: macro.available !== false },
      condition: { score: condition.score, weight: WEIGHTS.condition, available: condition.available !== false },
      foodQuality: { score: quality.score, weight: WEIGHTS.foodQuality, available: quality.available !== false },
      activity: { score: activity.score, weight: WEIGHTS.activity, available: activity.available !== false },
      recovery: { score: recovery.score, weight: WEIGHTS.recovery, available: recovery.available !== false },
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
  const tz = await userTz(prisma, userId);
  const win = dayWindow(dateStr, tz);

  const goals = await prisma.macroGoal.findUnique({ where: { userId } });
  const targets = goals || fallbackTargets();

  const logs = await prisma.foodLog.findMany({
    where: { userId, loggedAt: { gte: win.start, lt: win.end } },
  });
  const waterLogs = await prisma.waterLog.findMany({
    where: { userId, loggedAt: { gte: win.start, lt: win.end } },
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
    where: { userId, startedAt: { gte: win.start, lt: win.end } },
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
