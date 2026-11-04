// Coaching intake v1 — progressive baseline assessment per relationship.
// Any subset of sections may be saved at any time; nothing is mandatory up
// front. Edits after submission create a new version — history is never
// overwritten. Private health conditions are never auto-attached; real data
// sharing stays governed by TrainerClientConsent grants.
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { requireRelationParticipant } = require('./trainerAccess');
const { CONSENT_CATEGORIES } = require('./trainerAccess');

const TEXT_SECTIONS = [
  'objective', 'motivation', 'currentRoutine', 'availableTime',
  'foodPreferences', 'restrictions', 'functionalAbilities', 'pastBarriers',
  'coachingStyle', 'communicationPrefs',
];
const LIST_SECTIONS = ['equipment', 'preferredActivities'];
const EXPERIENCE = ['none', 'beginner', 'intermediate', 'advanced', 'returning'];
const SECTION_KEYS = [...TEXT_SECTIONS, 'experience', ...LIST_SECTIONS, 'startingMeasurements', 'dataSharing'];

function cleanText(v, key, max = 2000) {
  if (typeof v !== 'string') throw httpError(400, `${key} must be a string`);
  const s = v.trim();
  if (s.length > max) throw httpError(400, `${key} exceeds ${max} characters`);
  return s || null;
}

function cleanList(v, key) {
  if (!Array.isArray(v) || v.length > 20) throw httpError(400, `${key} must be a list of ≤20 items`);
  return v.map(x => {
    const s = String(x ?? '').trim().slice(0, 80);
    if (!s) throw httpError(400, `${key} items must be non-empty strings`);
    return s;
  });
}

function cleanMeasurements(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw httpError(400, 'startingMeasurements must be an object');
  const out = {};
  const num = (k, lo, hi) => {
    if (v[k] == null) return;
    const n = Number(v[k]);
    if (!Number.isFinite(n) || n < lo || n > hi) throw httpError(400, `startingMeasurements.${k} must be ${lo}–${hi}`);
    out[k] = n;
  };
  num('weightKg', 20, 500); num('heightCm', 50, 280); num('waistCm', 20, 300); num('restingHeartRate', 25, 220);
  if (v.note != null) out.note = cleanText(v.note, 'startingMeasurements.note', 500) || undefined;
  return out;
}

function cleanDataSharing(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw httpError(400, 'dataSharing must be an object');
  const out = {};
  if (v.categories != null) {
    if (!Array.isArray(v.categories)) throw httpError(400, 'dataSharing.categories must be a list');
    const bad = v.categories.filter(c => !CONSENT_CATEGORIES.includes(c));
    if (bad.length) throw httpError(400, `Unknown consent categories: ${bad.join(', ')}`);
    out.categories = v.categories;
  }
  if (v.note != null) out.note = cleanText(v.note, 'dataSharing.note', 500) || undefined;
  return out;
}

