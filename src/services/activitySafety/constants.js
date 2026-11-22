// Activity safety constants — vocabularies shared by the engine, routes,
// seed data and tests. Policy version is bumped on any rule/behavior change;
// it is stamped on every ActivitySafetyEvaluation row.

const POLICY_VERSION = 'activity-safety-v1';

// Decisions — ordered worst-first for merge. DEFER_OUTDOOR and MODIFY sit on
// the same tier (both are "do it differently", neither is a stop).
const DECISIONS = {
  URGENT_ESCALATION: 'URGENT_ESCALATION',
  BLOCK_ACTIVITY: 'BLOCK_ACTIVITY',
  NEEDS_CLINICAL_REVIEW: 'NEEDS_CLINICAL_REVIEW',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  DEFER_OUTDOOR: 'DEFER_OUTDOOR',
  MODIFY: 'MODIFY',
  ALLOW: 'ALLOW',
};

const DECISION_RANK = {
  URGENT_ESCALATION: 6,
  BLOCK_ACTIVITY: 5,
  NEEDS_CLINICAL_REVIEW: 5,
  INSUFFICIENT_DATA: 4,
  DEFER_OUTDOOR: 3,
  MODIFY: 3,
  ALLOW: 0,
};

// Activity category keys — used by activity demand profiles, documented
// restrictions (UserActivityRestriction.categories,
// UserInjury.prohibitedCategories, UserSurgery.clinicianRestrictions) and
// ActivitySafetyRule.appliesTo.
const ACTIVITY_CATEGORIES = {
  WEIGHT_BEARING_LOWER: 'weight_bearing_lower', // walk/run/jump/standing strength on legs
  LOWER_LIMB_LOAD: 'lower_limb_load',           // any lower-limb primary demand incl. seated cycling
  UPPER_LIMB_LOAD: 'upper_limb_load',
  TRUNK_LOAD: 'trunk_load',                      // significant back/spinal demand
  IMPACT: 'impact',                              // jumping/running/pounding
  BALANCE_CHALLENGING: 'balance_challenging',
  OVERHEAD: 'overhead',
  SUPINE_PROLONGED: 'supine_prolonged',
  WATER_IMMERSION: 'water_immersion',
  OUTDOOR_EXPOSED: 'outdoor_exposed',
  VIGOROUS: 'vigorous',
  CONTACT_FALL_RISK: 'contact_fall_risk',
  VALSALVA: 'valsalva',
  GROUP_INDOOR: 'group_indoor',                     // shared-space indoor exercise (classes)
};

// Body regions injuries map onto (matching demand profile `regions` keys).
const BODY_REGIONS = {
  ankle: 'lower_limb', foot: 'lower_limb', achilles: 'lower_limb',
  knee: 'lower_limb', leg: 'lower_limb', shin: 'lower_limb', calf: 'lower_limb',
  hip: 'lower_limb', thigh: 'lower_limb', hamstring: 'lower_limb', groin: 'lower_limb',
  wrist: 'upper_limb', hand: 'upper_limb', elbow: 'upper_limb',
  arm: 'upper_limb', shoulder: 'upper_limb', forearm: 'upper_limb',
  lower_back: 'trunk', back: 'trunk', spine: 'trunk', neck: 'trunk',
  pelvis: 'trunk', ribs: 'trunk', abdomen: 'trunk',
};
// Regions that also imply weight-bearing when loaded.
const WEIGHT_BEARING_REGIONS = new Set(['lower_limb', 'trunk']);

// Symptom codes (UserSymptomReport.symptoms). Urgent = URGENT_ESCALATION the
// moment an *active* report exists — product-safety behavior, errs toward
// caution, ships before clinical review (direction to seek care, not a
// diagnosis). Review = NEEDS_CLINICAL_REVIEW.
const SYMPTOMS_URGENT = new Set([
  'chest_pain', 'chest_pressure', 'syncope', 'dyspnea_unusual',
  'numbness_neuro', 'severe_headache_sudden', 'vision_changes',
  'pregnancy_bleeding', 'pregnancy_contractions', 'pregnancy_fluid_leak',
  'pregnancy_calf_pain',
]);
const SYMPTOMS_REVIEW = new Set([
  'palpitations', 'dizziness', 'severe_pain', 'joint_instability',
  'abnormal_weakness', 'fever', 'hypoglycemia', 'shortness_breath_exertion',
]);

