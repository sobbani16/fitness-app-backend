// Trend intelligence (Sprint A) — coverage-aware 7/14/30-day trend aggregation
// over the user's OWN records: food logs, weights, workouts, steps, sleep,
// goal history. Consumed by unifiedProgress.getProgress — not a parallel
// engine. Rules:
//   - Missing food logs are UNKNOWN days, never zero intake.
//   - Short-term weight change is never presented as fat loss.
//   - Every series carries coverage + provenance; insufficient coverage →
//     honest 'insufficient' state rather than a fabricated trend.
//   - Observational only — no thresholds beyond documented engineering bands;
//     reviewed bounds (rapid-loss kg/week) arrive as caller parameters.
const { getPrisma } = require('../lib/prisma');
const { resolveFiberTargetForUser } = require('./fiber/targetForUser');
const { normalizeGoal } = require('./calorieEngine');

const DAY_MS = 86400000;
// Provisional engineering heuristics for pattern surfacing — versioned +
// configurable, NOT medical guidance. minLogs avoids over-reading small
// samples; minSharePct ties the flag to meaningful daily share.
const PATTERN_THRESHOLDS = {
  version: 'pattern-v1',
  frequentCalorieDense: { minLogs: 3, minSharePct: 15, minLoggedDays: 3 },
  proteinBelowTargetPct: 0.8,
  fiberBelowTargetPct: 0.7,
  kcalOverTargetPct: 115,
  kcalUnderTargetPct: 80,
};
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const toStr = (d) => d.toISOString().slice(0, 10);

// Weight direction from goal — expected direction only, never a judgment.
const GOAL_DIRECTION = {
  weight_loss: 'down', fat_loss: 'down',
  weight_gain: 'up', muscle_gain: 'up', bulking: 'up',
  maintenance: 'stable', body_recomposition: 'stable',
};

// 3-point centered moving average for scale weight (daily fluctuations).
function smoothedWeight(entries) {
  if (entries.length < 3) return null;
  const mid = [];
  for (let i = 0; i < entries.length; i++) {
    const w = entries.slice(Math.max(0, i - 1), Math.min(entries.length, i + 2));
    mid.push(round1(w.reduce((a, e) => a + e.weightKg, 0) / w.length));
  }
  return { firstSmoothedKg: mid[0], lastSmoothedKg: mid[mid.length - 1], deltaKg: round1(mid[mid.length - 1] - mid[0]), weeks: round1((entries.length > 1 ? (entries[entries.length - 1].recordedAt - entries[0].recordedAt) / (7 * DAY_MS) : 0)) };
}

