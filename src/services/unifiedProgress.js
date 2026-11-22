// Unified member progress (M19) — one endpoint feeding the Progress
// experience and Leo's reaction cues.
//
// Everything is computed from records: weight, workouts, meal logging,
// habits, sleep, outcome goals, trainer check-ins. `moments` are the
// deterministic events Leo can react to — each carries the evidence it is
// based on. No streak punishment: gaps are absence of records, never
// failure. `leo` is a cue for the client (celebrate/encourage/steady),
// never a claim of progress that data doesn't support.
const { getPrisma } = require('../lib/prisma');
const { getSleepRecoverySummary } = require('./sleepRecovery');
const q = async (p) => { try { return await p; } catch { return null; } };

const DAY_MS = 86400000;
const toStr = (d) => d.toISOString().slice(0, 10);
const mondayOf = (d) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };

function todayStr(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function getProgress(userId, { tz = 'UTC', weeks = 8 } = {}) {
  const prisma = getPrisma();
  const today = new Date(`${todayStr(tz)}T00:00:00Z`);
  const thisMonday = mondayOf(today);
  const start = new Date(thisMonday.getTime() - (weeks - 1) * 7 * DAY_MS);
  const weekStarts = [];
  for (let i = 0; i < weeks; i++) weekStarts.push(toStr(new Date(start.getTime() + i * 7 * DAY_MS)));
  const dayList = [];
  for (let i = 0; i < weeks * 7; i++) dayList.push(toStr(new Date(start.getTime() + i * DAY_MS)));

  const [weights, sessions, foodDays, habits, sleepLogs, relation] = await Promise.all([
    q(prisma.weightEntry.findMany({ where: { userId, recordedAt: { gte: start } }, orderBy: { recordedAt: 'asc' }, select: { weightKg: true, recordedAt: true } })),
    q(prisma.workoutSession.findMany({ where: { userId, startedAt: { gte: start } }, select: { startedAt: true, finishedAt: true } })),
    q(prisma.foodLog.groupBy({ by: ['date'], where: { userId, date: { in: dayList } } })),
    q(prisma.habitCompletion.findMany({ where: { habit: { userId }, day: { in: dayList } }, select: { day: true, outcome: true } })),
    q(prisma.sleepLog.findMany({ where: { userId, sleepStart: { gte: start } }, select: { sleepStart: true, sleepEnd: true, hoursSlept: true } })),
    q(prisma.trainerClient.findFirst({ where: { clientId: userId, status: 'active' }, select: { id: true } })),
  ]);
  const [checkIns, firstSession, firstCheckIn, activePlan] = await Promise.all([
    relation ? q(prisma.checkIn.findMany({ where: { relationId: relation.id }, select: { weekOf: true, reviewedAt: true } })) : [],
    q(prisma.workoutSession.findFirst({ where: { userId, finishedAt: { not: null } }, orderBy: { startedAt: 'asc' }, select: { startedAt: true } })),
    relation ? q(prisma.checkIn.findFirst({ where: { relationId: relation.id }, orderBy: { weekOf: 'asc' }, select: { weekOf: true } })) : null,
    relation ? q(prisma.outcomePlan.findFirst({ where: { relationId: relation.id, status: 'active' }, include: { goals: true } })) : null,
  ]);

  // ---- per-week rollup ---------------------------------------------------
  const loggedDays = new Set((foodDays || []).map((l) => l.date));
  const weekIdx = (d) => Math.floor((mondayOf(d) - start) / (7 * DAY_MS));
  const buckets = weekStarts.map((weekOf) => ({ weekOf, workouts: 0, loggedDays: 0, habitsDone: 0, sleepNights: 0, sleepHoursSum: 0 }));
  for (const s of sessions || []) { const i = weekIdx(s.startedAt); if (i >= 0 && i < weeks && s.finishedAt) buckets[i].workouts++; }
  for (const d of loggedDays) { const i = weekIdx(new Date(`${d}T00:00:00Z`)); if (i >= 0 && i < weeks) buckets[i].loggedDays++; }
  for (const h of habits || []) { if (h.outcome !== 'done') continue; const i = weekIdx(new Date(`${h.day}T00:00:00Z`)); if (i >= 0 && i < weeks) buckets[i].habitsDone++; }
  for (const l of sleepLogs || []) {
    const h = l.hoursSlept ?? ((l.sleepEnd - l.sleepStart) / 3600000);
    if (!Number.isFinite(h) || h <= 0 || h >= 18) continue;
    const i = weekIdx(l.sleepStart); if (i >= 0 && i < weeks) { buckets[i].sleepNights++; buckets[i].sleepHoursSum += h; }
  }
  const weekly = buckets.map((b) => ({
    weekOf: b.weekOf, workouts: b.workouts, loggedDays: b.loggedDays, habitsDone: b.habitsDone,
    sleepNights: b.sleepNights || null,
    avgSleepHours: b.sleepNights ? +(b.sleepHoursSum / b.sleepNights).toFixed(1) : null,
  }));

  // ---- weight trend: numbers only, no judgment ---------------------------
  const w = weights || [];
  const weight = w.length
    ? { entries: w.length, firstKg: w[0].weightKg, lastKg: w[w.length - 1].weightKg, deltaKg: +(w[w.length - 1].weightKg - w[0].weightKg).toFixed(1), since: toStr(w[0].recordedAt) }
    : { entries: 0, firstKg: null, lastKg: null, deltaKg: null, since: null };

  // ---- current meal-logging streak (days ending today/yesterday) ---------
  let loggingStreak = 0;
  for (let i = 0; i < dayList.length; i++) {
    const d = toStr(new Date(today.getTime() - i * DAY_MS));
    if (loggedDays.has(d)) loggingStreak++;
    else if (i > 0) break; // today may simply not be logged yet
  }

  // ---- moments: deterministic events Leo reacts to ------------------------
  const thisWeek = weekly[weeks - 1];
  const priorWeeks = weekly.slice(0, weeks - 1);
  const moments = [];
  const inWindow = (d) => d && new Date(d) >= start;
  if (firstSession && inWindow(firstSession.startedAt)) moments.push({ key: 'first_workout', tone: 'celebrate', title: 'First workout completed', detail: 'Your first recorded workout happened during this window.', evidence: 'workout sessions' });
  if (firstCheckIn && inWindow(firstCheckIn.weekOf)) moments.push({ key: 'first_checkin', tone: 'celebrate', title: 'First coach check-in sent', detail: 'You sent your first weekly check-in to your coach.', evidence: 'check-ins' });
  if (loggingStreak >= 7) moments.push({ key: 'logging_streak', tone: 'celebrate', title: `${loggingStreak}-day logging streak`, detail: `Meals logged every day for ${loggingStreak} days.`, evidence: 'meal logging' });
  const maxPrior = Math.max(0, ...priorWeeks.map((b) => b.workouts));
  if (thisWeek.workouts > 0 && thisWeek.workouts > maxPrior) moments.push({ key: 'workout_pr_week', tone: 'celebrate', title: 'Best workout week on record', detail: `${thisWeek.workouts} workouts this week — more than any of the previous ${weeks - 1} weeks.`, evidence: 'workout sessions' });
  const prev = priorWeeks[priorWeeks.length - 1];
  if (thisWeek.avgSleepHours != null && prev?.avgSleepHours != null && (thisWeek.sleepNights || 0) >= 3 && (prev.sleepNights || 0) >= 3 && thisWeek.avgSleepHours - prev.avgSleepHours >= 0.5) moments.push({ key: 'sleep_improving', tone: 'encourage', title: 'Sleep trending up', detail: `Avg ${thisWeek.avgSleepHours}h this week vs ${prev.avgSleepHours}h last week.`, evidence: 'sleep' });
  // OutcomeGoal has no met-timestamp — report current state, not a claim of when.
  const metGoal = (activePlan?.goals || []).find((g) => g.status === 'met');
  if (metGoal) moments.push({ key: 'goal_met', tone: 'celebrate', title: 'Goal met', detail: `"${metGoal.title}" is marked met on your current shared plan.`, evidence: 'outcome plan' });
  if (weight.entries === 1) moments.push({ key: 'baseline_weight', tone: 'steady', title: 'Weight baseline captured', detail: 'First weight entry on record — trends get useful as entries add up.', evidence: 'weight' });

  // ---- Leo cue -------------------------------------------------------------
  const sleepNow = await getSleepRecoverySummary(userId, { tz }).catch(() => null);
  const celebrated = moments.find((m) => m.tone === 'celebrate');
  const struggling = (sleepNow?.signals || []).length > 0;
  const leo = celebrated
    ? { state: 'celebrate', because: celebrated.key, message: `${celebrated.title} — ${celebrated.detail}` }
    : struggling
      ? { state: 'encourage', because: 'recovery_signals', message: 'Recovery looks stretched lately — lighter days still count as progress.' }
      : { state: 'steady', because: null, message: 'Steady wins — keep showing up.' };

  const goals = activePlan ? {
    planTitle: activePlan.title, targetDate: activePlan.targetDate,
    open: activePlan.goals.filter((g) => g.status === 'open').length,
    met: activePlan.goals.filter((g) => g.status === 'met').length,
    total: activePlan.goals.length,
  } : null;

  return {
    version: 'progress-v1', timezone: tz, windowWeeks: weeks,
    weekly, weight, loggingStreakDays: loggingStreak || null,
    checkInsSent: (checkIns || []).length || null,
    checkInsReviewed: (checkIns || []).filter((c) => c.reviewedAt).length || null,
    goals, moments, leo,
    note: 'Progress is only shown when records exist — gaps are unknowns, not failures.',
  };
}

module.exports = { getProgress };
