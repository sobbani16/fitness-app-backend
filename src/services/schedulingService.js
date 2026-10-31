// Trainer scheduling: weekly availability, session types, bookable-slot
// computation, and the booking lifecycle
// (request -> respond -> cancel / reschedule -> complete).
//
// Time-zone model: bookings are stored as UTC instants only. Trainer
// availability windows are stored as (weekday, startMin, endMin, IANA tz) —
// local wall-clock windows. computeSlots converts each local window to UTC
// per calendar day, so DST transitions shift the UTC start correctly without
// any external tz library (offsets come from Intl.DateTimeFormat).
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const audit = require('./auditService');
const { coachingTransaction } = require('./coachingTransaction');
const {
  requireApprovedTrainer,
  requireActiveRelation,
  requireRelationParticipant,
} = require('./trainerAccess');

const MIN = 60_000;
const DAY = 86_400_000;
// Statuses that occupy trainer time and block new requests. 'rescheduled'
// bookings hold a (pending re-confirmation) slot, so they also block.
const BLOCKING_STATUSES = ['requested', 'confirmed', 'rescheduled'];
const BOOKING_STATUSES = ['requested', 'confirmed', 'declined', 'canceled', 'completed', 'rescheduled'];
const RESPONDABLE_STATUSES = ['requested', 'rescheduled'];
const CANCELABLE_STATUSES = ['requested', 'confirmed', 'rescheduled'];
const MAX_RANGE_DAYS = 93;

// ---------------------------------------------------------------------------
// Time-zone helpers (exported for tests)
// ---------------------------------------------------------------------------

function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map();
function tzFormat(timeZone) {
  let dtf = formatters.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, dtf);
  }
  return dtf;
}

