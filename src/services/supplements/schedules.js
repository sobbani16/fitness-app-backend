// Per-supplement scheduling: multiple schedules per UserSupplement, concrete
// dose occurrences, and idempotent taken/skip/snooze actions.
//
// Occurrence generation is deterministic: dedupeKey = userId|schedule|date|slot
// makes repeated generation a no-op across ticks, syncs and travel reconciles.
// Anchored (meal/workout) doses schedule at their configured fallback wall
// time — the app never infers that a meal or workout happened.

const { localParts, parseHHMM, wallTimeToUtc } = require('../reminders/time');
const { tz } = require('../reminders/scheduler');

const TIMING_RELATIONS = new Set([
  'ANY_TIME', 'WITH_MEAL', 'AFTER_MEAL', 'BEFORE_MEAL', 'EMPTY_STOMACH',
  'WITH_BREAKFAST', 'WITH_LUNCH', 'WITH_DINNER', 'BEFORE_BED',
  'AFTER_WORKOUT', 'FIXED_TIME', 'CUSTOM',
]);
const MEAL_ANCHORS = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
const DOSE_UNITS = new Set(['mg', 'mcg', 'g', 'IU', 'mL', 'capsule', 'tablet', 'scoop', 'serving', 'CFU', 'packet', 'drop']);
const FREQUENCIES = new Set(['daily', 'specific_days', 'weekly', 'as_needed', 'custom']);
const MISS_AFTER_MS = 12 * 3600000;

function validateScheduleInput(body = {}) {
  const errors = [];
  const out = {};
  if (body.doseAmount != null) {
    const n = Number(body.doseAmount);
    if (!Number.isFinite(n) || n <= 0 || n > 100000) errors.push('doseAmount must be a positive number');
    else out.doseAmount = n;
  }
  if (body.doseUnit != null) {
    const u = String(body.doseUnit).trim();
    if (!DOSE_UNITS.has(u)) errors.push(`doseUnit must be one of ${[...DOSE_UNITS].join(', ')}`);
    else out.doseUnit = u;
  }
  if (body.dose != null) out.dose = String(body.dose).slice(0, 80);
  const freq = body.frequency == null ? 'daily' : String(body.frequency);
  if (!FREQUENCIES.has(freq)) errors.push(`frequency must be one of ${[...FREQUENCIES].join(', ')}`);
  else out.frequency = freq;
  if (body.daysOfWeek != null) {
    if (!Array.isArray(body.daysOfWeek) || body.daysOfWeek.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
      errors.push('daysOfWeek must be an array of 0-6');
    } else out.daysOfWeek = [...new Set(body.daysOfWeek)].sort();
  }
  const rel = body.timingRelation == null ? 'FIXED_TIME' : String(body.timingRelation);
  if (!TIMING_RELATIONS.has(rel)) errors.push(`timingRelation must be one of ${[...TIMING_RELATIONS].join(', ')}`);
  else out.timingRelation = rel;
  if (body.mealAnchor != null) {
    const m = String(body.mealAnchor).toLowerCase();
    if (!MEAL_ANCHORS.has(m)) errors.push('mealAnchor must be breakfast|lunch|dinner|snack');
    else out.mealAnchor = m;
  }
  if (out.timingRelation === 'WITH_BREAKFAST') out.mealAnchor = 'breakfast';
  if (out.timingRelation === 'WITH_LUNCH') out.mealAnchor = 'lunch';
  if (out.timingRelation === 'WITH_DINNER') out.mealAnchor = 'dinner';
  if (out.timingRelation === 'AFTER_WORKOUT') out.workoutAnchor = true;
  else if (body.workoutAnchor != null) out.workoutAnchor = Boolean(body.workoutAnchor);
  for (const key of ['reminderTime', 'fallbackTime']) {
    if (body[key] != null) {
      const t = String(body[key]).trim();
      if (!/^([01]?\d|2[0-3]):([0-5]\d)$/.test(t)) errors.push(`${key} must be HH:MM`);
      else out[key] = t.length === 4 ? `0${t}` : t;
    }
  }
  if (out.timingRelation === 'FIXED_TIME' && !out.reminderTime && body.reminderTime !== undefined) {
    // explicit null clears; only enforce on create
  }
  if (body.timezonePolicy != null) {
    const p = String(body.timezonePolicy);
    if (!['FOLLOW_DEVICE', 'FIXED_TIMEZONE'].includes(p)) errors.push('timezonePolicy must be FOLLOW_DEVICE|FIXED_TIMEZONE');
    else out.timezonePolicy = p;
  }
  for (const key of ['startDate', 'endDate']) {
    if (body[key] != null) {
      const d = String(body[key]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) errors.push(`${key} must be YYYY-MM-DD`);
      else out[key] = d;
    }
  }
  for (const key of ['notifyEnabled', 'soundEnabled', 'active']) {
    if (body[key] != null) out[key] = Boolean(body[key]);
  }
  if (body.snoozeMinutes != null) {
    const m = Number(body.snoozeMinutes);
    if (![15, 30, 60].includes(m)) errors.push('snoozeMinutes must be 15|30|60');
    else out.snoozeMinutes = m;
  }
  if (body.instructions != null) out.instructions = String(body.instructions).slice(0, 500);
  if (body.timeOfDay != null) out.timeOfDay = String(body.timeOfDay).slice(0, 30);
  return { errors, data: out };
}