// Health-condition normalization — map UserHealthCondition names to engine
// keys. Kept conservative: unmapped conditions land in `unmapped` so the
// pipeline can ask for more information instead of guessing.
const CONDITION_KEYS = {
  asthma: 'asthma', 'exercise-induced bronchoconstriction': 'eib', 'exercise induced bronchoconstriction': 'eib', eib: 'eib',
  copd: 'copd', 'chronic obstructive pulmonary disease': 'copd',
  'type 1 diabetes': 'diabetes_t1', 'type 1 diabetes mellitus': 'diabetes_t1', t1d: 'diabetes_t1',
  'type 2 diabetes': 'diabetes_t2', 'type 2 diabetes mellitus': 'diabetes_t2', t2d: 'diabetes_t2',
  prediabetes: 'prediabetes',
  'peripheral neuropathy': 'neuropathy', 'diabetic neuropathy': 'neuropathy',
  retinopathy: 'retinopathy', 'diabetic retinopathy': 'retinopathy',
  hypertension: 'hypertension', 'high blood pressure': 'hypertension',
  'coronary artery disease': 'cad', cad: 'cad', 'heart disease': 'cad',
  'heart failure': 'heart_failure', arrhythmia: 'arrhythmia', afib: 'arrhythmia',
  'chronic kidney disease': 'ckd', ckd: 'ckd', dialysis: 'dialysis',
  osteoporosis: 'osteoporosis', osteopenia: 'osteoporosis',
  'multiple sclerosis': 'ms', ms: 'ms',
  "parkinson's disease": 'parkinsons', parkinsons: 'parkinsons',
  epilepsy: 'seizure', 'seizure disorder': 'seizure',
  'stroke recovery': 'stroke_recovery', stroke: 'stroke_recovery',
  anemia: 'anemia', 'iron deficiency anemia': 'anemia',
  'knee osteoarthritis': 'osteoarthritis', osteoarthritis: 'osteoarthritis',
  obesity: 'obesity', 'metabolic syndrome': 'metabolic_syndrome',
  immunosuppressed: 'immunosuppressed', immunosuppression: 'immunosuppressed',
  'cancer treatment': 'cancer_treatment', 'chemotherapy': 'cancer_treatment',
  'hypotension': 'hypotension', 'low blood pressure': 'hypotension',
  'hyperthyroidism': 'hyperthyroidism', 'hypothyroidism': 'hypothyroidism',
  'cardiac rehabilitation': 'cardiac_rehab', 'cardiac rehab': 'cardiac_rehab', cardiac_rehab: 'cardiac_rehab',
};

// Medication-activity flag keys (UserActivityProfile.medicationActivityFlags)
// — coarse opt-in classes, never an inferred med list.
const MED_FLAGS = new Set([
  'heat_sensitivity', 'dehydration_risk', 'hypoglycemia_risk',
  'heart_rate_interpretation', 'balance_sedation',
]);

// Environmental hazard keys produced by the environment evaluator.
const ENV_HAZARDS = {
  THUNDERSTORM: 'thunderstorm', SEVERE_ALERT: 'severe_alert',
  HEAT_DANGER: 'heat_danger', HEAT_SENSITIVE_DANGER: 'heat_sensitive_danger',
  HEAT_EXTREME_CAUTION: 'heat_extreme_caution', HEAT_CAUTION: 'heat_caution',
  COLD_DANGER: 'cold_danger', COLD_CAUTION: 'cold_caution',
  AQI_HAZARDOUS: 'aqi_hazardous', AQI_VERY_UNHEALTHY: 'aqi_very_unhealthy',
  AQI_UNHEALTHY: 'aqi_unhealthy', AQI_USG: 'aqi_usg',
  UV_EXTREME: 'uv_extreme', UV_VERY_HIGH: 'uv_very_high',
  HIGH_WIND: 'high_wind', HEAVY_PRECIP: 'heavy_precip',
};

const WET_CODES = [51, 52, 53, 54, 55, 56, 57, 61, 62, 63, 64, 65, 66, 67, 71, 72, 73, 74, 75, 76, 77, 80, 81, 82, 85, 86, 95, 96, 97, 98, 99];
const THUNDER_CODES = [95, 96, 97, 98, 99];

module.exports = {
  POLICY_VERSION, DECISIONS, DECISION_RANK, ACTIVITY_CATEGORIES,
  BODY_REGIONS, WEIGHT_BEARING_REGIONS, SYMPTOMS_URGENT, SYMPTOMS_REVIEW,
  CONDITION_KEYS, MED_FLAGS, ENV_HAZARDS, WET_CODES, THUNDER_CODES,
};
