// Daily Goal Progress V2 — "How much of my planned day is done?"
// Deterministic, idempotent, timezone-aware. Completely separate from the
// legacy HealthScore (V1 snapshots are preserved, never reinterpreted).
//
// Model: each applicable component has a weight. Earned points = weight ×
// verified progress. Inapplicable components' weight is redistributed across
// applicable ones — so sleep alone can never produce a near-perfect score:
// an applicable-but-unearned component still anchors the denominator.
const { getPrisma } = require('../lib/prisma');
const ld = require('./localDay');

const prisma = new Proxy({}, { get: (_t, p) => getPrisma()[p] });

// Versioned weight policy — bump on any formula change; snapshots keep theirs.
const CALC_VERSION = 2;
const WEIGHTS = { nutrition: 25, hydration: 15, activity: 20, sleep: 15, habits: 15, planActions: 10 };

const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const round = (n) => Math.round(n * 10) / 10;

// status per A4: NOT_STARTED | IN_PROGRESS | GOAL_MET | INSUFFICIENT_DATA | NOT_APPLICABLE
const comp = (key, { status, progress = 0, detail = {}, source = [] }) => ({
  key, weight: WEIGHTS[key], status: status || 'NOT_APPLICABLE',
  progress: round(clamp(progress)), earned: null, applicable: null,
  source, ...detail,
});