function scheduleHasTime(sched) {
  return sched.reminderTime || sched.fallbackTime;
}

function slotMinutesFor(sched) {
  return parseHHMM(sched.reminderTime) ?? parseHHMM(sched.fallbackTime);
}

async function effectiveTimezone(prisma, userId, schedule) {
  if (schedule.timezonePolicy === 'FIXED_TIMEZONE') {
    const prefs = await prisma.reminderPreference.findUnique({ where: { userId }, select: { timezone: true } });
    return prefs?.timezone || 'UTC';
  }
  const prefs = await prisma.reminderPreference.findUnique({ where: { userId } });
  return prefs ? tz(prefs) : 'UTC';
}

// Generate PENDING occurrences for a schedule over the next `days` local days.
// Idempotent via dedupeKey. Returns the created count.
async function generateOccurrences(prisma, schedule, { days = 14, now = new Date() } = {}) {
  if (!schedule.active || schedule.frequency === 'as_needed') return 0;
  const zone = await effectiveTimezone(prisma, schedule.userId, schedule);
  const lp = localParts(now, zone);
  const minutes = slotMinutesFor(schedule);
  const daysFilter = Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.length ? new Set(schedule.daysOfWeek) : null;
  const rows = [];
  for (let d = 0; d < days; d += 1) {
    const day = new Date(Date.UTC(
      Number(lp.dateKey.slice(0, 4)), Number(lp.dateKey.slice(5, 7)) - 1, Number(lp.dateKey.slice(8, 10)) + d,
    ));
    const dateKey = day.toISOString().slice(0, 10);
    if (schedule.startDate && dateKey < schedule.startDate) continue;
    if (schedule.endDate && dateKey > schedule.endDate) continue;
    const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
    if (schedule.frequency === 'weekly' && schedule.startDate) {
      if (weekday !== new Date(`${schedule.startDate}T00:00:00Z`).getUTCDay()) continue;
    } else if (daysFilter && !daysFilter.has(weekday)) continue;
    const slotLabel = minutes != null ? `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` : (schedule.timingRelation || 'ANY');
    const scheduledFor = minutes != null ? wallTimeToUtc(dateKey, minutes, zone) : null;
    if (scheduledFor && scheduledFor <= now) continue; // don't backfill past slots today
    rows.push({
      userId: schedule.userId,
      scheduleId: schedule.id,
      userSupplementId: schedule.userSupplementId,
      localDate: dateKey,
      localTime: minutes != null ? slotLabel : null,
      timezone: zone,
      scheduledFor,
      status: 'PENDING',
      doseAmount: schedule.doseAmount,
      doseUnit: schedule.doseUnit,
      dedupeKey: `${schedule.userId}|${schedule.id}|${dateKey}|${slotLabel}`,
    });
  }
  if (!rows.length) return 0;
  const res = await prisma.supplementDoseOccurrence.createMany({ data: rows, skipDuplicates: true });
  return res.count;
}

