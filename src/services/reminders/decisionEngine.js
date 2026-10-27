const { SUPPRESS, CATEGORY_COOLDOWN_MINUTES } = require('./constants');
const { inQuietHours } = require('./time');

function suppress(reason) {
  return { decision: 'suppress', reason };
}

// Deterministic gate evaluated immediately before a reminder becomes eligible.
// Every caller supplies facts; nothing is inferred here. Order encodes priority:
// consent first, then user state, then fatigue controls.
//
// ctx = {
//   now: Date, nowLocal: { minutes, weekday, isWeekend, dateKey },
//   prefs: ReminderPreference-like,
//   setting: ReminderCategorySetting-like,
//   completed: bool            — the underlying action already happened today
//   sleeping: bool             — a SleepLog interval covers now
//   activeWorkout: bool        — an unfinished WorkoutSession exists now
//   snoozedUntil: Date|null    — instance-level snooze still in effect
//   dedupeExists: bool         — same dedupeKey already recorded
//   sentToday: number          — nonessential sends so far this local day
//   lastSentAt: Date|null      — most recent send in this category
//   cooldownMinutes: number    — per-category minimum gap (default 60)
//   requiresFreshData: bool    — e.g. movement needs fresh step records
//   freshData: bool
// }
function evaluate(ctx) {
  const { prefs, setting, now, nowLocal } = ctx;
  if (!prefs || !prefs.masterEnabled) return suppress(SUPPRESS.NOT_OPTED_IN);
  if (prefs.pausedUntil && new Date(prefs.pausedUntil) > now) return suppress(SUPPRESS.PAUSED);
  if (!setting || !setting.enabled) return suppress(SUPPRESS.CATEGORY_DISABLED);
  if (setting.source === 'adaptive' && !prefs.adaptiveEnabled) return suppress(SUPPRESS.ADAPTIVE_NOT_CONSENTED);
  const quiet = ctx.wakingStart != null && ctx.wakingEnd != null
    ? inQuietHours(nowLocal.minutes, ctx.wakingEnd, ctx.wakingStart) // waking window = allowed range
    : inQuietHours(nowLocal.minutes, prefs.quietStart, prefs.quietEnd);
  if (quiet) return suppress(SUPPRESS.QUIET_HOURS);
  if (ctx.sleeping) return suppress(SUPPRESS.SLEEPING);
  if (ctx.activeWorkout) return suppress(SUPPRESS.ACTIVE_WORKOUT);
  if (ctx.completed) return suppress(SUPPRESS.ALREADY_DONE);
  if (ctx.snoozedUntil && ctx.snoozedUntil > now) return suppress(SUPPRESS.SNOOZED);
  if (ctx.dedupeExists) return suppress(SUPPRESS.DUPLICATE);
  if (ctx.requiresFreshData && !ctx.freshData) return suppress(SUPPRESS.STALE_DATA);
  // The daily cap applies to nonessential (adaptive/interval) sends only;
  // explicit user-configured schedules are exempt.
  if (setting.source !== 'manual' && (ctx.sentToday || 0) >= (prefs.dailyCap ?? 3)) return suppress(SUPPRESS.DAILY_CAP);
  const cooldown = (ctx.cooldownMinutes ?? CATEGORY_COOLDOWN_MINUTES) * 60000;
  if (ctx.lastSentAt && now - ctx.lastSentAt < cooldown) return suppress(SUPPRESS.COOLDOWN);
  return { decision: 'send', reason: 'eligible' };
}

module.exports = { evaluate };