async function getTrends(userId, { tz = 'UTC', days = 14, rapidLossBoundKgPerWeek = null } = {}) {
  const prisma = getPrisma();
  const daysN = [7, 14, 30].includes(days) ? days : 14;
  const end = new Date(); end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - (daysN - 1) * DAY_MS);
  const q = async (p) => { try { return await p; } catch { return null; } };

  const [meals, weights, sessions, steps, macroGoal, goalHist, profile, fiberTarget] = await Promise.all([
    q(prisma.foodLog.findMany({ where: { userId, loggedAt: { gte: start, lt: new Date(end.getTime() + DAY_MS) } }, select: { loggedAt: true, calories: true, proteinG: true, carbsG: true, fatG: true, fiberG: true } })),
    q(prisma.weightEntry.findMany({ where: { userId, recordedAt: { gte: start } }, orderBy: { recordedAt: 'asc' }, select: { recordedAt: true, weightKg: true } })),
    q(prisma.workoutSession.findMany({ where: { userId, startedAt: { gte: start }, finishedAt: { not: null } }, select: { startedAt: true, workoutType: true, durationMinutes: true, source: true } })),
    q(prisma.dailySteps.findMany({ where: { userId, date: { gte: start } }, select: { date: true, steps: true } })),
    q(prisma.macroGoal.findUnique({ where: { userId } })),
    q(prisma.goalHistory.findMany({ where: { userId }, orderBy: { startedAt: 'asc' }, select: { goal: true, startedAt: true, endedAt: true, targetsSnapshot: true } })),
    q(prisma.user.findUnique({ where: { id: userId }, select: { goalType: true } })),
    q(resolveFiberTargetForUser(prisma, userId)),
  ]);

  // Local-day bucketing — dates are assigned in the viewer's timezone.
  const localDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const dayList = Array.from({ length: daysN }, (_, i) => toStr(new Date(start.getTime() + i * DAY_MS)));
  const daySet = new Set(dayList.map((d) => localDate(new Date(`${d}T12:00:00Z`))));

  // ---- energy/macros per LOCAL day; absent day = unknown, not zero ---------
  const perDay = new Map();
  for (const m of meals || []) {
    const d = localDate(m.loggedAt);
    if (!daySet.has(d)) continue;
    const b = perDay.get(d) || { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, entries: 0, missingMacros: 0 };
    b.calories += m.calories || 0;
    b.proteinG += m.proteinG || 0; b.carbsG += m.carbsG || 0; b.fatG += m.fatG || 0;
    if (m.fiberG != null) b.fiberG += m.fiberG;
    if (m.proteinG == null || m.carbsG == null || m.fatG == null) b.missingMacros++;
    b.entries++;
    perDay.set(d, b);
  }
  const loggedDays = [...perDay.keys()];
  const coverage = {
    days: daysN,
    foodLoggedDays: loggedDays.length,
    foodCoveragePct: round1(loggedDays.length / daysN * 100),
    weightEntries: (weights || []).length,
    workoutSessions: (sessions || []).length,
    stepDays: (steps || []).length,
  };
  const incompleteLogs = [...perDay.values()].filter((b) => b.missingMacros > 0).length;

  const avg = (f) => loggedDays.length ? loggedDays.reduce((a, d) => a + f(perDay.get(d)), 0) / loggedDays.length : null;
  const energy = loggedDays.length === 0 ? { state: 'insufficient', reason: 'No food logs in window — intake unknown, not zero.' } : {
    state: loggedDays.length < Math.ceil(daysN * 0.5) ? 'partial' : 'ok',
    avgDailyKcal: round1(avg((b) => b.calories)),
    loggedDays: loggedDays.length,
    targetKcal: macroGoal?.caloriesTarget ?? null,
    adherencePct: macroGoal?.caloriesTarget ? round1(avg((b) => b.calories) / macroGoal.caloriesTarget * 100) : null,
    incompleteLogDays: incompleteLogs,
    provenance: 'food_log_sums_partial_days_excluded_from_confirmed_totals',
    note: incompleteLogs ? `${incompleteLogs} logged day(s) contain entries with unknown macros — totals are lower bounds.` : null,
  };
  const macros = loggedDays.length === 0 ? { state: 'insufficient' } : {
    state: 'ok',
    avgProteinG: round1(avg((b) => b.proteinG)), avgCarbsG: round1(avg((b) => b.carbsG)),
    avgFatG: round1(avg((b) => b.fatG)), avgFiberG: round1(avg((b) => b.fiberG)),
    targets: macroGoal ? { proteinG: macroGoal.proteinTarget ?? null, carbsG: macroGoal.carbsTarget ?? null, fatG: macroGoal.fatTarget ?? null, fiberG: fiberTarget?.targetG ?? macroGoal.fiberTarget ?? null } : null,
    provenance: 'food_log_sums_over_logged_days_only',
  };

  // ---- weight: smoothed trend, direction only ------------------------------
  const w = smoothedWeight(weights || []);
  const weight = (weights || []).length < 3 ? { state: 'insufficient', reason: 'Fewer than 3 weight entries — no reliable trend.' } : {
    state: 'ok', entries: weights.length, ...w,
    weeklyRateKg: w.weeks > 0.5 ? round1(w.deltaKg / w.weeks) : null,
    note: 'Smoothed scale-weight change only — not a measure of fat loss or muscle gain.',
    provenance: '3pt_moving_average',
  };

  // ---- activity ------------------------------------------------------------
  const weeksSpan = daysN / 7;
  const activeKcalNotes = [];
  const activity = (sessions || []).length === 0 && (steps || []).length === 0
    ? { state: 'insufficient', reason: 'No workout or step records in window.' }
    : {
      state: 'ok',
      workoutsPerWeek: round1((sessions || []).length / weeksSpan),
      workoutDays: new Set((sessions || []).map((s) => localDate(s.startedAt))).size,
      avgDailySteps: (steps || []).length ? Math.round(steps.reduce((a, s) => a + (s.steps || 0), 0) / steps.length) : null,
      provenance: 'workout_sessions+daily_steps',
    };
  if ((sessions || []).length) activeKcalNotes.push('session_count_only — wearable kcal not summed here (uncertain measurement)');

  // ---- goal + expected direction -------------------------------------------
  const currentGoal = normalizeGoal(profile?.goalType) || profile?.goalType || null;
  const changesInWindow = (goalHist || []).filter((g) => g.startedAt >= start)
    .map((g) => ({ goal: normalizeGoal(g.goal) || g.goal, startedAt: toStr(g.startedAt), endedAt: g.endedAt ? toStr(g.endedAt) : null, targetsPreserved: g.targetsSnapshot != null }));
  const expectedDirection = GOAL_DIRECTION[currentGoal] || null;

  // ---- progress vs expected direction --------------------------------------
  let goalProgress = 'no_data';
  if (weight.state === 'ok' && weight.weeklyRateKg != null && expectedDirection) {
    const dir = weight.deltaKg > 0.3 ? 'up' : weight.deltaKg < -0.3 ? 'down' : 'stable';
    goalProgress =
      expectedDirection === 'stable' ? (dir === 'stable' ? 'progressing' : 'drifting')
      : dir === expectedDirection ? 'progressing'
      : dir === 'stable' ? 'stalled' : 'regressing';
  }

  // ---- reviewed-bound checks (functions exist; bounds are parameters) ------
  const reviews = [];
  if (weight.state === 'ok' && rapidLossBoundKgPerWeek != null && weight.weeklyRateKg != null && weight.weeklyRateKg < 0) {
    const r = require('./scenarioCapabilities').assessWeightLossRate({ weeklyLosses: [-weight.weeklyRateKg], maxLossKgPerWeek: rapidLossBoundKgPerWeek });
    if (r.outcomeReview || (r.weeksOverBound || 0) > 0) reviews.push({ kind: 'rapid_weight_loss', outcome: r.outcomeReview ? 'professional_review' : 'monitor', reason: r.reason });
  }

  // ---- Sprint B: symptom/context + outcome-divergence ----------------------
  const symptoms = await require('./symptomContext').getSymptomContext(userId, { days: daysN }).catch(() => null);
  if (symptoms?.escalation) reviews.push(symptoms.escalation);

  // L10/A09-style divergence: recent score snapshots vs computed goalProgress.
  const snapshots = await q(prisma.dailyScoreSnapshot?.findMany?.({ where: { userId, date: { gte: new Date(toStr(start)) } }, orderBy: { date: 'desc' }, take: 14, select: { composite: true } })) || [];
  const divergence = require('./scenarioCapabilities').detectOutcomeDivergence({
    recentScores: (snapshots || []).map((s) => s.composite).filter((n) => n != null),
    goalProgress,
  });
  if (divergence.outcomeReview) reviews.push({ kind: 'score_outcome_divergence', outcome: 'outcome_review', reason: divergence.reason, avgScore: divergence.avgScore });

  // ---- goal-aware educational observations (deterministic templates) --------
  const observations = [];
  if (energy.state !== 'insufficient' && macroGoal?.caloriesTarget) {
    if (energy.adherencePct > 115 && ['weight_loss', 'fat_loss'].includes(currentGoal)) {
      observations.push({ key: 'kcal_over_target', goal: currentGoal, observation: `Recorded intake averaged ${Math.round(energy.adherencePct - 100)}% above your selected calorie target over ${energy.loggedDays} logged day(s).`, periodDays: daysN, coveragePct: coverage.foodCoveragePct, confidence: energy.state === 'partial' ? 'low' : 'moderate', nextStep: 'Review portion sizes or the goal target if this is a recurring pattern.' });
    }
    if (energy.adherencePct < 80 && ['weight_gain', 'muscle_gain', 'bulking'].includes(currentGoal)) {
      observations.push({ key: 'kcal_under_target', goal: currentGoal, observation: `Recorded intake averaged ${Math.round(100 - energy.adherencePct)}% below your selected calorie target over ${energy.loggedDays} logged day(s).`, periodDays: daysN, coveragePct: coverage.foodCoveragePct, confidence: energy.state === 'partial' ? 'low' : 'moderate', nextStep: 'Check whether missed logging or missed meals is the cause before changing the plan.' });
    }
  }
  if (macros.state === 'ok' && macroGoal?.proteinTarget && macros.avgProteinG != null && macros.avgProteinG < macroGoal.proteinTarget * 0.8 && ['muscle_gain', 'weight_gain', 'bulking'].includes(currentGoal)) {
    observations.push({ key: 'protein_below_target', goal: currentGoal, observation: `Recorded protein averaged ${macros.avgProteinG}g vs your ${macroGoal.proteinTarget}g target on logged days.`, periodDays: daysN, coveragePct: coverage.foodCoveragePct, confidence: 'moderate', nextStep: 'Protein-rich additions may help close the gap if intake is genuinely low.' });
  }
  // Sprint C: repeated calorie-dense-food pattern (frequency × share) —
  // thresholds from PATTERN_THRESHOLDS (provisional, configurable).
  const p = PATTERN_THRESHOLDS.frequentCalorieDense;
  if (macroGoal?.caloriesTarget && loggedDays.length >= p.minLoggedDays) {
    const byFood = new Map();
    for (const m of meals || []) {
      const k = String(m.foodName || '').trim().toLowerCase(); if (!k) continue;
      const e = byFood.get(k) || { count: 0, kcalSum: 0 };
      e.count++; e.kcalSum += m.calories || 0; byFood.set(k, e);
    }
    for (const [food, e] of byFood) {
      const avgShare = e.kcalSum / e.count / macroGoal.caloriesTarget * 100;
      if (e.count >= p.minLogs && avgShare >= p.minSharePct) {
        observations.push({ key: 'frequent_calorie_dense', goal: currentGoal, observation: `"${food}" was logged ${e.count} times this window, averaging ~${round1(avgShare)}% of your daily calorie target each time.`, periodDays: daysN, coveragePct: coverage.foodCoveragePct, confidence: 'moderate', basis: 'frequency×portion pattern — not a food classification', nextStep: 'If the pattern is unintended, portion size is the practical lever.' });
      }
    }
  }
  if (macros.state === 'ok' && (fiberTarget?.targetG ?? macroGoal?.fiberTarget) && macros.avgFiberG != null && macros.avgFiberG < (fiberTarget?.targetG ?? macroGoal.fiberTarget) * 0.7) {
    observations.push({ key: 'fiber_below_target', goal: currentGoal, observation: `Recorded fiber averaged ${macros.avgFiberG}g vs a ${fiberTarget?.targetG ?? macroGoal.fiberTarget}g reference target — some logged foods may lack fiber data.`, periodDays: daysN, coveragePct: coverage.foodCoveragePct, confidence: 'low', nextStep: 'Verify whether fiber is actually low or just unlogged/unrecorded.' });
  }

  const sufficient = coverage.foodLoggedDays >= 3 || coverage.weightEntries >= 3 || coverage.workoutSessions >= 2 || coverage.stepDays >= 3;
  return {
    version: 'trends-v1', timezone: tz, windowDays: daysN,
    state: sufficient ? 'ok' : 'insufficient',
    insufficientReason: sufficient ? null : 'Not enough recorded days in this window — trends need records, gaps are unknowns.',
    coverage, energy, macros, weight, activity, activeKcalNotes,
    goal: { current: currentGoal, expectedDirection, changesInWindow },
    progress: { goalProgress, divergence: divergence.state === 'reliable' ? divergence : { state: divergence.state }, basis: 'smoothed weight direction vs goal expectation — observational' },
    symptoms: symptoms ? { state: symptoms.state, coverage: symptoms.coverage, reportCount: symptoms.coverage.symptomReports, associations: symptoms.associations, escalation: symptoms.escalation } : null,
    observations,
    reviews,
    provenance: { meals: 'FoodLog.loggedAt(local)', weights: 'WeightEntry', workouts: 'WorkoutSession', steps: 'DailySteps', goals: 'GoalHistory+User.goalType', symptoms: 'UserSymptomReport', scores: 'DailyScoreSnapshot' },
  };
}

module.exports = { getTrends, smoothedWeight, GOAL_DIRECTION };
