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
// New descriptive goals are the primary taxonomy; legacy keys (lose/gain)
// are kept as aliases for backward compatibility.
//   weight_loss        -> moderate deficit
//   muscle_gain        -> lean surplus
//   body_recomposition -> maintenance (recomp relies on protein + training)
//   maintain           -> no change
const GOAL_ADJUSTMENT = {
  weight_loss: -500,
  muscle_gain: 400,
  body_recomposition: 0,
  maintain: 0,
  // Legacy aliases
  lose: -500,
  gain: 500,
};

// Maps any accepted goal string (including legacy values) to a known key.
function normalizeGoal(goal) {
  if (!goal) return 'maintain';
  const g = String(goal).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (g in GOAL_ADJUSTMENT) return g;
  return 'maintain';
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
 * Compute daily balance.
 * surplus = net - target. Positive = over target (surplus); negative = under (deficit).
 * @param {{ caloriesIn: number, caloriesBurnedExercise?: number, tdee: number, goal: 'lose'|'maintain'|'gain' }} p
 */
function computeDailyBalance({ caloriesIn, caloriesBurnedExercise = 0, tdee, goal }) {
  assertNonNegative('caloriesIn', caloriesIn);
  assertNonNegative('caloriesBurnedExercise', caloriesBurnedExercise);
  assertPositive('tdee', tdee);
  const target = targetCalories(tdee, goal);
  const net = caloriesIn - caloriesBurnedExercise;
  const surplus = Math.round(net - target);
  return {
    caloriesIn: Math.round(caloriesIn),
    caloriesBurnedExercise: Math.round(caloriesBurnedExercise),
    tdee: Math.round(tdee),
    target: Math.round(target),
    net: Math.round(net),
    surplus, // positive = over target, negative = under (deficit)
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
  normalizeGoal,
  calculateBMR,
  calculateTDEE,
  targetCalories,
  computeDailyBalance,
};