/** Wall-clock fields of `date` expressed in `timeZone`. */
function partsInZone(timeZone, date) {
  const parts = {};
  for (const p of tzFormat(timeZone).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Calendar date + weekday of `date` in `timeZone`. */
function localDateParts(timeZone, date) {
  const p = partsInZone(timeZone, date);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return { year: p.year, month: p.month, day: p.day, weekday };
}

/** Offset (zone minus UTC, ms) of `timeZone` at instant `date`. */
function tzOffsetMs(timeZone, date) {
  const p = partsInZone(timeZone, date);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - (date.getTime() - date.getMilliseconds());
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC epoch ms.
 * The offset depends on the instant being computed, so we refine once:
 * guess with the offset at the naive interpretation, then recompute with the
 * offset at the refined instant. Around the fall-back fold this deterministically
 * picks the earlier (first) occurrence; spring-forward gaps resolve to the
 * pre-transition offset (a nonexistent local time has no correct answer anyway).
 */
function zonedTimeToUtcMs(timeZone, year, month, day, minuteOfDay) {
  const wallAsUtc = Date.UTC(year, month - 1, day) + minuteOfDay * MIN;
  let utc = wallAsUtc - tzOffsetMs(timeZone, new Date(wallAsUtc));
  const refined = wallAsUtc - tzOffsetMs(timeZone, new Date(utc));
  if (refined !== utc) utc = refined;
  return utc;
}

// ---------------------------------------------------------------------------
// Slot computation (pure — unit-testable, exported)
// ---------------------------------------------------------------------------

/**
 * computeSlots({ availability, bookings, sessionType, fromUtc, toUtc, nowUtc })
 *  - availability: [{ weekday, startMin, endMin, timeZone, effectiveFrom?, effectiveTo? }]
 *  - bookings:     [{ startAtUtc, endAtUtc }] (blocking statuses only)
 *  - sessionType:  { durationMin, bufferMin, minNoticeMin }
 * Returns sorted Date[] of bookable slot starts in [fromUtc, toUtc).
 *
 * For every availability window we iterate the calendar days (in the window's
 * own zone) that intersect the range, convert that day's local window to UTC
 * (DST-safe via zonedTimeToUtcMs), then step candidate starts by durationMin.
 * A candidate is dropped when it starts before max(fromUtc, now+minNotice),
 * or when its interval — expanded by the session's bufferMin on both sides —
 * overlaps an existing booking.
 */
function computeSlots({ availability, bookings, sessionType, fromUtc, toUtc, nowUtc }) {
  const durationMs = sessionType.durationMin * MIN;
  const bufferMs = (sessionType.bufferMin || 0) * MIN;
  const notBefore = Math.max(
    fromUtc.getTime(),
    (nowUtc ? nowUtc.getTime() : Date.now()) + (sessionType.minNoticeMin || 0) * MIN,
  );
  const blocked = (bookings || []).map((b) => ({
    start: new Date(b.startAtUtc).getTime(),
    end: new Date(b.endAtUtc).getTime(),
  }));
  const found = new Set();
  // Pad the range by 36h each side so local days whose UTC span partly falls
  // inside [fromUtc, toUtc] are still generated (slots are filtered later).
  for (const w of availability || []) {
    const tz = w.timeZone;
    if (!isValidTimeZone(tz)) continue;
    const first = localDateParts(tz, new Date(fromUtc.getTime() - 36 * 3_600_000));
    const last = localDateParts(tz, new Date(toUtc.getTime() + 36 * 3_600_000));
    const endDay = Date.UTC(last.year, last.month - 1, last.day);
    const effFrom = w.effectiveFrom ? new Date(w.effectiveFrom).getTime() : null;
    const effTo = w.effectiveTo ? new Date(w.effectiveTo).getTime() : null;
    for (let d = Date.UTC(first.year, first.month - 1, first.day); d <= endDay; d += DAY) {
      const day = new Date(d);
      if (day.getUTCDay() !== w.weekday) continue;
      const winStart = zonedTimeToUtcMs(tz, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), w.startMin);
      const winEnd = zonedTimeToUtcMs(tz, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), w.endMin);
      if (!(winEnd > winStart)) continue;
      for (let t = winStart; t + durationMs <= winEnd; t += durationMs) {
        if (t < notBefore || t >= toUtc.getTime()) continue;
        if (effFrom !== null && t < effFrom) continue;
        if (effTo !== null && t > effTo) continue;
        const overlap = blocked.some((b) => b.start < t + durationMs + bufferMs && b.end > t - bufferMs);
        if (!overlap) found.add(t);
      }
    }
  }
  return [...found].sort((a, b) => a - b).map((ms) => new Date(ms));
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function parseInstant(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    throw httpError(400, `Invalid ${field}: expected an ISO 8601 timestamp.`);
  }
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) throw httpError(400, `Invalid ${field}.`);
  return d;
}

function parseDateOrInstant(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    throw httpError(400, `Invalid ${field}.`);
  }
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) throw httpError(400, `Invalid ${field}.`);
  return d;
}

function intField(value, min, max, field) {
  const v = Number(value);
  if (!Number.isInteger(v) || v < min || v > max) throw httpError(400, `${field} must be an integer ${min}-${max}.`);
  return v;
}

function validateWindow(w) {
  if (!w || typeof w !== 'object') throw httpError(400, 'Each availability window must be an object.');
  const weekday = intField(w.weekday, 0, 6, 'weekday');
  const startMin = intField(w.startMin, 0, 1439, 'startMin');
  const endMin = intField(w.endMin, 1, 1440, 'endMin');
  if (startMin >= endMin) throw httpError(400, 'startMin must be before endMin.');
  let timeZone;
  if (w.timeZone !== undefined) {
    if (!isValidTimeZone(w.timeZone)) throw httpError(400, `Invalid timeZone '${w.timeZone}'.`);
    timeZone = w.timeZone;
  }
  const out = { weekday, startMin, endMin, timeZone };
  if (w.effectiveFrom !== undefined) out.effectiveFrom = parseDateOrInstant(w.effectiveFrom, 'effectiveFrom');
  if (w.effectiveTo !== undefined) out.effectiveTo = parseDateOrInstant(w.effectiveTo, 'effectiveTo');
  if (out.effectiveFrom && out.effectiveTo && out.effectiveFrom > out.effectiveTo) {
    throw httpError(400, 'effectiveFrom must be before effectiveTo.');
  }
  return out;
}

