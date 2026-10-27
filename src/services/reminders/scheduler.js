const { DEFAULTS, CATEGORY_COOLDOWN_MINUTES, INSTANCE_EXPIRY_HOURS, SUPPRESS } = require('./constants');
const { localParts, parseHHMM, wallTimeToUtc, inQuietHours, formatMinutes } = require('./time');
const { evaluate } = require('./decisionEngine');
const { emit, notifyInbox } = require('./inbox');

const TITLES = {
  'meal:breakfast': 'Time for breakfast?',
  'meal:lunch': 'Time for lunch?',
  'meal:dinner': 'Time for dinner?',
  'meal:snack': 'Snack time?',
  water: 'Time for some water?',
  supplement: 'Supplement reminder',
  workout: 'Workout coming up',
  movement: 'Time to move a little?',
};

function tz(prefs) {
  return prefs.timezoneLocked ? (prefs.homeTimezone || prefs.timezone) : prefs.timezone;
}

// Computes candidate reminder slots for a user at `now` without writing
// anything. Pure planning; persistence happens in planUser.
function candidates(prefs, settings, ctx) {
  const lp = localParts(ctx.now, tz(prefs));
  const out = [];
  for (const setting of settings) {
    if (!setting.enabled) continue;
    if (setting.source === 'adaptive' && !prefs.adaptiveEnabled) continue;
    const cat = setting.category;
    const times = Array.isArray(setting.times) ? setting.times : [];
    const days = Array.isArray(setting.daysOfWeek) ? setting.daysOfWeek : null;
    if (days && !days.includes(lp.weekday)) continue;
    if (cat === 'water') {
      if (!ctx.lastWaterAt) continue; // no logs -> no evidence to schedule on
      const interval = (setting.intervalMinutes ?? DEFAULTS.waterIntervalMinutes) * 60000;
      const elapsed = ctx.now - ctx.lastWaterAt;
      if (elapsed >= interval && ctx.now - ctx.lastWaterAt < interval * 2) {
        // One reminder per gap, keyed to the gap itself so logging resets it.
        out.push({ category: cat, dedupeKey: `${ctx.userId}|water|gap|${ctx.lastWaterAt.toISOString()}`, scheduledFor: new Date(ctx.lastWaterAt.getTime() + interval), why: `It's been about ${setting.intervalMinutes ?? DEFAULTS.waterIntervalMinutes} min since your last water log.` });
      }
      continue;
    }
    if (cat === 'movement') continue; // requires fresh device step data; handled in a later milestone
    if (cat === 'supplement') {
      for (const sched of ctx.supplementSchedules || []) {
        const minutes = parseHHMM(sched.reminderTime);
        if (minutes == null) continue;
        const at = wallTimeToUtc(lp.dateKey, minutes, tz(prefs));
        if (at <= ctx.now || at - ctx.now > 15 * 60000) continue; // plan window: due now or within 15 min
        out.push({ category: cat, dedupeKey: `${ctx.userId}|supplement|${lp.dateKey}|${sched.id}`, scheduledFor: at, payload: { supplementScheduleId: sched.id, supplementId: sched.supplementId, userSupplementId: sched.userSupplementId }, why: `Your ${sched.dose || 'supplement'} schedule says ${sched.reminderTime}.` });
      }
      continue;
    }
    for (const t of times) {
      const minutes = parseHHMM(t);
      if (minutes == null) continue;
      const at = wallTimeToUtc(lp.dateKey, minutes, tz(prefs));
      const lead = cat === 'workout' ? (setting.leadMinutes ?? DEFAULTS.workoutLeadMinutes) : 0;
      const fire = new Date(at.getTime() - lead * 60000);
      if (fire <= ctx.now || fire - ctx.now > 15 * 60000) continue;
      out.push({
        category: cat,
        dedupeKey: `${ctx.userId}|${cat}|${lp.dateKey}|${t}|${lead}`,
        scheduledFor: fire,
        payload: cat === 'workout' ? { startsAt: at.toISOString(), leadMinutes: lead } : undefined,
        why: cat === 'workout' ? `Your workout schedule says ${t}.` : `Your ${cat.split(':')[1]} schedule says ${t}.`,
      });
    }
  }
  return out;
}

// Persists planned instances with idempotent dedupe keys.
async function planUser(prisma, userId, now) {
  const prefs = await prisma.reminderPreference.findUnique({ where: { userId } });
  if (!prefs || !prefs.masterEnabled) return [];
  const settings = await prisma.reminderCategorySetting.findMany({ where: { userId, enabled: true } });
  if (!settings.length) return [];
  const [lastWater, supplementSchedules, links] = await Promise.all([
    prisma.waterLog.findFirst({ where: { userId }, orderBy: { loggedAt: 'desc' }, select: { loggedAt: true } }),
    prisma.supplementSchedule.findMany({ where: { userId, active: true, reminderTime: { not: null } } }),
    prisma.userSupplement.findMany({ where: { userId }, select: { id: true, supplementId: true } }),
  ]);
  const linkBySupplement = Object.fromEntries(links.map(l => [l.supplementId, l.id]));
  const ctx = {
    userId,
    now,
    lastWaterAt: lastWater?.loggedAt || null,
    supplementSchedules: supplementSchedules.map(s => ({ ...s, userSupplementId: linkBySupplement[s.supplementId] })),
  };
  const planned = candidates(prefs, settings, ctx);
  if (!planned.length) return [];
  await prisma.reminderInstance.createMany({
    data: planned.map(p => ({ userId, category: p.category, dedupeKey: p.dedupeKey, scheduledFor: p.scheduledFor, payload: p.payload, why: p.why })),
    skipDuplicates: true,
  });
  return planned;
}