async function regenerateForUser(prisma, userId, { days = 14 } = {}) {
  const schedules = await prisma.supplementSchedule.findMany({ where: { userId, active: true, userSupplementId: { not: null } } });
  let created = 0;
  for (const s of schedules) created += await generateOccurrences(prisma, s, { days });
  return { schedules: schedules.length, created };
}

// Marks stale PENDING occurrences MISSED. A missing log is never treated as
// proof of non-adherence — MISSED only means "the reminder window elapsed".
async function markMissed(prisma, userId, now = new Date()) {
  const cutoff = new Date(now.getTime() - MISS_AFTER_MS);
  const res = await prisma.supplementDoseOccurrence.updateMany({
    where: { userId, status: 'PENDING', scheduledFor: { not: null, lt: cutoff } },
    data: { status: 'MISSED' },
  });
  return res.count;
}

async function listOccurrences(prisma, userId, { date, days } = {}) {
  await markMissed(prisma, userId);
  const where = { userId, status: { not: 'CANCELLED' } };
  if (date) where.localDate = date;
  else if (days) {
    const lp = localParts(new Date(), 'UTC');
    const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    where.localDate = { gte: from, lte: to };
  }
  return prisma.supplementDoseOccurrence.findMany({
    where,
    orderBy: [{ scheduledFor: 'asc' }, { localTime: 'asc' }],
    include: { userSupplement: { include: { supplement: { include: { ingredient: true } } } }, schedule: true },
  });
}

const TERMINAL = new Set(['TAKEN', 'SKIPPED', 'CANCELLED', 'MISSED']);