// On create, only name + durationMin are required; the rest are omitted so the
// Prisma schema defaults apply (mode 'virtual', bufferMin 0, minNoticeMin 1440,
// cancelWindowMin 1440, active true).
function validateSessionType(data, { partial = false } = {}) {
  const out = {};
  if (!partial || data.name !== undefined) {
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 128) {
      throw httpError(400, 'name is required (max 128 chars).');
    }
    out.name = data.name.trim();
  }
  if (!partial || data.durationMin !== undefined) {
    out.durationMin = intField(data.durationMin, 5, 480, 'durationMin');
  }
  if (data.mode !== undefined) {
    if (!['virtual', 'in_person'].includes(data.mode)) throw httpError(400, "mode must be 'virtual' or 'in_person'.");
    out.mode = data.mode;
  }
  if (data.meetingLink !== undefined) {
    if (data.meetingLink !== null && (typeof data.meetingLink !== 'string' || data.meetingLink.length > 512)) {
      throw httpError(400, 'meetingLink must be a string (max 512 chars).');
    }
    out.meetingLink = data.meetingLink || null;
  }
  for (const [field, max] of [['bufferMin', 240], ['minNoticeMin', 10080], ['cancelWindowMin', 43200]]) {
    if (data[field] !== undefined) out[field] = intField(data[field], 0, max, field);
  }
  if (data.active !== undefined) {
    if (typeof data.active !== 'boolean') throw httpError(400, 'active must be a boolean.');
    out.active = data.active;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

async function getAvailability(trainerUserId) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(trainerUserId);
  const [pref, windows] = await Promise.all([
    prisma.trainerSchedulingPreference.findUnique({ where: { trainerId: trainer.id } }),
    prisma.trainerAvailability.findMany({
      where: { trainerId: trainer.id },
      orderBy: [{ weekday: 'asc' }, { startMin: 'asc' }],
    }),
  ]);
  return { timeZone: pref?.timeZone || trainer.timeZone || 'UTC', windows };
}

/**
 * Replace-all weekly availability. Each window may carry its own IANA tz;
 * when omitted we fall back to TrainerSchedulingPreference.timeZone (or the
 * trainer profile tz, or UTC). `options.timeZone` upserts the preference row.
 */
async function putAvailability(trainerUserId, windows, options = {}) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(trainerUserId);
  if (!Array.isArray(windows)) throw httpError(400, 'windows must be an array.');
  if (windows.length > 100) throw httpError(400, 'At most 100 availability windows.');
  if (options.timeZone !== undefined && !isValidTimeZone(options.timeZone)) {
    throw httpError(400, `Invalid timeZone '${options.timeZone}'.`);
  }
  const pref = await prisma.trainerSchedulingPreference.findUnique({ where: { trainerId: trainer.id } });
  const fallbackTz = options.timeZone || pref?.timeZone || trainer.timeZone || 'UTC';
  const rows = windows.map((w) => {
    const v = validateWindow(w);
    const timeZone = v.timeZone || fallbackTz;
    if (!isValidTimeZone(timeZone)) throw httpError(400, `Invalid timeZone '${timeZone}'.`);
    return {
      trainerId: trainer.id,
      weekday: v.weekday,
      startMin: v.startMin,
      endMin: v.endMin,
      timeZone,
      ...(v.effectiveFrom ? { effectiveFrom: v.effectiveFrom } : {}),
      ...(v.effectiveTo ? { effectiveTo: v.effectiveTo } : {}),
    };
  });
  await coachingTransaction(async (tx) => {
    if (options.timeZone) {
      await tx.trainerSchedulingPreference.upsert({
        where: { trainerId: trainer.id },
        create: { trainerId: trainer.id, timeZone: options.timeZone },
        update: { timeZone: options.timeZone },
      });
    }
    await tx.trainerAvailability.deleteMany({ where: { trainerId: trainer.id } });
    if (rows.length) await tx.trainerAvailability.createMany({ data: rows });
    await audit.log({
      actorId: trainerUserId,
      action: 'schedule.availability_set',
      entityType: 'TrainerAvailability',
      entityId: trainer.id,
      afterData: { trainerId: trainer.id },
    }, tx);
  });
  return prisma.trainerAvailability.findMany({
    where: { trainerId: trainer.id },
    orderBy: [{ weekday: 'asc' }, { startMin: 'asc' }],
  });
}

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

