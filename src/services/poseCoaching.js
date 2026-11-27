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

// Optional date field — absent/null → null; present-but-invalid → 400.
// Persisting an Invalid Date object crashes the prisma write as a 500.
function optionalDate(value, field) {
  if (value === undefined || value === null) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw err(400, `valid ${field} is required`);
  return d;
}

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

  // Idempotency: a client-generated op id makes retry/offline-sync redelivery
  // a no-op returning the existing session — never a duplicate workout.
  const clientOpId = typeof body.clientOpId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(body.clientOpId)
    ? body.clientOpId : null;
  if (body.clientOpId != null && !clientOpId) throw err(400, 'clientOpId must be ≤100 chars of [a-zA-Z0-9_-]');
  if (clientOpId) {
    const existing = await getPrisma().coachingSession.findUnique({ where: { clientOpId } });
    if (existing) {
      if (existing.userId !== userId) throw err(409, 'clientOpId conflict');
      return { stored: true, session: existing, deduplicated: true };
    }
  }
  const session = await getPrisma().coachingSession.create({
    data: {
      userId,
      exerciseId,
      clientOpId,
      startedAt,
      endedAt: optionalDate(body.endedAt, 'endedAt'),
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
  if (body.endedAt !== undefined) data.endedAt = optionalDate(body.endedAt, 'endedAt');
  if (!Object.keys(data).length) throw err(400, 'Nothing to update');
  return getPrisma().coachingSession.update({ where: { id: s.id }, data });
}

// Consent withdrawal / user-controlled deletion — owner only, hard delete
// (the record is the sensitive artifact; there is no softer artifact to keep).
// §28 progress summary — version-aware by construction. Progress claims across
// differing measurement versions are unreliable: a model/rules change alters
// what a "rep" means, so the summary segments history by (modelVersion,
// ruleVersion) and refuses to present a single cross-version trend line.
// Provenance is never collapsed: auto vs user-confirmed vs corrected counts
// remain distinct, and discarded sessions are excluded from trend math but
// reported in meta. No calories/weight/activation are computed anywhere here.
async function progressSummary(userId, { exerciseId } = {}) {
  const where = { userId, consentToStore: true, ...(exerciseId ? { exerciseId } : {}) };
  const rows = await getPrisma().coachingSession.findMany({
    where,
    orderBy: { startedAt: 'asc' },
    select: {
      id: true, exerciseId: true, startedAt: true, countedReps: true,
      confirmedReps: true, discarded: true, modelVersion: true, ruleVersion: true,
    },
  });
  const live = rows.filter((r) => !r.discarded);
  const vkey = (r) => `${r.modelVersion || 'unknown'}|${r.ruleVersion || 'unknown'}`;
  const versions = new Map();
  for (const r of live) {
    const k = vkey(r);
    if (!versions.has(k)) versions.set(k, { modelVersion: r.modelVersion || null, ruleVersion: r.ruleVersion || null, sessions: 0, effectiveReps: 0, firstAt: r.startedAt, lastAt: r.startedAt });
    const v = versions.get(k);
    v.sessions += 1;
    v.effectiveReps += (r.confirmedReps ?? r.countedReps) || 0;
    if (r.startedAt < v.firstAt) v.firstAt = r.startedAt;
    if (r.startedAt > v.lastAt) v.lastAt = r.startedAt;
  }
  const orderedKeys = [...versions.keys()];
  const correctedCount = live.filter((r) => r.confirmedReps != null && r.confirmedReps !== r.countedReps).length;
  const confirmedCount = live.filter((r) => r.confirmedReps != null).length;
  return {
    exerciseId: exerciseId || null,
    sessions: {
      total: live.length,
      discarded: rows.length - live.length,
      autoOnly: live.length - confirmedCount,          // provenance: camera count never reviewed
      userConfirmed: confirmedCount,
      corrected: correctedCount,                        // confirmed differs from counted — measurement disagreement signal
    },
    versions: [...versions.values()].sort((a, b) => new Date(a.firstAt) - new Date(b.firstAt)),
    distinctVersions: orderedKeys.length,
    // honest comparability verdict: a single-version history supports trend
    // reading; multi-version history does not — measurement changed mid-stream.
    crossVersionComparable: orderedKeys.length <= 1,
    comparabilityNote: orderedKeys.length <= 1
      ? null
      : 'Progress comparisons span differing model/rule versions — measurement definitions changed. Compare within version segments only.',
    trend: live.map((r) => ({
      sessionId: r.id,
      exerciseId: r.exerciseId,
      at: r.startedAt,
      effectiveReps: (r.confirmedReps ?? r.countedReps) || 0,
      provenance: r.confirmedReps != null ? (r.confirmedReps !== r.countedReps ? 'user-corrected' : 'user-confirmed') : 'auto',
      versionKey: vkey(r),
    })),
  };
}

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
  progressSummary,
};