// Validates a partial patch; returns only known, well-formed keys.
// Passing null/'' for a text or list section clears it.
function validatePatch(patch) {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw httpError(400, 'Intake patch must be an object');
  const out = {};
  for (const [key, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (!SECTION_KEYS.includes(key)) throw httpError(400, `Unknown intake section: ${key}`);
    if (TEXT_SECTIONS.includes(key)) { const s = cleanText(v ?? '', key); if (s != null) out[key] = s; else out[key] = null; }
    else if (LIST_SECTIONS.includes(key)) out[key] = v == null ? null : cleanList(v, key);
    else if (key === 'experience') {
      if (v == null) { out.experience = null; continue; }
      if (!EXPERIENCE.includes(v)) throw httpError(400, `experience must be one of: ${EXPERIENCE.join(', ')}`);
      out.experience = v;
    } else if (key === 'startingMeasurements') out.startingMeasurements = v == null ? null : cleanMeasurements(v);
    else if (key === 'dataSharing') out.dataSharing = v == null ? null : cleanDataSharing(v);
  }
  return out;
}

function progress(data = {}) {
  const filled = SECTION_KEYS.filter(k => {
    const v = data[k];
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return String(v).trim().length > 0;
  });
  return { completed: filled.length, total: SECTION_KEYS.length, missing: SECTION_KEYS.filter(k => !filled.includes(k)) };
}

async function latest(relationId) {
  const rows = await getPrisma().baselineAssessment.findMany({
    where: { relationId }, orderBy: { version: 'desc' }, take: 1,
  });
  return rows[0] || null;
}

function shape(row) {
  if (!row) return null;
  return { ...row, progress: progress(row.data || {}) };
}

// GET — either participant sees the latest version + history metadata.
async function getIntake(relationId, userId) {
  await requireRelationParticipant(relationId, userId);
  const versions = await getPrisma().baselineAssessment.findMany({
    where: { relationId }, orderBy: { version: 'desc' },
    select: { id: true, version: true, status: true, supersedesId: true, updatedBy: true, submittedAt: true, reviewedAt: true, createdAt: true },
  });
  return {
    version: 'coaching-intake-v1',
    sections: SECTION_KEYS,
    latest: shape(versions.length ? await getPrisma().baselineAssessment.findUnique({ where: { id: versions[0].id } }) : null),
    versions,
    note: 'Intake is member-entered and shared only with this coach. Private health conditions are never attached automatically — sharing stays under member consent controls.',
  };
}

// PUT — patch the in-progress draft; creates v1 or supersedes a frozen version.
async function patchIntake(relationId, userId, patch) {
  const relation = await requireRelationParticipant(relationId, userId);
  if (relation.status !== 'active') throw httpError(409, 'Coaching relationship is not active.');
  const data = validatePatch(patch);
  if (!Object.keys(data).length) throw httpError(400, 'No intake sections provided.');
  const prisma = getPrisma();
  const prev = await latest(relationId);
  if (!prev) {
    const created = await prisma.baselineAssessment.create({
      data: { relationId, trainerId: relation.trainerId, clientId: relation.clientId, version: 1, data, updatedBy: userId },
    });
    return { created: true, assessment: shape(created) };
  }
  if (prev.status === 'in_progress') {
    const merged = { ...(prev.data || {}), ...data };
    for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
    const saved = await prisma.baselineAssessment.update({ where: { id: prev.id }, data: { data: merged, updatedBy: userId } });
    return { created: false, assessment: shape(saved) };
  }
  // Latest version is frozen — open a new version carrying forward its data.
  const merged = { ...(prev.data || {}), ...data };
  for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
  const created = await prisma.baselineAssessment.create({
    data: {
      relationId, trainerId: relation.trainerId, clientId: relation.clientId,
      version: prev.version + 1, supersedesId: prev.id, data: merged, updatedBy: userId,
    },
  });
  return { created: true, assessment: shape(created) };
}

// POST /submit — freeze the current in-progress draft for trainer review.
async function submitIntake(relationId, userId) {
  const relation = await requireRelationParticipant(relationId, userId);
  if (relation.status !== 'active') throw httpError(409, 'Coaching relationship is not active.');
  const prev = await latest(relationId);
  if (!prev) throw httpError(404, 'No intake to submit — save at least one section first.');
  if (prev.status !== 'in_progress') return { assessment: shape(prev), alreadySubmitted: true };
  const saved = await getPrisma().baselineAssessment.update({
    where: { id: prev.id },
    data: { status: 'submitted', submittedAt: new Date(), submittedBy: userId },
  });
  return { assessment: shape(saved) };
}

// POST /review — trainer marks the submitted version reviewed.
async function reviewIntake(relationId, userId) {
  const relation = await requireRelationParticipant(relationId, userId);
  if (relation.trainer.userId !== userId) throw httpError(403, 'Only the coach may mark intake reviewed.');
  if (relation.status !== 'active') throw httpError(409, 'Coaching relationship is not active.');
  const prev = await latest(relationId);
  if (!prev || prev.status === 'in_progress') throw httpError(409, 'Nothing submitted to review yet.');
  if (prev.status === 'reviewed') return { assessment: shape(prev), alreadyReviewed: true };
  const saved = await getPrisma().baselineAssessment.update({
    where: { id: prev.id },
    data: { status: 'reviewed', reviewedAt: new Date(), reviewedBy: userId },
  });
  return { assessment: shape(saved) };
}

module.exports = { SECTION_KEYS, getIntake, patchIntake, submitIntake, reviewIntake };