async function createSessionType(trainerUserId, data = {}) {
  const trainer = await requireApprovedTrainer(trainerUserId);
  const clean = validateSessionType(data);
  return coachingTransaction(async (tx) => {
    const sessionType = await tx.trainerSessionType.create({ data: { trainerId: trainer.id, ...clean } });
    await audit.log({
      actorId: trainerUserId,
      action: 'schedule.session_type_created',
      entityType: 'TrainerSessionType',
      entityId: sessionType.id,
      afterData: { trainerId: trainer.id, sessionTypeId: sessionType.id, active: sessionType.active },
    }, tx);
    return sessionType;
  });
}

async function listSessionTypes(trainerUserId, { includeInactive = false } = {}) {
  const trainer = await requireApprovedTrainer(trainerUserId);
  return getPrisma().trainerSessionType.findMany({
    where: { trainerId: trainer.id, ...(includeInactive ? {} : { active: true }) },
    orderBy: { name: 'asc' },
  });
}

async function updateSessionType(trainerUserId, id, data = {}) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(trainerUserId);
  const existing = await prisma.trainerSessionType.findUnique({ where: { id } });
  if (!existing || existing.trainerId !== trainer.id) throw httpError(404, 'Session type not found.');
  const clean = validateSessionType(data, { partial: true });
  if (!Object.keys(clean).length) throw httpError(400, 'Nothing to update.');
  return coachingTransaction(async (tx) => {
    const sessionType = await tx.trainerSessionType.update({ where: { id }, data: clean });
    await audit.log({
      actorId: trainerUserId,
      action: 'schedule.session_type_updated',
      entityType: 'TrainerSessionType',
      entityId: id,
      afterData: { trainerId: trainer.id, sessionTypeId: id, active: sessionType.active },
    }, tx);
    return sessionType;
  });
}

/**
 * DELETE semantics: hard-delete while unreferenced; once bookings exist the
 * session type is deactivated instead so booking history keeps its FK.
 */
