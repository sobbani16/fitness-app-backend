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

/**
 * buildHistory
 * @param {{
 *   profile: { sex, weightKg, heightCm, age, activityLevel, goal },
 *   days: Array<{ date: string, caloriesIn: number, caloriesBurnedExercise?: number, mealCount?: number }>
 * }} input
 */
function buildHistory(input) {
  const { profile, days = [] } = input || {};
  if (!profile) throw new Error('profile is required');
  if (!Array.isArray(days)) throw new Error('days must be an array');

  const bmr = calculateBMR({
    sex: profile.sex,
    weightKg: profile.weightKg,
    heightCm: profile.heightCm,
    age: profile.age,
  });
  const tdee = calculateTDEE(bmr, profile.activityLevel || 'sedentary');

  // Ascending by date so streak logic (ending at the latest day) is clear.
  const sorted = days.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const entries = sorted.map((d) => {
    const caloriesIn = Number(d.caloriesIn) || 0;
    const caloriesBurnedExercise = Number(d.caloriesBurnedExercise) || 0;
    const mealCount = Number(d.mealCount) || 0;
    const balance = computeDailyBalance({
      caloriesIn,
      caloriesBurnedExercise,
      tdee,
      goal: profile.goal || 'maintain',
    });
    return {
      date: d.date,
      caloriesIn,
      caloriesBurnedExercise,
      mealCount,
      target: balance.target,
      net: balance.net,
      surplus: balance.surplus,
      status: balance.status,
      logged: mealCount > 0 || caloriesIn > 0,
    };
  });

  // Streak = number of consecutive days ending at the most recent entry that were "logged".
  // On-target streak = same but status === 'on_target'.
  let loggedStreak = 0;
  let onTargetStreak = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].logged) loggedStreak++;
    else break;
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].status === 'on_target') onTargetStreak++;
    else break;
  }

  return {
    tdee: Math.round(tdee),
    entries,
    streaks: { logged: loggedStreak, onTarget: onTargetStreak },
  };
}

module.exports = { buildDailySummary, buildHistory };
