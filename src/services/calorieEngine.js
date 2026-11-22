// Calorie engine — rule-based, no AI.
// Computes:
//   - BMR via Mifflin-St Jeor
//   - TDEE = BMR * activity factor
//   - Target daily calories from goal
//   - Net balance (intake - burned) and surplus/deficit vs target

const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

// Daily calorie delta applied to TDEE per goal.
// Canonical taxonomy (Appendix A six goals + app's body_recomposition).
// fat_loss and bulking carry PROPOSED energy equivalents pending review —
// the spec keeps them distinct goals; only their kcal delta aliases an
// existing value (fat_loss≈weight_loss, bulking≈weight_gain). DECISIONS D1.
//   weight_loss        -> moderate deficit        fat_loss     -> deficit (proposed = weight_loss)
//   muscle_gain        -> lean surplus            weight_gain  -> larger surplus
//   bulking            -> surplus (proposed = weight_gain)    maintenance -> none
//   body_recomposition -> maintenance (recomp relies on protein + training)
const GOAL_ADJUSTMENT = {
  weight_loss: -500,
  fat_loss: -500,
  muscle_gain: 400,
  weight_gain: 500,
  bulking: 500,
  maintenance: 0,
  body_recomposition: 0,
  // Legacy stored values (rows may still carry these; normalizeGoal maps them)
  maintain: 0,
  lose: -500,
  gain: 500,
};

// Explicit, documented aliases — never silent re-interpretation.
const GOAL_ALIASES = {
  maintain: 'maintenance',
  lose: 'weight_loss',
  gain: 'weight_gain',
};

const CANONICAL_GOALS = new Set(Object.keys(GOAL_ADJUSTMENT).filter((k) => !(k in GOAL_ALIASES)));

// Maps any accepted goal string (canonical or documented alias) to its
// CANONICAL key. Unknown goals return null — callers must reject or mark
// them; they must never silently behave as maintenance.
function normalizeGoal(goal) {
  if (goal == null || goal === '') return null;
  const g = String(goal).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (g in GOAL_ALIASES) return GOAL_ALIASES[g];
  if (g in GOAL_ADJUSTMENT) return g;
  return null;
}

/**
 * Mifflin-St Jeor BMR.
 * @param {{ sex: 'male'|'female'|'other', weightKg: number, heightCm: number, age: number }} p
 * @returns {number} kcal/day
 */
function calculateBMR({ sex, weightKg, heightCm, age }) {
  assertPositive('weightKg', weightKg);
  assertPositive('heightCm', heightCm);
  assertPositive('age', age);
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  // 'other' treated as average of male/female offsets.
  if (sex === 'male') return base + 5;
  if (sex === 'female') return base - 161;
  return base - 78;
}

/**
 * TDEE = BMR * activity factor.
 * @param {number} bmr
 * @param {keyof typeof ACTIVITY_FACTORS} [activityLevel='sedentary']
 */
function calculateTDEE(bmr, activityLevel = 'sedentary') {
  const factor = ACTIVITY_FACTORS[activityLevel];
  if (!factor) throw new Error(`Unknown activityLevel: ${activityLevel}`);
  return bmr * factor;
}

/**
 * Target daily calories given a fitness goal.
 * @param {number} tdee
 * @param {'lose'|'maintain'|'gain'} goal
 */
function targetCalories(tdee, goal) {
  if (!(goal in GOAL_ADJUSTMENT)) throw new Error(`Unknown goal: ${goal}`);
  return tdee + GOAL_ADJUSTMENT[goal];
}

/**
 * Compute daily pacing versus the intake target.
 *
 * CONTRACT (corrected): `tdee` is a full-day FORECAST that already includes
 * routine movement via the activity factor, so `caloriesBurnedExercise` must
 * NOT be subtracted again — doing so double-counted exercise in the previous
 * contract. `caloriesIn` is logged intake only; it is not confirmed total
 * intake, so `surplus` is "logged intake minus target", never a verified
 * physiological deficit/surplus.
 *
 * surplus = caloriesIn - target. Positive = logged above target.
 * @param {{ caloriesIn: number, caloriesBurnedExercise?: number, tdee: number, goal: 'lose'|'maintain'|'gain' }} p
 */
function computeDailyBalance({ caloriesIn, caloriesBurnedExercise = 0, tdee, goal }) {
  assertNonNegative('caloriesIn', caloriesIn);
  assertNonNegative('caloriesBurnedExercise', caloriesBurnedExercise);
  assertPositive('tdee', tdee);
  const target = targetCalories(tdee, goal);
  const surplus = Math.round(caloriesIn - target);
  return {
    caloriesIn: Math.round(caloriesIn),
    caloriesBurnedExercise: Math.round(caloriesBurnedExercise),
    tdee: Math.round(tdee),
    target: Math.round(target),
    net: Math.round(caloriesIn), // logged intake only — see contract note
    surplus, // logged intake vs target — provisional, not a confirmed balance
    provisional: true,
    status: surplus > 0 ? 'surplus' : surplus < 0 ? 'deficit' : 'on_target',
  };
}

function assertPositive(name, v) {
  if (typeof v !== 'number' || !isFinite(v) || v <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
}
function assertNonNegative(name, v) {
  if (typeof v !== 'number' || !isFinite(v) || v < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
}

module.exports = {
  ACTIVITY_FACTORS,
  GOAL_ADJUSTMENT,
  GOAL_ALIASES,
  CANONICAL_GOALS,
  normalizeGoal,
  calculateBMR,
  calculateTDEE,
  targetCalories,
  computeDailyBalance,
};
