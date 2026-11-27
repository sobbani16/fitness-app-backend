// HUM-100 P3: consent-gated pose recording platform.
// Invariant chain per ingest: active consent covering the required scope →
// licensing gate allows the dataset for the purpose → metadata valid per the
// annotation contract. Revocation cascades: every clip of the participant is
// deletion-marked — no orphaned training data after withdrawal.
const crypto = require('crypto');
const { gateIngest } = require('./datasetLicensing');
const { getExercise } = require('./exerciseDefinitions');

const httpError = (status, message) => Object.assign(new Error(message), { status });

const SCOPE_KEYS = ['landmark_storage', 'raw_video', 'training_use', 'evaluation_use'];
const VIEWPOINTS = new Set(['front', 'side', 'rear', 'oblique']);
const CONSENT_VERSION = 'pose-recording-v1';

function participantKeyFor(userId, consentId) {
  // pseudonymous — reversible only inside the consent record itself
  return 'pcp_' + crypto.createHash('sha256').update(`${userId}:${consentId}`).digest('hex').slice(0, 24);
}

function validateScopeItems(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw httpError(400, 'scopeItems must be an object');
  const unknown = Object.keys(scope).filter((k) => !SCOPE_KEYS.includes(k));
  if (unknown.length) throw httpError(400, `unknown scope keys: ${unknown.join(',')} — valid: ${SCOPE_KEYS.join(',')}`);
  for (const k of SCOPE_KEYS) {
    if (scope[k] !== undefined && typeof scope[k] !== 'boolean') throw httpError(400, `scopeItems.${k} must be boolean`);
  }
  if (scope.landmark_storage !== true) throw httpError(400, 'landmark_storage consent is the mandatory minimum — clips cannot exist without it');
  return Object.fromEntries(SCOPE_KEYS.map((k) => [k, scope[k] === true]));
}

async function grantConsent(prisma, userId, { scopeItems, consentVersion = CONSENT_VERSION }) {
  const scope = validateScopeItems(scopeItems);
  const id = crypto.randomUUID();
  const row = await prisma.poseConsent.create({
    data: { id, userId, participantKey: participantKeyFor(userId, id), scopeItems: scope, consentVersion },
  });
  return row;
}

function activeConsent(consent) {
  return consent && !consent.revokedAt;
}

async function ingestClip(prisma, userId, payload) {
  const consent = await prisma.poseConsent.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { signedAt: 'desc' },
  });
  if (!activeConsent(consent)) throw httpError(403, 'consent_required: no active pose-recording consent — grant consent before uploading clips');

  const scope = consent.scopeItems || {};
  const landmarkOnly = payload.landmarkOnly !== false; // default true — raw video is opt-in only
  if (!landmarkOnly && scope.raw_video !== true) {
    throw httpError(403, 'raw_video consent required: this clip stores raw video but consent covers landmarks only');
  }
  if (scope.training_use !== true) {
    throw httpError(403, 'training_use consent required for dataset ingest');
  }

  // licensing gate — the dataset must be ingest-legal for training purposes
  const datasetId = typeof payload.datasetId === 'string' && payload.datasetId ? payload.datasetId : 'humai-self-recorded';
  const gate = gateIngest(datasetId, { purpose: 'training' });
  if (!gate.allowed) throw httpError(422, `licensing_gate_blocked: ${gate.reason}`);

  // metadata contract — exercise must exist in the P4 definitions
  const exerciseId = String(payload.exerciseId || '');
  if (!getExercise(exerciseId)) throw httpError(400, `unknown exerciseId '${exerciseId}' — must be one of the P4 exercise definitions`);
  const durationMs = Number(payload.durationMs);
  if (!Number.isInteger(durationMs) || durationMs < 500 || durationMs > 600000) {
    throw httpError(400, 'durationMs must be an integer within 500..600000');
  }
  const sha256 = String(payload.sha256 || '');
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw httpError(400, 'sha256 must be a lowercase hex digest — provenance is mandatory');
  const storageRef = String(payload.storageRef || '');
  if (storageRef.length < 8 || storageRef.length > 512) throw httpError(400, 'storageRef must be an opaque object-store reference (8-512 chars)');
  const viewpoint = payload.viewpoint == null ? null : String(payload.viewpoint);
  if (viewpoint && !VIEWPOINTS.has(viewpoint)) throw httpError(400, `viewpoint must be one of ${[...VIEWPOINTS].join('|')}`);

  return prisma.poseClip.create({
    data: {
      consentId: consent.id,
      participantKey: consent.participantKey,
      exerciseId,
      datasetId,
      storageRef,
      landmarkOnly,
      durationMs,
      frameCount: Number.isInteger(payload.frameCount) ? payload.frameCount : null,
      viewpoint,
      sha256,
    },
  });
}

async function revokeConsent(prisma, userId, { channel = 'in_app' } = {}) {
  const consent = await prisma.poseConsent.findFirst({ where: { userId, revokedAt: null } });
  if (!consent) throw httpError(404, 'no active consent to revoke');
  const now = new Date();
  // cascade: every clip of this participant is deletion-marked atomically with
  // the revocation — after withdrawal, no usable training data may remain.
  return prisma.$transaction(async (tx) => {
    const revoked = await tx.poseConsent.update({
      where: { id: consent.id },
      data: { revokedAt: now, revocationChannel: channel },
    });
    const cascade = await tx.poseClip.updateMany({
      where: { consentId: consent.id, status: { not: 'deleted' } },
      data: { status: 'deleted', deletedAt: now },
    });
    return { revoked, clipsDeleted: cascade.count };
  });
}

module.exports = { grantConsent, ingestClip, revokeConsent, validateScopeItems, participantKeyFor, CONSENT_VERSION };
