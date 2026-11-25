// Camera-coaching session service.
//
// Privacy contract: sessions store landmark-derived analytics only — never
// raw frames, images, or video. Sessions are created only with explicit
// consentToStore === true; a camera session the user declines to keep is
// simply never sent. confirmedReps is user-reviewed data; countedReps is the
// raw camera count. Neither is written to WorkoutSession/ExerciseSet here —
// the client logs workouts through the existing path after review.

const { getPrisma } = require('../lib/prisma');

const MAX_DIAGNOSTIC_REPS = 500;
const MAX_OBSERVATIONS = 200;

const err = (status, message) => Object.assign(new Error(message), { status });

function sanitizeDiagnostics(list) {
  if (!Array.isArray(list)) return null;
  return list.slice(0, MAX_DIAGNOSTIC_REPS).map((d) => ({
    rep: typeof d.rep === 'number' ? d.rep : null,
    side: ['left', 'right', 'unknown'].includes(d.side) ? d.side : 'unknown',
    samplesUsed: Math.max(0, Math.min(10000, Number(d.samplesUsed) || 0)),
    minVisibilitySeen: Math.max(0, Math.min(1, Number(d.minVisibilitySeen) || 0)),
    rangeOfMotion: Math.max(0, Math.min(360, Number(d.rangeOfMotion) || 0)),
    durationMs: Math.max(0, Math.min(600000, Number(d.durationMs) || 0)),
  }));
}

function sanitizeObservations(list) {
  if (!Array.isArray(list)) return null;
  return list.slice(0, MAX_OBSERVATIONS).map((o) => ({
    ruleId: typeof o.ruleId === 'string' ? o.ruleId.slice(0, 80) : null,
    deviation: typeof o.deviation === 'string' ? o.deviation.slice(0, 120) : null,
    confidence: Math.max(0, Math.min(1, Number(o.confidence) || 0)),
    priority: ['info', 'coach', 'suspend'].includes(o.priority) ? o.priority : 'info',
  }));
}

async function createSession(userId, body) {
  if (body.consentToStore !== true) {
    // Explicit non-consent → nothing persisted. Not an error.
    return { stored: false };
  }
  const exerciseId = String(body.exerciseId || '').trim();
  if (!exerciseId || exerciseId.length > 80) throw err(400, 'exerciseId is required (≤80 chars)');
  const startedAt = body.startedAt ? new Date(body.startedAt) : null;
  if (!startedAt || Number.isNaN(startedAt.getTime())) throw err(400, 'valid startedAt is required');
  let endedAt = null;
  if (body.endedAt != null) {
    endedAt = new Date(body.endedAt);
    if (Number.isNaN(endedAt.getTime())) throw err(400, 'endedAt must be a valid date');
    if (endedAt < startedAt) throw err(400, 'endedAt must not precede startedAt');
  }
  const clientRef = typeof body.clientRef === 'string' && /^[\w:.-]{8,80}$/.test(body.clientRef) ? body.clientRef : null;

  // Idempotent create: a retried POST with the same clientRef returns the
  // existing row instead of duplicating the session.
  if (clientRef) {
    const existing = await getPrisma().coachingSession.findUnique({
      where: { userId_clientRef: { userId, clientRef } },
    }).catch(() => null);
    if (existing) return { stored: true, session: existing, idempotent: true };
  }

  const session = await getPrisma().coachingSession.create({
    data: {
      userId,
      clientRef,
      exerciseId,
      startedAt,
      endedAt,
      devicePlatform: String(body.devicePlatform || '').slice(0, 16) || null,
      appBuild: String(body.appBuild || '').slice(0, 80) || null,
      modelVersion: String(body.modelVersion || '').slice(0, 80) || null,
      ruleVersion: String(body.ruleVersion || '').slice(0, 80) || null,
      cameraView: ['side', 'front', 'unknown'].includes(body.cameraView) ? body.cameraView : null,
      countedReps: Math.max(0, Math.min(100000, Number(body.countedReps) || 0)),
      repDiagnostics: sanitizeDiagnostics(body.repDiagnostics),
      observations: sanitizeObservations(body.observations),
      limitations: String(body.limitations || '').slice(0, 400) || null,
      consentToStore: true,
    },
  }).catch(async (e) => {
    // Concurrent retried create: the unique (userId, clientRef) constraint
    // makes the loser re-read the winner's row instead of duplicating.
    if (e?.code === 'P2002' && clientRef) {
      const existing = await getPrisma().coachingSession.findUnique({
        where: { userId_clientRef: { userId, clientRef } },
      }).catch(() => null);
      if (existing) return existing;
    }
    throw e;
  });
  return { stored: true, session };
}

async function listSessions(userId, { exerciseId, limit = 50, cursor } = {}) {
  const take = Math.min(200, Math.max(1, Number(limit) || 50));
  const sessions = await getPrisma().coachingSession.findMany({
    where: { userId, ...(exerciseId ? { exerciseId } : {}) },
    orderBy: { startedAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const nextCursor = sessions.length > take ? sessions[take].id : null;
  return { sessions: sessions.slice(0, take), nextCursor };
}

async function getSession(userId, id) {
  const s = await getPrisma().coachingSession.findUnique({ where: { id } });
  if (!s || s.userId !== userId) throw err(404, 'Session not found');
  return s;
}

// finalize: user confirms/corrects the counted reps or discards the session.
async function finalizeSession(userId, id, body) {
  const s = await getSession(userId, id);
  const data = {};
  if (body.confirmedReps !== undefined) {
    const n = Number(body.confirmedReps);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw err(400, 'confirmedReps must be an integer 0..100000');
    data.confirmedReps = n;
    data.discarded = false;
  }
  if (body.discarded === true) {
    data.discarded = true;
    data.confirmedReps = null;
  }
  if (body.corrections !== undefined) {
    data.corrections = {
      adjust: Math.max(-100000, Math.min(100000, Number(body.corrections?.adjust) || 0)),
      final: Math.max(0, Math.min(100000, Number(body.corrections?.final) || 0)),
      ...(typeof body.corrections?.note === 'string' ? { note: body.corrections.note.slice(0, 200) } : {}),
    };
  }
  if (body.endedAt) data.endedAt = new Date(body.endedAt);
  if (!Object.keys(data).length) throw err(400, 'Nothing to update');
  return getPrisma().coachingSession.update({ where: { id: s.id }, data });
}

// Consent withdrawal / user-controlled deletion — owner only, hard delete
// (the record is the sensitive artifact; there is no softer artifact to keep).
async function deleteSession(userId, id) {
  const s = await getSession(userId, id);
  await getPrisma().coachingSession.delete({ where: { id: s.id } });
  return { deleted: true };
}

module.exports = {
  createSession,
  listSessions,
  getSession,
  finalizeSession,
  deleteSession,
};
