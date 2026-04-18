// Daily summary — aggregates balance + recommendation + a short narrative insight.

const { calculateBMR, calculateTDEE, computeDailyBalance } = require('./calorieEngine');
const { recommendFromBalance } = require('./recommendationEngine');

/**
 * buildDailySummary
 * @param {{
 *   profile: { sex, weightKg, heightCm, age, activityLevel, goal },
 *   meals?: Array<{ name: string, calories: number, mealType?: string }>,
 *   caloriesBurnedExercise?: number,
 *   weather?: { condition?: 'hot'|'rainy'|'pleasant' }
 * }} input
 */
function buildDailySummary(input) {
  const { profile, meals = [], caloriesBurnedExercise = 0, weather } = input || {};
  if (!profile) throw new Error('profile is required');

  const bmr = calculateBMR({
    sex: profile.sex,
    weightKg: profile.weightKg,
    heightCm: profile.heightCm,
    age: profile.age,
  });
  const tdee = calculateTDEE(bmr, profile.activityLevel || 'sedentary');
  const caloriesIn = meals.reduce((s, m) => s + (Number(m.calories) || 0), 0);
  const balance = computeDailyBalance({
    caloriesIn,
    caloriesBurnedExercise,
    tdee,
    goal: profile.goal || 'maintain',
  });
  const recommendation = recommendFromBalance(balance, { weather });
  const insight = buildInsight({ balance, meals, recommendation, weather });

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    mealCount: meals.length,
    balance,
    recommendation,
    insight,
  };
}

function buildInsight({ balance, meals, recommendation, weather }) {
  const parts = [];

  if (meals.length === 0) {
    parts.push('No meals logged yet today — log a meal to personalize this summary.');
  } else {
    const biggest = meals.slice().sort((a, b) => (b.calories || 0) - (a.calories || 0))[0];
    parts.push(
      `You logged ${meals.length} meal${meals.length === 1 ? '' : 's'} totaling ${balance.caloriesIn} kcal` +
      (biggest ? `, largest was "${biggest.name}" (${biggest.calories} kcal).` : '.')
    );
  }

  if (balance.status === 'surplus') {
    parts.push(`You are ${balance.surplus} kcal over target.`);
  } else if (balance.status === 'deficit') {
    parts.push(`You are ${-balance.surplus} kcal under target.`);
  } else {
    parts.push('You are right on target — nice pacing.');
  }

  parts.push(`Next action: ${recommendation.title}.`);

  if (weather && weather.condition) {
    parts.push(`Weather is ${weather.condition} — the plan accounts for it.`);
  }

  return parts.join(' ');
}

module.exports = { buildDailySummary };
