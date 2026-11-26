// Exercise intelligence profile builder — pc-HUM-101 / program §5-6.
// Derives a versioned profile for every exercise ID. Honest defaults: nothing
// is marked ML-validated merely because a profile exists; capability levels
// are evidence-derived, so every exercise currently sits at Level 0 (manual
// tracking) or Level 0+hold-duration where the movement is static — the
// camera/ML pipeline does not exist yet, and the profile says so.
const { classifyExercise } = require('./taxonomy');

const PROFILE_VERSION = 'exercise-intel-v1';

const STATIC_FAMILIES = new Set(['isometric_hold', 'static_stretching', 'anti_extension', 'lateral_flexion', 'single_leg_balance']);
const LOCOMOTION_FAMILIES = new Set(['locomotion']);

function trackingStrategy(family, variation) {
  if (variation.static || STATIC_FAMILIES.has(family)) return { repCounting: 'not_applicable_hold', holdDuration: 'manual_timer', notes: 'static movement — time-based completion, not reps' };
  if (LOCOMOTION_FAMILIES.has(family)) return { repCounting: 'not_applicable_distance_time', holdDuration: 'not_applicable', notes: 'locomotion — duration/distance tracked, not reps' };
  return { repCounting: 'manual_entry', holdDuration: 'not_applicable', notes: 'rep counting is manual; no validated automated counting exists' };
}

function movementCharacteristics(family, classification) {
  return {
    unilateral: classification.variation.unilateral,
    dynamic: !classification.variation.static,
    compound: classification.variation.compound,
    sideSpecific: classification.variation.unilateral === true ? 'per_side_sets' : 'both_together',
    phases: classification.variation.static ? ['hold'] : ['eccentric', 'concentric'], // coarse phase model; per-exercise phase timing is not measured
    repCompletionCriteria: null, // unknown without validated observation pipeline
    holdCompletionCriteria: classification.variation.static ? 'manual_timer_elapsed' : null,
  };
}

function poseRequirements() {
  // No pose pipeline exists. Everything is unknown, not guessed.
  return {
    requiredLandmarks: [], optionalLandmarks: [], supportedCameraAngles: [],
    unsupportedCameraAngles: ['all — no pose pipeline implemented'],
    minimumVisibility: null, occlusionSensitivity: 'unknown',
    cameraPositioningGuidance: null, equipmentVisibilityRequirements: [],
    status: 'not_specified_no_pipeline',
  };
}

function intelligenceConfig(family, classification) {
  return {
    ...trackingStrategy(family, classification.variation),
    movementFamilyEngine: null, // no engine exists yet
    exerciseOverrides: [],
    modelIdentifier: null, modelVersion: null,
    featureExtractionConfig: null,
    supportedFormObservations: [],
    unsupportedFormObservations: ['all — no validated observations'],
    confidenceCalibration: null, feedbackCooldownSeconds: null,
    unknownMovementBehavior: 'manual_only_no_feedback',
  };
}

function safetySection(ex) {
  // Existing activity-safety integration is injury/symptom-driven and
  // family-agnostic; movement restriction data per exercise is not yet mapped.
  return {
    activitySafetyIntegration: 'shared_engine_injury_symptom_driven',
    movementRestrictions: [], // unmapped — flagged as missing review data, not invented
    injuryRestrictions: [],
    clinicianRestrictionIntegration: 'via_activity_safety_context_only',
    safetyReviewStatus: 'pending_review',
    notes: 'No medical contraindications are asserted; restriction mapping is a documented gap.',
  };
}

function validationSection() {
  return {
    profileReviewStatus: 'auto_generated_unreviewed',
    datasetAvailability: 'none',
    trainingStatus: 'not_applicable_no_model',
    repCountValidationStatus: 'not_validated',
    formObservationValidationStatus: 'not_validated',
    supportedPlatformStatus: 'manual_tracking_all_platforms',
    deviceValidationStatus: 'not_validated',
    knownLimitations: ['no automated movement assessment', 'classification is rule-based and unreviewed'],
    lastValidationAt: null,
    evidenceReferences: [],
  };
}

/**
 * Build the versioned intelligence profile for one exercise row.
 * @param {object} ex - Exercise row with muscles included.
 */
function buildProfile(ex) {
  const classification = classifyExercise(ex);
  const family = classification.family;
  const capabilityLevel = 0; // manual tracking only — honest until evidence exists
  return {
    exerciseId: ex.id,
    canonicalName: ex.name,
    profileVersion: PROFILE_VERSION,
    generatedAt: new Date().toISOString(),
    identity: {
      exerciseId: ex.id,
      canonicalName: ex.name,
      movementFamily: family, // null = honestly unclassified
      movementSubtype: classification.subtype,
      exerciseVariation: classification.variation,
      equipment: ex.equipment || null,
      appEquipment: ex.appEquipment || [],
      primaryMuscles: (ex.muscles || []).filter((m) => m.role === 'primary').map((m) => m.muscle),
      secondaryMuscles: (ex.muscles || []).filter((m) => m.role === 'secondary').map((m) => m.muscle),
      level: ex.level || null,
      category: ex.category || null,
    },
    classification,
    movementCharacteristics: movementCharacteristics(family, classification),
    poseRequirements: poseRequirements(),
    intelligenceConfig: intelligenceConfig(family, classification),
    safety: safetySection(ex),
    validation: validationSection(),
    capability: {
      level: capabilityLevel,
      label: 'manual_tracking',
      evidence: 'no validated automated capability exists for any exercise; level derives from evidence, not aspiration',
      validatedCapabilities: [],
      unsupportedCapabilities: ['rep_counting_camera', 'form_observation', 'exercise_recognition', 'real_time_coaching'],
    },
  };
}

module.exports = { buildProfile, PROFILE_VERSION };
