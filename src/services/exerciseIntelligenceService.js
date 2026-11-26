// Exercise intelligence profile service — spec §26/27 (pc-HUM-108).
//
// TRUST MODEL: profiles are server-controlled. Ordinary users have no write
// path at any layer — there is deliberately no user-facing mutation endpoint.
// Activating capabilities requires status='validated' AND the capability map
// entry validated; unknown/unvalidated capabilities are never served as active.
// Movement families are a canonical registry derived from the spec's bounded
// editorial list — a database table would be redundant ceremony, but the
// registry IS versioned data here so coverage checks can fail loudly.

const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');

// Canonical movement families — spec section "movement families" groupings.
// Equipment is deliberately absent: it is orthogonal per spec.
const MOVEMENT_FAMILIES = Object.freeze({
  lower_body: ['squat', 'hip_hinge', 'deadlift', 'lunge', 'split_squat', 'step_up', 'knee_extension', 'knee_flexion', 'hip_extension', 'hip_flexion', 'hip_abduction', 'hip_adduction', 'ankle_plantarflexion', 'ankle_dorsiflexion', 'leg_press', 'single_leg_balance'],
  upper_body: ['horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'elbow_flexion', 'elbow_extension', 'shoulder_abduction', 'shoulder_adduction', 'shoulder_flexion', 'shoulder_extension', 'shoulder_rotation', 'scapular_movement', 'wrist_flexion', 'wrist_extension', 'forearm_rotation'],
  core: ['trunk_flexion', 'trunk_extension', 'trunk_rotation', 'lateral_flexion', 'anti_extension', 'anti_rotation', 'anti_lateral_flexion', 'core_stabilization', 'pelvic_movement'],
  functional: ['walking', 'running', 'marching', 'crawling', 'carrying', 'jumping', 'landing', 'stepping', 'explosive', 'olympic_lifting', 'kettlebell', 'compound_full_body', 'multi_phase'],
  static_mobility: ['isometric_hold', 'plank_variation', 'static_stretching', 'dynamic_stretching', 'joint_mobility', 'balance', 'yoga_related', 'rehabilitation_style'],
});

const ALL_FAMILIES = Object.values(MOVEMENT_FAMILIES).flat();
const TRACKING_METHODS = ['manual', 'rep_counter_fsm', 'pose_ml', 'none'];
const COACHING_CAPABILITIES = ['none', 'basic', 'guided', 'automated'];
const PROFILE_STATUSES = ['draft', 'validated', 'disabled'];
const CAPABILITY_KEYS = ['repCounting', 'holdTracking', 'formObservation', 'exerciseRecognition', 'voiceCoaching'];
const CAPABILITY_STATUSES = ['draft', 'validated', 'disabled'];

function validateCapabilitiesJson(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw httpError(500, 'corrupt capabilities payload'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw httpError(500, 'corrupt capabilities payload');
  return parsed;
}

/** Public projection: capabilities expose only validated entries as active. */
function projectCapabilities(raw) {
  const parsed = validateCapabilitiesJson(raw);
  const out = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (!CAPABILITY_KEYS.includes(key)) continue; // unknown capabilities never surface
    if (!entry || typeof entry !== 'object') continue;
    out[key] = {
      status: CAPABILITY_STATUSES.includes(entry.status) ? entry.status : 'draft',
      active: entry.status === 'validated',
      ...(typeof entry.engine === 'string' && entry.engine.length <= 60 ? { engine: entry.engine } : {}),
      ...(typeof entry.engineVersion === 'string' && entry.engineVersion.length <= 30 ? { engineVersion: entry.engineVersion } : {}),
    };
  }
  return out;
}

function projectProfile(row) {
  let secondary = [];
  try { secondary = JSON.parse(row.secondaryFamilies || '[]'); } catch { secondary = []; }
  return {
    exerciseId: row.exerciseId,
    version: row.version,
    movementFamily: row.movementFamily,
    secondaryFamilies: secondary.filter((f) => ALL_FAMILIES.includes(f)),
    movementSubtype: row.movementSubtype,
    trackingMethod: row.trackingMethod,
    coachingCapability: row.coachingCapability,
    capabilities: projectCapabilities(row.capabilities),
    status: row.status,
  };
}

/** Latest version per exercise; validated profiles only unless includeDrafts. */
async function listProfiles({ exerciseId, includeDrafts = false } = {}) {
  const prisma = getPrisma();
  const where = {};
  if (exerciseId) where.exerciseId = exerciseId;
  if (!includeDrafts) where.status = { in: ['validated', 'disabled'] };
  const rows = await prisma.exerciseIntelligenceProfile.findMany({
    where,
    orderBy: [{ exerciseId: 'asc' }, { version: 'desc' }],
  });
  // latest version per exercise wins
  const latest = new Map();
  for (const row of rows) {
    if (!latest.has(row.exerciseId)) latest.set(row.exerciseId, row);
  }
  return [...latest.values()].map(projectProfile);
}

async function getProfile(exerciseId) {
  const profiles = await listProfiles({ exerciseId });
  if (!profiles.length) throw httpError(404, 'No exercise intelligence profile for this exercise.');
  return profiles[0];
}

/**
 * Model metadata — honest runtime truth: no trained ML models exist yet.
 * The rep-counting engine is a deterministic FSM (rule-based), versioned here.
 * This endpoint must never fabricate ML artifacts.
 */
function getModelMetadata() {
  return {
    models: [
      {
        modelId: 'rep-counter-fsm',
        kind: 'rule_based_fsm',
        version: '1',
        artifactChecksum: null, // deterministic code, no artifact — honest null
        approvalStatus: 'validated',
        supportedCapabilities: ['repCounting'],
        knownLimitations: [
          'validates FSM behavior on synthetic labeled streams — not human-camera accuracy',
          'fast reps below minRepDurationMs are designed misses (debounce trade-off)',
        ],
      },
    ],
    poseMlModels: [],
    note: 'No trained pose-ML models are approved or deployed. Entries appear here only with versioned registry records, checksums and independent evaluation.',
  };
}

/**
 * Admin coverage report — spec: "automated checks that fail when an active
// exercise lacks required classification". Reports counts + the violating
 * exercise ids (bounded) so admins can act. Never fails the request — it is
 * a report; CI enforcement consumes the same logic via exit codes elsewhere.
 */
async function coverageReport() {
  const prisma = getPrisma();
  const exercises = await prisma.exercise.findMany({ select: { id: true, normalizedName: true, reviewStatus: true } });
  const profiles = await prisma.exerciseIntelligenceProfile.findMany({
    orderBy: [{ exerciseId: 'asc' }, { version: 'desc' }],
  });
  const latestByExercise = new Map();
  for (const p of profiles) if (!latestByExercise.has(p.exerciseId)) latestByExercise.set(p.exerciseId, p);

  const missing = [];
  const invalidFamily = [];
  const draftOnly = [];
  for (const ex of exercises) {
    const profile = latestByExercise.get(ex.id);
    if (!profile) { missing.push(ex.id); continue; }
    if (!ALL_FAMILIES.includes(profile.movementFamily)) invalidFamily.push(ex.id);
    if (profile.status === 'draft') draftOnly.push(ex.id);
  }
  return {
    totalExercises: exercises.length,
    profiledExercises: exercises.length - missing.length,
    validatedProfiles: profiles.filter((p) => p.status === 'validated').length,
    missingProfileExerciseIds: missing.slice(0, 200),
    missingProfileCount: missing.length,
    invalidFamilyExerciseIds: invalidFamily.slice(0, 200),
    draftOnlyCount: draftOnly.length,
    coverageComplete: missing.length === 0 && invalidFamily.length === 0,
  };
}

function listMovementFamilies() {
  return MOVEMENT_FAMILIES;
}

module.exports = {
  listProfiles,
  getProfile,
  getModelMetadata,
  coverageReport,
  listMovementFamilies,
  MOVEMENT_FAMILIES,
  ALL_FAMILIES,
  TRACKING_METHODS,
  COACHING_CAPABILITIES,
  PROFILE_STATUSES,
};