// Assembles the facts the decision engine needs for one user at `now`.
async function buildContext(prisma, userId, now, prefs) {
  const lp = localParts(now, tz(prefs));
  const dayStart = wallTimeToUtc(lp.dateKey, 0, tz(prefs));
  const [sleeping, activeWorkout, foodToday, lastWater, supplementLogs, workoutToday, sentToday, lastSends] = await Promise.all([
    prisma.sleepLog.count({ where: { userId, sleepStart: { lte: now }, sleepEnd: { gte: now } } }),
    prisma.workoutSession.count({ where: { userId, startedAt: { lte: now }, finishedAt: null } }),
    prisma.foodLog.findMany({ where: { userId, loggedAt: { gte: dayStart } }, select: { mealType: true } }),
    prisma.waterLog.findFirst({ where: { userId }, orderBy: { loggedAt: 'desc' }, select: { loggedAt: true } }),
    prisma.supplementLog.findMany({ where: { userId, date: lp.dateKey }, select: { userSupplementId: true } }),
    prisma.workoutSession.count({ where: { userId, startedAt: { gte: dayStart } } }),
    prisma.reminderInstance.count({ where: { userId, status: 'sent', actedAt: { gte: dayStart } } }),
    prisma.reminderInstance.findMany({ where: { userId, status: 'sent' }, orderBy: { actedAt: 'desc' }, take: 50, select: { category: true, actedAt: true } }),
  ]);
  return {
    lp,
    sleeping: sleeping > 0,
    activeWorkout: activeWorkout > 0,
    mealsLogged: new Set(foodToday.map(f => f.mealType)),
    lastWaterAt: lastWater?.loggedAt || null,
    supplementsLogged: new Set(supplementLogs.map(s => s.userSupplementId)),
    workoutDoneToday: workoutToday > 0,
    sentToday,
    lastSentByCategory: Object.fromEntries(lastSends.map(s => [s.category, s.actedAt])),
  };
}

function completedFor(category, instance, facts) {
  if (category.startsWith('meal:')) return facts.mealsLogged.has(category.split(':')[1]);
  if (category === 'water') return instance.scheduledFor && facts.lastWaterAt && facts.lastWaterAt > instance.scheduledFor;
  if (category === 'supplement') return facts.supplementsLogged.has(instance.payload?.userSupplementId ?? instance.payload?.supplementScheduleId);
  if (category === 'workout') return facts.workoutDoneToday;
  return false;
}

// One evaluation pass: revive expired snoozes, expire stale pendings, then run
// the decision gate on every due pending instance and record the outcome.
async function runTick(prisma, { now = new Date(), userIds } = {}) {
  await prisma.reminderInstance.updateMany({ where: { status: 'snoozed', snoozeUntil: { lte: now } }, data: { status: 'pending', snoozeUntil: null } });
  await prisma.reminderInstance.updateMany({ where: { status: 'pending', scheduledFor: { lt: new Date(now.getTime() - INSTANCE_EXPIRY_HOURS * 3600000) } }, data: { status: 'expired' } });

  const where = { status: 'pending', scheduledFor: { lte: now }, ...(userIds ? { userId: { in: userIds } } : {}) };
  const due = await prisma.reminderInstance.findMany({ where, take: 500, orderBy: { scheduledFor: 'asc' } });
  const results = { ready: 0, suppressed: 0 };
  const prefsByUser = {};
  const factsByUser = {};

  for (const instance of due) {
    if (!prefsByUser[instance.userId]) {
      prefsByUser[instance.userId] = await prisma.reminderPreference.findUnique({ where: { userId: instance.userId } });
      factsByUser[instance.userId] = null;
    }
    const prefs = prefsByUser[instance.userId];
    if (!prefs) continue;
    if (!factsByUser[instance.userId]) factsByUser[instance.userId] = await buildContext(prisma, instance.userId, now, prefs);
    const facts = factsByUser[instance.userId];
    const setting = await prisma.reminderCategorySetting.findUnique({ where: { userId_category: { userId: instance.userId, category: instance.category } } });

    const verdict = evaluate({
      now, nowLocal: facts.lp, prefs, setting,
      completed: completedFor(instance.category, instance, facts),
      sleeping: facts.sleeping,
      activeWorkout: facts.activeWorkout && instance.category !== 'workout',
      snoozedUntil: null,
      dedupeExists: false,
      sentToday: facts.sentToday,
      lastSentAt: facts.lastSentByCategory[instance.category] || null,
      cooldownMinutes: CATEGORY_COOLDOWN_MINUTES,
    });

    if (verdict.decision === 'send') {
      await prisma.reminderInstance.update({ where: { id: instance.id }, data: { status: 'sent', actedAt: now } });
      await notifyInbox(prisma, { userId: instance.userId, category: instance.category, title: TITLES[instance.category] || 'Reminder', body: instance.payload?.body || TITLES[instance.category] || 'Reminder', why: instance.why });
      await emit(prisma, instance.userId, 'reminder.sent', { category: instance.category });
      facts.sentToday += 1;
      facts.lastSentByCategory[instance.category] = now;
      results.ready += 1;
    } else {
      await prisma.reminderInstance.update({ where: { id: instance.id }, data: { status: 'suppressed', reason: verdict.reason, actedAt: now } });
      await emit(prisma, instance.userId, 'reminder.suppressed', { category: instance.category, reason: verdict.reason });
      results.suppressed += 1;
    }
  }
  return results;
}

module.exports = { candidates, planUser, buildContext, runTick, TITLES };