// Idempotent action on an occurrence. TAKEN writes exactly one SupplementLog
// (idempotencyKey + occurrence status both guard against double-logging).
async function actOnOccurrence(prisma, userId, occurrenceId, action, payload = {}) {
  const occ = await prisma.supplementDoseOccurrence.findUnique({
    where: { id: occurrenceId },
    include: { userSupplement: { include: { supplement: true } } },
  });
  if (!occ || occ.userId !== userId) return { status: 404, error: 'Dose not found' };
  if (occ.status === 'TAKEN' && action === 'taken') {
    const existing = await prisma.supplementLog.findFirst({ where: { occurrenceId: occ.id, userId } });
    return { status: 200, occurrence: occ, log: existing, idempotent: true };
  }
  if (TERMINAL.has(occ.status) && action !== 'taken') {
    return { status: 200, occurrence: occ, idempotent: true };
  }
  const now = new Date();

  if (action === 'taken') {
    const idem = payload.idempotencyKey ? String(payload.idempotencyKey).slice(0, 120) : `taken:${occ.id}`;
    const existing = await prisma.supplementLog.findUnique({ where: { idempotencyKey: idem } }).catch(() => null);
    if (existing) {
      await prisma.supplementDoseOccurrence.update({ where: { id: occ.id }, data: { status: 'TAKEN', actedAt: now, takenLogId: existing.id } });
      return { status: 200, occurrence: { ...occ, status: 'TAKEN' }, log: existing, idempotent: true };
    }
    const sup = occ.userSupplement?.supplement || {};
    const qty = Number(payload.quantity) || 1;
    const amount = payload.amount != null ? Number(payload.amount) : (occ.doseAmount ?? null);
    const unit = payload.unit != null ? String(payload.unit) : (occ.doseUnit ?? null);
    const log = await prisma.supplementLog.create({
      data: {
        userId,
        userSupplementId: occ.userSupplementId,
        supplementName: sup.name || 'Supplement',
        quantity: qty,
        calories: (sup.calories || 0) * qty,
        proteinG: (sup.proteinG || 0) * qty,
        carbsG: (sup.carbsG || 0) * qty,
        fatG: (sup.fatG || 0) * qty,
        fiberG: (sup.fiberG || 0) * qty,
        date: occ.localDate,
        occurrenceId: occ.id,
        amount,
        unit,
        timezone: occ.timezone || payload.timezone || null,
        source: payload.source || 'reminder_action',
        idempotencyKey: idem,
      },
    });
    const updated = await prisma.supplementDoseOccurrence.update({
      where: { id: occ.id },
      data: { status: 'TAKEN', actedAt: now, takenLogId: log.id },
    });
    await prisma.userSupplement.update({ where: { id: occ.userSupplementId }, data: { lastTakenAt: now } }).catch(() => {});
    return { status: 200, occurrence: updated, log };
  }

  if (action === 'skipped') {
    const updated = await prisma.supplementDoseOccurrence.update({
      where: { id: occ.id },
      data: { status: 'SKIPPED', actedAt: now },
    });
    return { status: 200, occurrence: updated };
  }

  if (action === 'snoozed') {
    const minutes = [15, 30, 60].includes(Number(payload.minutes)) ? Number(payload.minutes) : 30;
    const updated = await prisma.supplementDoseOccurrence.update({
      where: { id: occ.id },
      data: { status: 'SNOOZED', snoozeUntil: new Date(now.getTime() + minutes * 60000), actedAt: now },
    });
    return { status: 200, occurrence: updated };
  }

  if (action === 'unsnooze' || action === 'pending') {
    const updated = await prisma.supplementDoseOccurrence.update({
      where: { id: occ.id },
      data: { status: 'PENDING', snoozeUntil: null },
    });
    return { status: 200, occurrence: updated };
  }

  if (action === 'cancelled') {
    const updated = await prisma.supplementDoseOccurrence.update({
      where: { id: occ.id },
      data: { status: 'CANCELLED', actedAt: now },
    });
    return { status: 200, occurrence: updated };
  }

  return { status: 400, error: 'action must be taken|skipped|snoozed|pending|cancelled' };
}

// Snoozed occurrences reactivate when their snooze window elapses.
async function reviveSnoozed(prisma, now = new Date()) {
  const res = await prisma.supplementDoseOccurrence.updateMany({
    where: { status: 'SNOOZED', snoozeUntil: { lte: now } },
    data: { status: 'PENDING', snoozeUntil: null },
  });
  return res.count;
}

// 7/30-day adherence summary — descriptive only, never punitive.
async function adherence(prisma, userId, { days = 7 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const occs = await prisma.supplementDoseOccurrence.findMany({
    where: { userId, localDate: { gte: since }, status: { not: 'CANCELLED' } },
    select: { status: true, localDate: true },
  });
  const counts = { taken: 0, skipped: 0, missed: 0, pending: 0, snoozed: 0 };
  for (const o of occs) {
    const k = o.status.toLowerCase();
    if (k in counts) counts[k] += 1;
  }
  const scheduled = occs.length;
  return {
    days,
    scheduled,
    ...counts,
    note: 'Missing or skipped does not mean a supplement was not taken — only confirmed actions are counted.',
  };
}

module.exports = {
  validateScheduleInput,
  generateOccurrences,
  regenerateForUser,
  listOccurrences,
  actOnOccurrence,
  markMissed,
  reviveSnoozed,
  adherence,
  effectiveTimezone,
  TIMING_RELATIONS,
  MEAL_ANCHORS,
  DOSE_UNITS,
};
