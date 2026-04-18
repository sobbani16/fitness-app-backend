// Recommendation engine — rule-based, no AI.
// Maps a daily calorie balance to a concrete workout/diet suggestion.
//
// Surplus rules (positive surplus = over target):
//   +1..149     -> 15 min brisk walk
//   +150..349   -> 25 min moderate workout
//   +350..599   -> HIIT (~20 min) or split cardio+strength
//   +600+       -> split workout across day + review portions
//
// Deficit rules (negative surplus = under target):
//   -1..-299    -> light mobility / optional easy walk
//   -300..-599  -> rest or easy activity; add a snack if hungry
//   -600+       -> eat more; deficit too aggressive for today
//
// On target:
//   maintenance activity (30 min walk or light strength)

function recommendFromBalance(balance, { weather } = {}) {
  if (!balance || typeof balance.surplus !== 'number') {
    throw new Error('recommendFromBalance: balance.surplus is required');
  }
  const s = balance.surplus;
  const base = pickBase(s);
  const adjusted = applyWeather(base, weather);
  return {
    type: adjusted.type,              // 'workout' | 'rest' | 'eat_more' | 'maintain'
    intensity: adjusted.intensity,    // 'low' | 'moderate' | 'high'
    durationMin: adjusted.durationMin,
    location: adjusted.location,      // 'outdoor' | 'indoor' | 'either'
    title: adjusted.title,
    reason: adjusted.reason,
    surplus: s,
  };
}

function pickBase(surplus) {
  if (surplus >= 600) {
    return {
      type: 'workout',
      intensity: 'high',
      durationMin: 45,
      location: 'either',
      title: 'Split workout + portion check',
      reason: `You are ${surplus} kcal over target. Split into two sessions (cardio + strength) and review portions.`,
    };
  }
  if (surplus >= 350) {
    return {
      type: 'workout',
      intensity: 'high',
      durationMin: 20,
      location: 'either',
      title: 'HIIT or cardio + strength',
      reason: `You are ${surplus} kcal over target. A 20 min HIIT or split session will close the gap.`,
    };
  }
  if (surplus >= 150) {
    return {
      type: 'workout',
      intensity: 'moderate',
      durationMin: 25,
      location: 'either',
      title: '25 min moderate workout',
      reason: `You are ${surplus} kcal over target. A 25 min moderate session should offset it.`,
    };
  }
  if (surplus >= 1) {
    return {
      type: 'workout',
      intensity: 'low',
      durationMin: 15,
      location: 'outdoor',
      title: '15 min brisk walk',
      reason: `You are ${surplus} kcal over target. A 15 min brisk walk is enough.`,
    };
  }
  if (surplus === 0) {
    return {
      type: 'maintain',
      intensity: 'low',
      durationMin: 30,
      location: 'either',
      title: 'Maintenance activity',
      reason: 'You are on target. A 30 min walk or light strength keeps the streak.',
    };
  }
  // surplus < 0 (deficit)
  const deficit = -surplus;
  if (deficit >= 600) {
    return {
      type: 'eat_more',
      intensity: 'low',
      durationMin: 0,
      location: 'either',
      title: 'Add a balanced meal',
      reason: `You are ${deficit} kcal under target — too aggressive. Add a balanced meal instead of exercising more.`,
    };
  }
  if (deficit >= 300) {
    return {
      type: 'rest',
      intensity: 'low',
      durationMin: 20,
      location: 'either',
      title: 'Rest or easy activity',
      reason: `You are ${deficit} kcal under target. Rest, stretch, or take an easy walk. Add a snack if hungry.`,
    };
  }
  return {
    type: 'rest',
    intensity: 'low',
    durationMin: 15,
    location: 'either',
    title: 'Light mobility',
    reason: `Small deficit (${deficit} kcal). Light mobility or an easy walk is perfect.`,
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
