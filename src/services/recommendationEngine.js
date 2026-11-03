// Recommendation engine — rule-based, no AI.
// Maps today's pacing (logged intake vs intake target) to a supportive nudge.
//
// CONTRACT (corrected): no rule prescribes exercise to offset food. A fixed
// workout duration does not "cancel" a calorie surplus and must never be
// presented as doing so — energy estimates are too uncertain, and compensatory
// framing encourages unhealthy patterns. Recommendations address logging
// completeness, meal pacing, and general activity as health context only.
//
// surplus here = loggedIntake - target (provisional; intake may be incomplete).

function recommendFromBalance(balance, { weather, mealsLogged } = {}) {
  if (!balance || typeof balance.surplus !== 'number') {
    throw new Error('recommendFromBalance: balance.surplus is required');
  }
  const s = balance.surplus;
  const base = mealsLogged === 0
    ? noLogsYet()
    : pickBase(s);
  const adjusted = applyWeather(base, weather);
  return {
    type: adjusted.type,              // 'log' | 'review' | 'maintain' | 'rest' | 'eat_regular' | 'workout'
    intensity: adjusted.intensity,    // 'low' | 'moderate' | 'high'
    durationMin: adjusted.durationMin,
    location: adjusted.location,      // 'outdoor' | 'indoor' | 'either'
    title: adjusted.title,
    reason: adjusted.reason,
    surplus: s,
    provisional: true,
  };
}

function noLogsYet() {
  return {
    type: 'log',
    intensity: 'low',
    durationMin: 0,
    location: 'either',
    title: 'Log what you ate',
    reason: 'No meals recorded yet today. Logging is the only way to understand today’s intake — an empty log is not a deficit.',
  };
}

function pickBase(surplus) {
  if (surplus >= 1) {
    // Above target — suggest pacing awareness, never compensation workouts.
    return {
      type: 'review',
      intensity: 'low',
      durationMin: 0,
      location: 'either',
      title: 'Check in with your next meal',
      reason: 'Logged intake is above today’s target. A comfortable, balanced next meal is fine — and staying active is good for you regardless of what you ate.',
    };
  }
  if (surplus === 0) {
    return {
      type: 'maintain',
      intensity: 'low',
      durationMin: 30,
      location: 'either',
      title: 'Right on pace',
      reason: 'Logged intake matches today’s target. Keep going with your usual routine.',
    };
  }
  const deficit = -surplus;
  if (deficit >= 600) {
    return {
      type: 'eat_regular',
      intensity: 'low',
      durationMin: 0,
      location: 'either',
      title: 'Eat a regular meal',
      reason: 'Logged intake is well below target — if you’ve eaten more than you recorded, add it. Otherwise a normal balanced meal is appropriate.',
    };
  }
  if (deficit >= 300) {
    return {
      type: 'eat_regular',
      intensity: 'low',
      durationMin: 0,
      location: 'either',
      title: 'A balanced meal or snack fits',
      reason: 'Logged intake is below target so far — though if you haven’t logged everything, that gap may be smaller than it looks.',
    };
  }
  return {
    type: 'maintain',
    intensity: 'low',
    durationMin: 20,
    location: 'either',
    title: 'Close to target',
    reason: 'Logged intake is near today’s target. Eat normally and log when it suits you.',
  };
}

// Weather adjustments:
//   hot    -> outdoor workouts become indoor
//   rainy  -> outdoor becomes indoor
//   pleasant -> keep outdoor; upgrade 'either' to 'outdoor' for walks
function applyWeather(rec, weather) {
  if (!weather || !weather.condition) return rec;
  const c = weather.condition;
  if ((c === 'hot' || c === 'rainy') && rec.location === 'outdoor') {
    return { ...rec, location: 'indoor', reason: `${rec.reason} (Weather is ${c} — keep it indoors.)` };
  }
  if (c === 'pleasant' && rec.location === 'either' && rec.type === 'workout') {
    return { ...rec, location: 'outdoor', reason: `${rec.reason} (Weather is pleasant — take it outside.)` };
  }
  return rec;
}

module.exports = { recommendFromBalance };
