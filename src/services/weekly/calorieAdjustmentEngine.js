// Adaptive Calorie Engine
// Adjusts weekly calorie targets safely. Never aggressive.
//
// Rules:
// 1. If adherence < 70% → do NOT reduce
// 2. If recovery is poor → do NOT reduce
// 3. If weight loss is progressing → maintain
// 4. If stalled 2+ weeks → reduce by 100-150
// 5. Max weekly adjustment: 150 kcal
// 6. Never below BMR * 0.8 (safety floor)

const { getPrisma } = require('../../lib/prisma');

const MAX_ADJUSTMENT = 150;
const MIN_CALORIES_FLOOR = 1200; // absolute floor

/**
 * Compute the next week's calorie target.
 * @param {string} userId
 * @param {{currentCalories: number, adherencePercent: number, recoveryScore: number, weightTrendKg: number, weeksStalled: number, bmr?: number}} context
 * @returns {{newCalories: number, adjustmentAmount: number, reason: string, explanation: string}}
 */
function computeAdjustment({ currentCalories, adherencePercent, recoveryScore, weightTrendKg, weeksStalled, bmr }) {
  const floor = bmr ? Math.round(bmr * 0.8) : MIN_CALORIES_FLOOR;

  // Rule 1: Low adherence → don't change
  if (adherencePercent < 70) {
    return {
      newCalories: currentCalories,
      adjustmentAmount: 0,
      reason: 'adherence_low',
      explanation: `We did not reduce calories because adherence was only ${adherencePercent}%. Focus on following the current plan first.`,
    };
  }

  // Rule 2: Poor recovery → don't reduce
  if (recoveryScore < 50) {
    return {
      newCalories: currentCalories,
      adjustmentAmount: 0,
      reason: 'recovery_poor',
      explanation: `Recovery score is ${recoveryScore}/100. Maintaining calories to support recovery.`,
    };
  }

  // Rule 3: Weight loss is progressing (losing > 0.2kg/week) → maintain
  if (weightTrendKg < -0.2) {
    return {
      newCalories: currentCalories,
      adjustmentAmount: 0,
      reason: 'on_track',
      explanation: `We maintained calories because you lost ${Math.abs(weightTrendKg).toFixed(1)}kg last week. Great progress!`,
    };
  }

  // Rule 4: Stalled for 2+ weeks → reduce gradually
  if (weeksStalled >= 2) {
    const reduction = Math.min(MAX_ADJUSTMENT, Math.round(50 + weeksStalled * 25));
    const newCalories = Math.max(floor, currentCalories - reduction);
    const actual = currentCalories - newCalories;
    return {
      newCalories,
      adjustmentAmount: -actual,
      reason: 'progress_stalled',
      explanation: `Weight has stalled for ${weeksStalled} weeks. Reducing calories by ${actual} to ${newCalories}. This is a gradual, safe adjustment.`,
    };
  }

  // Default: maintain
  return {
    newCalories: currentCalories,
    adjustmentAmount: 0,
    reason: 'maintaining',
    explanation: 'Calories maintained. No adjustment needed this week.',
  };
}

/**
 * Run the calorie adjustment and store history.
 */
async function adjustCalories(userId, weekStartDate, context) {
  const prisma = getPrisma();
  const result = computeAdjustment(context);

  await prisma.calorieAdjustmentHistory.create({
    data: {
      userId,
      weekStartDate,
      previousCalories: context.currentCalories,
      newCalories: result.newCalories,
      adjustmentAmount: result.adjustmentAmount,
      reason: result.reason,
      adherencePercent: context.adherencePercent,
      weightTrendKg: context.weightTrendKg,
    },
  });

  return result;
}

module.exports = { computeAdjustment, adjustCalories };
