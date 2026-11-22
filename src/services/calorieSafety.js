// G4 calorie-safety policy — PROPOSAL, INACTIVE until clinical + product approval.
// Not wired into any route. `scoringV2.targetRange` already understands a
// numeric `calorieFloor`; this module computes WHEN a floor exists and what
// value it takes, per-user — never a universal minimum.
//
// Semantics: the floor is a *scoring suspension trigger*, not an eating
// recommendation. Logged intake below the floor yields `safety_suspended`
// ("points limited pending review — not failure or success"), never a penalty
// and never a "you should eat more" prescription.
//
// Evidence basis (documented in CALORIE_SAFETY_POLICY_PROPOSAL.md):
//   - BMR = Mifflin–St Jeor (existing calorieEngine implementation).
//   - floor = 0.8 × BMR follows the earlier reviewed spec (phase0 §C).
//   - Under-18, pregnancy, lactation, ED risk, CKD, insulin-treated diabetes,
//     older + low-BMI weight loss → no automated floor/targets at all; the
//     correct action is clinician review, which this module requests.

const { calculateBMR, calculateTDEE, normalizeGoal } = require('./calorieEngine');

// Conservative condition codes that suspend automated weight-loss targets and
// calorie floors entirely — presence here means "a clinician owns this number",
// not "these values are dangerous". Kept small and reviewable on purpose.
const SUPERVISED_CONDITION_CODES = new Set([
  'ckd', 'chronic_kidney_disease', 'dialysis',
  'type_1_diabetes', 'insulin_treated',
  'active_cancer', 'post_bariatric', 'heart_failure',
]);

/**
 * @param {object} p
 * @param {'male'|'female'|'other'} [p.sex]
 * @param {number} [p.weightKg] @param {number} [p.heightCm] @param {number} [p.ageYears]
 * @param {string} [p.activityLevel] sedentary|light|moderate|active|very_active
 * @param {string} [p.goal] goal taxonomy (weight_loss, muscle_gain, …)
 * @param {object} [p.flags] { pregnant, lactating, eatingDisorderRisk, clinicianSupervised }
 * @param {string[]} [p.conditionCodes] normalized user condition codes
 * @param {number} [p.exerciseKcalToday] logged exercise expenditure (for fueling flags)
 */
function calorieSafetyPolicy(p = {}) {
  const flags = p.flags || {};
  const conditions = new Set((p.conditionCodes || []).map((c) => String(c).toLowerCase()));
  const reasons = [];
  const reviewTriggers = [];

  const push = (arr, code, detail) => arr.push({ code, detail });
  const review = (code, detail) => { push(reviewTriggers, code, detail); };

  // 1. Hard supervision gates — evaluated before any math so nothing about
  //    these users is ever auto-computed.
  if (p.ageYears != null && p.ageYears < 18) review('under_18', 'Energy needs during growth require individualized professional guidance.');
  if (flags.pregnant) review('pregnancy', 'Gestational energy needs change by trimester — no automated floor or deficit.');
  if (flags.lactating) review('lactation', 'Lactation adds ~400–500 kcal/day requirements — automated deficits are unsafe.');
  if (flags.eatingDisorderRisk) review('ed_risk', 'Calorie floors/deficits can reinforce disordered patterns — escalate.');
  if (flags.clinicianSupervised) review('clinician_supervised', 'A clinician already owns this user’s intake targets.');
  for (const c of conditions) if (SUPERVISED_CONDITION_CODES.has(c)) review(`condition:${c}`, 'Condition requires clinician-managed energy targets.');
  if (p.ageYears != null && p.ageYears >= 65) {
    const bmi = bmiOf(p.weightKg, p.heightCm);
    if (bmi != null && bmi < 22 && normalizeGoal(p.goal) === 'weight_loss') {
      review('older_low_bmi_weight_loss', 'Unintentional-weight-loss risk in older adults — automated deficit withheld.');
    }
  }

  if (reviewTriggers.length) {
    return {
      status: 'clinician_review_required', floorKcal: null, maxDeficitKcal: null,
      targetEligibility: 'review_required', reviewTriggers, reasons,
      policyVersion: 'g4-proposal-1',
    };
  }

  // 2. Anthropometrics required for any individualized floor.
  if (!p.weightKg || !p.heightCm || !p.ageYears || !p.sex) {
    return {
      status: 'insufficient_data', floorKcal: null, maxDeficitKcal: null,
      targetEligibility: 'unknown', reviewTriggers, reasons,
      reason: 'Floor requires sex, weight, height, and age — missing data stays missing.',
      policyVersion: 'g4-proposal-1',
    };
  }

  const bmr = calculateBMR({ sex: p.sex, weightKg: p.weightKg, heightCm: p.heightCm, age: p.ageYears });
  const activity = p.activityLevel || 'sedentary';
  const tdee = calculateTDEE(bmr, activity);
  const bmi = bmiOf(p.weightKg, p.heightCm);
  const goal = normalizeGoal(p.goal);

  // 3. Underweight users never get an automated deficit.
  if (bmi != null && bmi < 18.5 && goal === 'weight_loss') {
    review('underweight_weight_loss', `BMI ${bmi.toFixed(1)} < 18.5 — weight-loss targets require clinical review.`);
    return {
      status: 'clinician_review_required', floorKcal: null, maxDeficitKcal: null,
      targetEligibility: 'review_required', reviewTriggers, reasons, bmi: round1(bmi),
      policyVersion: 'g4-proposal-1',
    };
  }

  // 4. Eligible adult floor: 0.8 × BMR (reviewed spec), never above 0.8 × TDEE
  //    (a high-activity user's floor must not suspend normal logged intake).
  const floor = Math.round(Math.min(0.8 * bmr, 0.8 * tdee));
  push(reasons, 'floor_basis', `floor = min(0.8 × BMR ${Math.round(bmr)}, 0.8 × TDEE ${Math.round(tdee)}) = ${floor} kcal`);

  // 5. Automated deficit guard: a target may never fall below the floor.
  const maxDeficit = Math.round(tdee - floor);
  if (goal === 'weight_loss' && tdee - 500 < floor) {
    review('deficit_below_floor', `−500 deficit (${Math.round(tdee - 500)} kcal) would sit below the ${floor} kcal floor — smaller deficit or review required.`);
  }

  // 6. Fueling flag for high-activity days (RED-S-adjacent signal — flag only,
  //    never a diagnosis): intake below BMR while exercising hard.
  const fuelingFlags = [];
  if (['active', 'very_active'].includes(activity)) {
    fuelingFlags.push({ code: 'low_energy_availability_watch', thresholdKcal: Math.round(bmr), note: 'On heavy training days, logged intake below BMR should surface a fueling review note — not a score penalty.' });
  }

  return {
    status: reviewTriggers.length ? 'clinician_review_required' : 'eligible',
    floorKcal: floor, maxDeficitKcal: maxDeficit,
    targetEligibility: reviewTriggers.length ? 'review_required' : 'standard',
    reviewTriggers, reasons, fuelingFlags,
    bmr: Math.round(bmr), tdee: Math.round(tdee), bmi: bmi != null ? round1(bmi) : null,
    policyVersion: 'g4-proposal-1',
  };
}

function bmiOf(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  return weightKg / Math.pow(heightCm / 100, 2);
}
function round1(x) { return Math.round(x * 10) / 10; }

module.exports = { calorieSafetyPolicy, SUPERVISED_CONDITION_CODES };