async function deleteSessionType(trainerUserId, id) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(trainerUserId);
  const existing = await prisma.trainerSessionType.findUnique({ where: { id } });
  if (!existing || existing.trainerId !== trainer.id) throw httpError(404, 'Session type not found.');
  return coachingTransaction(async (tx) => {
    const referenced = await tx.trainerBooking.count({ where: { sessionTypeId: id } });
    let result;
    if (referenced === 0) {
      await tx.trainerSessionType.delete({ where: { id } });
      result = { deleted: true };
    } else {
      const sessionType = await tx.trainerSessionType.update({ where: { id }, data: { active: false } });
      result = { deleted: false, deactivated: true, sessionType };
    }
    await audit.log({
      actorId: trainerUserId,
      action: 'schedule.session_type_deleted',
      entityType: 'TrainerSessionType',
      entityId: id,
      afterData: { trainerId: trainer.id, sessionTypeId: id, active: false },
    }, tx);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Bookable slots (client-facing)
// ---------------------------------------------------------------------------

/**
 * Route-facing slot query. Access: the trainer themselves or a client with an
 * active relation (arch-doc §6 — scheduling needs active relation only).
 * Returns Date[] slot starts.
 */
async function availableSlots({ userId, trainerId, from, to, sessionTypeId }) {
  const prisma = getPrisma();
  if (typeof trainerId !== 'string' || !trainerId.trim()) throw httpError(400, 'trainerId is required.');
  if (typeof sessionTypeId !== 'string' || !sessionTypeId.trim()) throw httpError(400, 'sessionTypeId is required.');
  const fromUtc = parseDateOrInstant(from, 'from');
  const toUtc = parseDateOrInstant(to, 'to');
  if (toUtc <= fromUtc) throw httpError(400, 'to must be after from.');
  if ((toUtc - fromUtc) / DAY > MAX_RANGE_DAYS) throw httpError(400, `Range must be at most ${MAX_RANGE_DAYS} days.`);

  const trainer = await prisma.trainerProfile.findUnique({ where: { id: trainerId } });
  if (!trainer) throw httpError(404, 'Trainer not found.');
  if (trainer.userId !== userId) {
    await requireActiveRelation({ trainerId: trainer.id, clientUserId: userId });
  }

  const sessionType = await prisma.trainerSessionType.findUnique({ where: { id: sessionTypeId } });
  if (!sessionType || !sessionType.active) throw httpError(404, 'Session type not found.');
  if (sessionType.trainerId !== trainer.id) throw httpError(400, 'Session type does not belong to this trainer.');

  const [pref, windows, bookings] = await Promise.all([
    prisma.trainerSchedulingPreference.findUnique({ where: { trainerId: trainer.id } }),
    prisma.trainerAvailability.findMany({ where: { trainerId: trainer.id } }),
    prisma.trainerBooking.findMany({
      where: {
        relation: { trainerId: trainer.id },
        status: { in: BLOCKING_STATUSES },
        startAtUtc: { lt: new Date(toUtc.getTime() + 24 * 3_600_000) },
        endAtUtc: { gt: new Date(fromUtc.getTime() - 24 * 3_600_000) },
      },
      select: { startAtUtc: true, endAtUtc: true },
    }),
  ]);
  const fallbackTz = pref?.timeZone || trainer.timeZone || 'UTC';
  const availability = windows.map((w) => ({ ...w, timeZone: w.timeZone || fallbackTz }));
  return computeSlots({ availability, bookings, sessionType, fromUtc, toUtc, nowUtc: new Date() });
}

// ---------------------------------------------------------------------------
// Booking lifecycle
// ---------------------------------------------------------------------------

function parseBookingStatus(status) {
  if (status === undefined) return undefined;
  if (!BOOKING_STATUSES.includes(status)) throw httpError(400, `status must be one of ${BOOKING_STATUSES.join('|')}.`);
  return status;
}

function otherPartyId(booking, actorIsClient) {
  return actorIsClient ? booking.relation.trainer.userId : booking.relation.clientId;
}

async function notify(tx, userId, type, title, body) {
  return tx.notification.create({ data: { userId, type, title, body } });
}

function overlapWhere(trainerId, start, end, bufferMs, excludeId) {
  return {
    relation: { trainerId },
    status: { in: BLOCKING_STATUSES },
    startAtUtc: { lt: new Date(end.getTime() + bufferMs) },
    endAtUtc: { gt: new Date(start.getTime() - bufferMs) },
    ...(excludeId ? { id: { not: excludeId } } : {}),
  };
}

/**
 * Request a booking. Caller must be a participant of an ACTIVE relation
 * (client or trainer side). The overlap re-check happens inside the
 * Serializable tx so concurrent requests for the same slot can't both win.
 */
async function requestBooking(userId, { relationId, sessionTypeId, startAtUtc, clientNote } = {}) {
  const prisma = getPrisma();
  if (typeof relationId !== 'string' || !relationId) throw httpError(400, 'relationId is required.');
  if (typeof sessionTypeId !== 'string' || !sessionTypeId) throw httpError(400, 'sessionTypeId is required.');
  if (clientNote !== undefined && (typeof clientNote !== 'string' || clientNote.length > 1000)) {
    throw httpError(400, 'clientNote must be a string (max 1000 chars).');
  }
  const start = parseInstant(startAtUtc, 'startAtUtc');

  const relation = await requireRelationParticipant(relationId, userId);
  if (relation.status !== 'active') throw httpError(403, 'No active coaching relationship.');
  const requestedBy = relation.clientId === userId ? 'client' : 'trainer';

  const sessionType = await prisma.trainerSessionType.findUnique({ where: { id: sessionTypeId } });
  if (!sessionType || !sessionType.active) throw httpError(404, 'Session type not found.');
  if (sessionType.trainerId !== relation.trainerId) {
    throw httpError(400, 'Session type does not belong to this trainer.');
  }
  if (start.getTime() < Date.now() + sessionType.minNoticeMin * MIN) {
    const err = httpError(400, 'Start time is inside the minimum notice window.');
    err.code = 'MIN_NOTICE';
    throw err;
  }
  const end = new Date(start.getTime() + sessionType.durationMin * MIN);

  return coachingTransaction(async (tx) => {
    // Re-verify inside the tx: the relation may have been dropped concurrently.
    const rel = await tx.trainerClient.findUnique({ where: { id: relationId } });
    if (!rel || rel.status !== 'active') throw httpError(403, 'No active coaching relationship.');

    const clash = await tx.trainerBooking.findFirst({
      where: overlapWhere(rel.trainerId, start, end, sessionType.bufferMin * MIN),
      select: { id: true },
    });
    if (clash) {
      const err = httpError(409, 'Requested slot overlaps an existing booking.');
      err.code = 'SLOT_TAKEN';
      throw err;
    }
    const booking = await tx.trainerBooking.create({
      data: {
        relationId,
        sessionTypeId,
        startAtUtc: start,
        endAtUtc: end,
        status: 'requested',
        requestedBy,
        meetingLink: sessionType.meetingLink || null,
        clientNote: clientNote || null,
      },
    });
    await tx.trainerBookingEvent.create({
      data: { bookingId: booking.id, actorId: userId, action: 'requested', toStart: start },
    });
    await notify(
      tx,
      otherPartyId({ relation }, requestedBy === 'client'),
      'trainer.booking_requested',
      'New booking request',
      `A ${sessionType.name} session was requested for ${start.toISOString()}.`,
    );
    await audit.log({
      actorId: userId,
      action: 'booking.requested',
      entityType: 'TrainerBooking',
      entityId: booking.id,
      afterData: {
        trainerId: rel.trainerId,
        clientId: rel.clientId,
        relationId,
        sessionTypeId,
        status: 'requested',
        startAtUtc: start.toISOString(),
      },
    }, tx);
    return booking;
  });
}

async function loadBooking(bookingId) {
  const booking = await getPrisma().trainerBooking.findUnique({
    where: { id: bookingId },
    include: {
      sessionType: true,
      relation: { include: { trainer: { select: { id: true, userId: true } } } },
    },
  });
  if (!booking) throw httpError(404, 'Booking not found.');
  return booking;
}

/** Trainer responds to a requested (or rescheduled-pending) booking. */
async function respond(bookingId, trainerUserId, action) {
  const prisma = getPrisma();
  if (!['confirm', 'decline'].includes(action)) throw httpError(400, "action must be 'confirm' or 'decline'.");
  const trainer = await requireApprovedTrainer(trainerUserId);
  const booking = await loadBooking(bookingId);
  if (booking.relation.trainerId !== trainer.id) throw httpError(403, 'Booking does not belong to this trainer.');
  if (!RESPONDABLE_STATUSES.includes(booking.status)) {
    throw httpError(409, `Booking is ${booking.status} and cannot be responded to.`);
  }
  const status = action === 'confirm' ? 'confirmed' : 'declined';
  return coachingTransaction(async (tx) => {
    const updated = await tx.trainerBooking.update({ where: { id: bookingId }, data: { status } });
    await tx.trainerBookingEvent.create({
      data: { bookingId, actorId: trainerUserId, action: status, fromStart: booking.startAtUtc, toStart: booking.startAtUtc },
    });
    await notify(
      tx,
      booking.relation.clientId,
      'trainer.booking_responded',
      `Booking ${status}`,
      `Your ${booking.sessionType.name} session on ${booking.startAtUtc.toISOString()} was ${status}.`,
    );
    await audit.log({
      actorId: trainerUserId,
      action: `booking.${status}`,
      entityType: 'TrainerBooking',
      entityId: bookingId,
      beforeData: { status: booking.status },
      afterData: { trainerId: trainer.id, relationId: booking.relationId, status, startAtUtc: booking.startAtUtc.toISOString() },
    }, tx);
    return updated;
  });
}

/**
 * Cancel a booking. Either participant may cancel; client cancels of
 * confirmed/rescheduled bookings must respect the session type's
 * cancelWindowMin (requested bookings may be withdrawn anytime).
 */
async function cancel(bookingId, userId) {
  const booking = await loadBooking(bookingId);
  const isClient = booking.relation.clientId === userId;
  const isTrainer = booking.relation.trainer.userId === userId;
  if (!isClient && !isTrainer) throw httpError(403, 'Not a participant of this booking.');
  if (!CANCELABLE_STATUSES.includes(booking.status)) {
    throw httpError(409, `Booking is ${booking.status} and cannot be canceled.`);
  }
  if (isClient && booking.status !== 'requested') {
    const deadline = booking.startAtUtc.getTime() - booking.sessionType.cancelWindowMin * MIN;
    if (Date.now() > deadline) {
      const err = httpError(409, 'The cancel window for this booking has passed.');
      err.code = 'CANCEL_WINDOW';
      throw err;
    }
  }
  return coachingTransaction(async (tx) => {
    const updated = await tx.trainerBooking.update({ where: { id: bookingId }, data: { status: 'canceled' } });
    await tx.trainerBookingEvent.create({
      data: { bookingId, actorId: userId, action: 'canceled', fromStart: booking.startAtUtc },
    });
    await notify(
      tx,
      otherPartyId(booking, isClient),
      'trainer.booking_canceled',
      'Booking canceled',
      `The ${booking.sessionType.name} session on ${booking.startAtUtc.toISOString()} was canceled.`,
    );
    await audit.log({
      actorId: userId,
      action: 'booking.canceled',
      entityType: 'TrainerBooking',
      entityId: bookingId,
      beforeData: { status: booking.status },
      afterData: { status: 'canceled', relationId: booking.relationId, startAtUtc: booking.startAtUtc.toISOString() },
    }, tx);
    return updated;
  });
}

/**
 * Move a booking to a new start time. The overlap check excludes the booking
 * itself and runs inside the Serializable tx. Status becomes 'rescheduled'
 * (pending re-confirmation via respond); the event records from/to.
 */
async function reschedule(bookingId, userId, newStartAtUtc) {
  const booking = await loadBooking(bookingId);
  const isClient = booking.relation.clientId === userId;
  const isTrainer = booking.relation.trainer.userId === userId;
  if (!isClient && !isTrainer) throw httpError(403, 'Not a participant of this booking.');
  if (!CANCELABLE_STATUSES.includes(booking.status)) {
    throw httpError(409, `Booking is ${booking.status} and cannot be rescheduled.`);
  }
  const start = parseInstant(newStartAtUtc, 'startAtUtc');
  const end = new Date(start.getTime() + booking.sessionType.durationMin * MIN);
  return coachingTransaction(async (tx) => {
    const clash = await tx.trainerBooking.findFirst({
      where: overlapWhere(booking.relation.trainerId, start, end, booking.sessionType.bufferMin * MIN, bookingId),
      select: { id: true },
    });
    if (clash) {
      const err = httpError(409, 'Requested slot overlaps an existing booking.');
      err.code = 'SLOT_TAKEN';
      throw err;
    }
    const updated = await tx.trainerBooking.update({
      where: { id: bookingId },
      data: { startAtUtc: start, endAtUtc: end, status: 'rescheduled' },
    });
    await tx.trainerBookingEvent.create({
      data: { bookingId, actorId: userId, action: 'rescheduled', fromStart: booking.startAtUtc, toStart: start },
    });
    await notify(
      tx,
      otherPartyId(booking, isClient),
      'trainer.booking_rescheduled',
      'Booking rescheduled',
      `The ${booking.sessionType.name} session moved from ${booking.startAtUtc.toISOString()} to ${start.toISOString()}.`,
    );
    await audit.log({
      actorId: userId,
      action: 'booking.rescheduled',
      entityType: 'TrainerBooking',
      entityId: bookingId,
      beforeData: { status: booking.status, startAtUtc: booking.startAtUtc.toISOString() },
      afterData: { status: 'rescheduled', relationId: booking.relationId, startAtUtc: start.toISOString() },
    }, tx);
    return updated;
  });
}

/** Mark a past confirmed booking completed (trainer only). */
async function markCompleted(trainerUserId, bookingId) {
  const trainer = await requireApprovedTrainer(trainerUserId);
  const booking = await loadBooking(bookingId);
  if (booking.relation.trainerId !== trainer.id) throw httpError(403, 'Booking does not belong to this trainer.');
  if (booking.status !== 'confirmed') throw httpError(409, `Booking is ${booking.status}; only confirmed bookings can be completed.`);
  if (booking.endAtUtc.getTime() > Date.now()) throw httpError(409, 'Session has not ended yet.');
  return coachingTransaction(async (tx) => {
    const updated = await tx.trainerBooking.update({ where: { id: bookingId }, data: { status: 'completed' } });
    await tx.trainerBookingEvent.create({
      data: { bookingId, actorId: trainerUserId, action: 'completed', fromStart: booking.startAtUtc },
    });
    await notify(
      tx,
      booking.relation.clientId,
      'trainer.booking_completed',
      'Session completed',
      `Your ${booking.sessionType.name} session on ${booking.startAtUtc.toISOString()} was marked completed.`,
    );
    await audit.log({
      actorId: trainerUserId,
      action: 'booking.completed',
      entityType: 'TrainerBooking',
      entityId: bookingId,
      beforeData: { status: 'confirmed' },
      afterData: { status: 'completed', relationId: booking.relationId, startAtUtc: booking.startAtUtc.toISOString() },
    }, tx);
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

async function listForClient(userId) {
  return getPrisma().trainerBooking.findMany({
    where: { relation: { clientId: userId } },
    include: {
      sessionType: true,
      relation: { include: { trainer: { select: { id: true, displayName: true } } } },
    },
    orderBy: { startAtUtc: 'desc' },
    take: 100,
  });
}

async function listForTrainer(trainerUserId, { status, from } = {}) {
  const trainer = await requireApprovedTrainer(trainerUserId);
  const where = { relation: { trainerId: trainer.id } };
  const parsedStatus = parseBookingStatus(status);
  if (parsedStatus) where.status = parsedStatus;
  if (from !== undefined) where.startAtUtc = { gte: parseDateOrInstant(from, 'from') };
  return getPrisma().trainerBooking.findMany({
    where,
    include: {
      sessionType: true,
      relation: { select: { id: true, clientId: true, status: true } },
    },
    orderBy: { startAtUtc: 'asc' },
    take: 200,
  });
}

module.exports = {
  // tz helpers (exported for tests / reuse)
  isValidTimeZone,
  tzOffsetMs,
  zonedTimeToUtcMs,
  localDateParts,
  // pure slot engine
  computeSlots,
  // availability + prefs
  getAvailability,
  putAvailability,
  // session types
  createSessionType,
  listSessionTypes,
  updateSessionType,
  deleteSessionType,
  // slots
  availableSlots,
  // booking lifecycle
  requestBooking,
  respond,
  cancel,
  reschedule,
  markCompleted,
  listForClient,
  listForTrainer,
};
