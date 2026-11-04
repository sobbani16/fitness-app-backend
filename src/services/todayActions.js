// Health Priorities engine v1 (energy-today-v1 action contract).
// Deterministic, rule-based: returns at most 3 ranked, actionable
// recommendations. Never invents data — every card carries evidence,
// confidence and a concrete action. Repeated dismissals suppress kinds.
const { getPrisma } = require('../lib/prisma');
const { getSleepRecoverySummary } = require('./sleepRecovery');
const { getGutHealthSummary } = require('./gutHealth');

const DAY_MS = 86400000;
const DISMISS_WINDOW = 14 * DAY_MS;
const DISMISS_SUPPRESS_AT = 3;

const VALID_VERDICTS = new Set(['helpful', 'not_relevant', 'too_difficult', 'too_easy', 'not_practical', 'no_equipment', 'no_ingredients', 'doesnt_fit', 'discuss_trainer', 'dismissed']);

function localDayBounds(now = new Date(), tz = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const p = {}; for (const x of parts) p[x.type] = x.value;
  const dayStr = `${p.year}-${p.month}-${p.day}`;
  // Local midnight as instant via offset math (same approach as energySummary).
  const guess = Date.parse(`${dayStr}T00:00:00Z`);
  const localAtGuess = new Date(new Date(guess).toLocaleString('en-US', { timeZone: tz }));
  const offset = guess - Date.parse(localAtGuess.toISOString().replace('T', ' ').slice(0, 19) + 'Z');
  const start = new Date(guess + offset);
  return { dayStr, start, end: new Date(start.getTime() + DAY_MS) };
}

const ACTION_DEFS = [
  {
    key: 'start_workout', weight: 95,
    applies: async (c) => {
      const plan = c.activePlan;
      if (!plan) return null;
      return { title: 'Continue your workout plan', explanation: `Your confirmed plan (v${plan.version}) is ready to follow.`, evidence: [`Plan v${plan.version}`], action: { type: 'open', route: 'WorkoutPlan' }, confidence: 'high' };
    },
  },
  {
    key: 'choose_meal', weight: 90,
    applies: async (c) => {
      const hour = c.localHour;
      const occasion = hour >= 5 && hour < 10 ? 'breakfast' : hour >= 10 && hour < 15 ? 'lunch' : hour >= 17 && hour < 21 ? 'dinner' : null;
      if (!occasion) return null;
      if (c.mealsLogged[occasion]) return null;
      return { title: `What should I eat for ${occasion}?`, explanation: 'Rule-based suggestions that respect your allergies and restrictions.', evidence: [`${occasion} not logged yet`], action: { type: 'open', route: 'Suggest', params: { occasion } }, confidence: 'high' };
    },
  },
  {
    key: 'weekly_checkin', weight: 85,
    applies: async (c) => {
      if (!c.hasTrainer || !c.checkInDue) return null;
      return { title: 'Send your weekly check-in', explanation: 'Your coach reviews progress and adjusts your plan.', evidence: ['Check-in window open'], action: { type: 'open', route: 'CoachingHub' }, confidence: 'high' };
    },
  },
  {
    key: 'recovery_lighter', weight: 80,
    applies: async (c) => {
      if (c.sleep?.suggestion !== 'lighter_intensity') return null;
      const ev = c.sleep.signals.map(s => s.detail);
      return { title: 'Consider a lighter session today', explanation: 'Recent sleep or reported energy is low — a recovery-focused day may serve you better.', evidence: ev, action: { type: 'open', route: 'WorkoutPlan' }, confidence: 'partial' };
    },
  },
  {
    key: 'sleep_schedule', weight: 40,
    applies: async (c) => {
      if (c.sleep?.suggestion !== 'steady_schedule') return null;
      return { title: 'Try a steadier sleep window', explanation: 'Consistent wake times support training recovery.', evidence: c.sleep.signals.map(s => s.detail), action: { type: 'open', route: 'HealthScoreDetail' }, confidence: 'partial' };
    },
  },
  {
    key: 'fiber_variety', weight: 50,
    applies: async (c) => {
      const s = c.gut?.signals?.find(x => x.key === 'low_fiber' || x.key === 'narrow_variety');
      if (!s) return null;
      return { title: 'Add a fiber-rich food today', explanation: 'Beans, whole grains, fruit or veg nudge fiber toward your guide — pick what you tolerate.', evidence: [s.detail], action: { type: 'open', route: 'Suggest' }, confidence: 'partial' };
    },
  },
  {
    key: 'log_water', weight: 55,
    applies: async (c) => {
      if (!c.waterTargetMl || c.waterLoggedMl == null) return null;
      if (c.waterLoggedMl >= c.waterTargetMl * 0.8 || c.localHour < 12) return null;
      return { title: 'Log your water', explanation: 'Hydration tracking stays useful only when logged.', evidence: [`${Math.round(c.waterLoggedMl)} of ${Math.round(c.waterTargetMl)} ml logged`], action: { type: 'open', route: 'Dashboard', params: { open: 'water' } }, confidence: 'partial' };
    },
  },
  {
    key: 'sync_wearable', weight: 45,
    applies: async (c) => {
      if (!c.hasWearable || !c.wearableStaleHours || c.wearableStaleHours < 48) return null;
      return { title: 'Sync your wearable', explanation: 'Energy estimates use your profile until fresh data arrives.', evidence: [`Last sync ~${Math.round(c.wearableStaleHours)}h ago`], action: { type: 'open', route: 'ConnectedHealth' }, confidence: 'partial' };
    },
  },
];