function componentStatus(progress, dataPresent, notDue) {
  if (notDue) return 'NOT_STARTED';
  if (!dataPresent) return 'INSUFFICIENT_DATA';
  if (progress >= 1) return 'GOAL_MET';
  if (progress > 0) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

async function computeDay(userId, { tz, dayKeyStr, now = new Date(), persist = true } = {}) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true, waterGoalMl: true } }).catch(() => null);
  const zone = ld.resolveZone(tz || user?.timeZone);
  const dk = dayKeyStr || ld.dayKey(now, zone);
  const { startUtc, endUtc } = ld.dayRangeUtc(dk, zone);
  const { startUtc: nightStart, endUtc: nightEnd } = ld.lastNightRangeUtc(dk, zone);
  const local = ld.localParts(now, zone);
  const minsNow = local.minutes;

  const [meals, water, steps, workouts, sleep, habits, prefs, goals, planningPrefs] = await Promise.all([
    prisma.foodLog.findMany({ where: { userId, loggedAt: { gte: startUtc, lt: endUtc } }, select: { calories: true, proteinG: true, fiberG: true, mealType: true, loggedAt: true } }).catch(() => []),
    prisma.waterLog.aggregate({ where: { userId, loggedAt: { gte: startUtc, lt: endUtc } }, _sum: { amountMl: true } }).catch(() => ({ _sum: {} })),
    prisma.dailySteps.findFirst({ where: { userId, date: { gte: startUtc, lt: endUtc } }, select: { steps: true } }).catch(() => null),
    prisma.workoutSession.findMany({ where: { userId, startedAt: { gte: startUtc, lt: endUtc } }, select: { finishedAt: true, startedAt: true } }).catch(() => []),
    prisma.sleepLog.findMany({ where: { userId, sleepEnd: { gte: nightStart, lte: nightEnd } }, select: { hoursSlept: true, source: true } }).catch(() => []),
    prisma.habitCompletion.findMany({ where: { habit: { userId }, day: dk }, select: { outcome: true, habitId: true } }).catch(() => []),
    prisma.reminderCategorySetting.findMany({ where: { userId, category: { startsWith: 'meal:' }, enabled: true }, select: { category: true, times: true } }).catch(() => null),
    prisma.macroGoal.findUnique({ where: { userId }, select: { caloriesTarget: true, proteinTarget: true, waterMlTarget: true } }).catch(() => null),
    prisma.userPlanningPreferences.findUnique({ where: { userId }, select: { restDays: true } }).catch(() => null),
  ]).catch(() => [[], { _sum: {} }, null, [], [], [], null, null, null]);

  const components = [];

  // --- Nutrition 25: progress vs goals, gated on due mealtimes. Never rewards
  // undereating: no points for staying under goal when the day isn't complete.
  const mealTimes = { breakfast: '08:00', lunch: '12:30', dinner: '19:30' };
  for (const c of (Array.isArray(prefs) ? prefs : [])) { const t = c.times?.[0]; if (t) mealTimes[c.category.replace('meal:', '')] = t; }
  const dueMeals = Object.entries(mealTimes).filter(([, t]) => (ld.parseHHMM(t) ?? 0) <= minsNow).map(([k]) => k);
  const logged = new Set(meals.map((m) => m.mealType || 'meal'));
  const loggedDue = dueMeals.filter((m) => logged.has(m) || logged.has('meal')).length;
  const kcalGoal = goals?.caloriesTarget || null;
  const kcal = meals.reduce((a, m) => a + (m.calories || 0), 0);
  let nutProgress = dueMeals.length ? loggedDue / dueMeals.length : logged.size ? 0.5 : 0;
  // Goal check: at day end, eating within ±20% of target counts as met.
  if (kcalGoal && now >= endUtc) nutProgress = Math.max(nutProgress, Math.abs(kcal - kcalGoal) <= kcalGoal * 0.2 ? 1 : Math.min(1, kcal / kcalGoal));
  components.push(comp('nutrition', {
    status: dueMeals.length === 0 && !meals.length ? 'INSUFFICIENT_DATA' : componentStatus(nutProgress, meals.length > 0 || dueMeals.length > 0, false),
    progress: nutProgress,
    detail: { note: meals.length === 0 ? 'No meals logged yet' : `${meals.length} logged · ${Math.round(kcal)} kcal`, dueMeals, calories: Math.round(kcal), goal: kcalGoal },
    source: ['food_log'],
  }));

  // --- Hydration 15: recorded intake vs user goal. No record = no warning.
  const waterMl = water._sum?.amountMl || 0;
  const waterGoal = user?.waterGoalMl || goals?.waterMlTarget || 2000;
  components.push(comp('hydration', {
    status: waterMl === 0 ? (minsNow < 480 ? 'INSUFFICIENT_DATA' : 'NOT_STARTED') : componentStatus(clamp(waterMl / waterGoal), true, false),
    progress: clamp(waterMl / waterGoal),
    detail: { note: waterMl === 0 ? 'No water logged yet' : `${Math.round(waterMl)} ml`, amountMl: Math.round(waterMl), goalMl: waterGoal },
    source: ['water_log'],
  }));

  // --- Activity 20: workout OR movement goal. A coach/user-planned rest day
  // is honored: following the plan counts as fulfilling the component (A6).
  const finished = workouts.filter((w) => w.finishedAt).length;
  const stepsVal = steps?.steps || 0, stepGoal = steps?.goalSteps || 8000;
  const isRestDay = (planningPrefs?.restDays || []).includes(local.weekday);
  const actProgress = finished > 0 ? 1 : isRestDay ? 1 : clamp(stepsVal / stepGoal);
  components.push(comp('activity', {
    status: finished ? 'GOAL_MET' : isRestDay ? 'GOAL_MET' : componentStatus(actProgress, stepsVal > 0 || finished > 0, false),
    progress: actProgress,
    detail: { note: finished ? `${finished} session${finished > 1 ? 's' : ''} done` : isRestDay ? 'Rest day — recovery counts' : stepsVal ? `${stepsVal.toLocaleString()} steps` : 'Day in progress', steps: stepsVal, stepGoal, sessions: finished, restDay: isRestDay },
    source: ['workout_session', 'daily_steps', 'health_measurement'],
  }));

  // --- Sleep 15: overnight context. Record present → contribution, else 0.
  const hours = sleep.reduce((a, s) => a + (s.hoursSlept || 0), 0);
  const sleepGoal = 8;
  const sleepProgress = hours > 0 ? clamp(hours / sleepGoal) : 0;
  components.push(comp('sleep', {
    status: hours > 0 ? (sleepProgress >= 1 ? 'GOAL_MET' : 'IN_PROGRESS') : 'INSUFFICIENT_DATA',
    progress: sleepProgress,
    detail: { note: hours > 0 ? `${round(hours)} h overnight` : 'No overnight record', hours: round(hours), source: sleep[0]?.source || null },
    source: ['sleep_log', 'health_measurement'],
  }));

  // --- Habits 15: opted-in habits only; skipped ≠ negative.
  const totalHabits = await prisma.habit.count({ where: { userId, status: 'active' } }).catch(() => 0);
  const doneHabits = new Set(habits.filter((h) => h.outcome === 'done').map((h) => h.habitId)).size;
  const habitApplicable = totalHabits > 0;
  components.push(comp('habits', {
    status: !habitApplicable ? 'NOT_APPLICABLE' : componentStatus(doneHabits / totalHabits, doneHabits > 0, doneHabits === 0 && minsNow < 540),
    progress: habitApplicable ? doneHabits / totalHabits : 0,
    detail: { note: !habitApplicable ? 'No habits configured' : `${doneHabits}/${totalHabits} done`, total: totalHabits, done: doneHabits },
    source: ['habit_completion'],
  }));

  // --- Plan actions 10: coach-scheduled items. None → not applicable.
  const planItems = await (prisma.dailyPlanItem?.findMany ? prisma.dailyPlanItem.findMany({ where: { userId, day: dk }, select: { status: true } }).catch(() => []) : Promise.resolve([]));
  const planApplicable = planItems.length > 0;
  const planDone = planItems.filter((p) => p.status === 'completed' || p.status === 'done').length;
  components.push(comp('planActions', {
    status: !planApplicable ? 'NOT_APPLICABLE' : componentStatus(planDone / planItems.length, planDone > 0, false),
    progress: planApplicable ? planDone / planItems.length : 0,
    detail: { note: !planApplicable ? 'No scheduled plan items' : `${planDone}/${planItems.length} done`, total: planItems.length, done: planDone },
    source: ['daily_plan_item'],
  }));

  // Redistribution: NOT_APPLICABLE weight spreads over the rest.
  const applicable = components.filter((c) => c.status !== 'NOT_APPLICABLE');
  const appWeight = applicable.reduce((a, c) => a + c.weight, 0) || 1;
  for (const c of components) {
    c.applicable = c.status === 'NOT_APPLICABLE' ? 0 : round(c.weight * 100 / appWeight);
    c.earned = c.status === 'NOT_APPLICABLE' ? 0 : round(c.applicable * c.progress);
  }
  const earned = Math.min(100, round(components.reduce((a, c) => a + c.earned, 0)));

  const nextAction = components.find((c) => c.status !== 'NOT_APPLICABLE' && c.status !== 'GOAL_MET' && c.progress < 1);
  const payload = {
    dayKey: dk, timezone: zone, version: CALC_VERSION, earned, applicable: 100,
    components, nextAction: nextAction ? { component: nextAction.key, note: nextAction.note } : null,
    computedAt: now.toISOString(), label: 'Daily progress',
  };
  if (persist) {
    await prisma.dailyProgressDay.upsert({
      where: { userId_dayKey: { userId, dayKey: dk } },
      create: { userId, dayKey: dk, timezone: zone, version: CALC_VERSION, earned: Math.round(earned), applicable: 100, components },
      update: { timezone: zone, version: CALC_VERSION, earned: Math.round(earned), applicable: 100, components, computedAt: now },
    });
  }
  return payload;
}

async function history(userId, { tz, days = 14 } = {}) {
  const rows = await prisma.dailyProgressDay.findMany({ where: { userId }, orderBy: { dayKey: 'desc' }, take: Math.min(days, 90) });
  return { days: rows, version: CALC_VERSION };
}

module.exports = { computeDay, history, CALC_VERSION, WEIGHTS };