async function buildContext(userId, tz) {
  const prisma = getPrisma();
  const now = new Date();
  const { dayStr, start, end } = localDayBounds(now, tz);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, goalType: true, timeZone: true, activityLevel: true },
  });
  const monday = new Date(start); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7)); monday.setUTCHours(0, 0, 0, 0);
  const trainer = await prisma.trainerClient.findFirst({ where: { clientId: userId, status: 'active' }, select: { id: true } }).catch(() => null);
  const [foodLogs, waterAgg, energyRec, plan, checkIn] = await Promise.all([
    prisma.foodLog.findMany({ where: { userId, loggedAt: { gte: start, lt: end } }, select: { mealType: true } }),
    prisma.waterLog.aggregate({ where: { userId, loggedAt: { gte: start, lt: end } }, _sum: { amountMl: true } }).catch(() => null),
    prisma.healthEnergyRecord.findFirst({ where: { userId }, orderBy: { startAt: 'desc' }, select: { startAt: true } }).catch(() => null),
    prisma.userWorkoutPlan.findFirst({ where: { userId, confirmedAt: { not: null }, status: { notIn: ['draft', 'archived'] } }, orderBy: { version: 'desc' }, select: { version: true } }).catch(() => null),
    trainer ? prisma.checkIn.findUnique({ where: { relationId_weekOf: { relationId: trainer.id, weekOf: monday } }, select: { id: true } }).catch(() => null) : Promise.resolve(null),
  ]);
  const mealsLogged = {};
  for (const f of foodLogs) (mealsLogged[f.mealType || 'other'] = true);
  return {
    user, dayStr,
    localHour: Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(now)),
    mealsLogged,
    waterLoggedMl: waterAgg?._sum?.amountMl ?? 0,
    waterTargetMl: 2000,
    hasWearable: Boolean(energyRec),
    wearableStaleHours: energyRec ? (now - new Date(energyRec.startAt)) / 3600000 : null,
    hasTrainer: Boolean(trainer),
    checkInDue: Boolean(trainer) && !checkIn,
    activePlan: plan || null,
    sleep: await getSleepRecoverySummary(userId).catch(() => null),
    gut: await getGutHealthSummary(userId).catch(() => null),
  };
}

async function getTodayActions(userId, tz = 'UTC') {
  const ctx = await buildContext(userId, tz);
  const dismissed = await getPrisma().actionFeedback.findMany({
    where: { userId, verdict: 'dismissed', createdAt: { gte: new Date(Date.now() - DISMISS_WINDOW) } },
    select: { actionKey: true },
  });
  const dismissCounts = {};
  for (const d of dismissed) dismissCounts[d.actionKey] = (dismissCounts[d.actionKey] || 0) + 1;

  const candidates = [];
  for (const def of ACTION_DEFS) {
    if ((dismissCounts[def.key] || 0) >= DISMISS_SUPPRESS_AT) continue;
    const rec = await def.applies(ctx);
    if (rec) candidates.push({ id: `${ctx.dayStr}:${def.key}`, actionKey: def.key, _w: def.weight, ...rec });
  }
  candidates.sort((a, b) => b._w - a._w);
  const actions = candidates.slice(0, 3).map(({ _w, ...a }) => a);
  return {
    version: 'today-actions-v1',
    date: ctx.dayStr,
    timezone: tz,
    goal: ctx.user?.goalType || null,
    actions,
    suppressed: candidates.length - actions.length,
    verdicts: [...VALID_VERDICTS],
    note: 'Rule-based recommendations. No AI involved. Missing data is treated as unknown, never as failure.',
  };
}

async function recordFeedback(userId, actionKey, verdict) {
  if (!VALID_VERDICTS.has(verdict)) { const e = new Error('Unknown verdict.'); e.status = 400; throw e; }
  await getPrisma().actionFeedback.create({ data: { userId, actionKey: String(actionKey).slice(0, 80), verdict } });
  return { ok: true };
}

module.exports = { getTodayActions, recordFeedback, VALID_VERDICTS, localDayBounds };
