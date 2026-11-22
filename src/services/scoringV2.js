// Daily Progress Score v2 — fixed, explainable, versioned.
// Caps are immutable per scoreVersion; weights NEVER redistribute.
// States: no_data | partial_data | reliable | conflicting | not_applicable | safety_suspended.
// Pure functions only — callers pass data; nothing here touches the DB.
const SCORE_VERSION = 'dps-v2.1'; // v2.1: energy earns points; carbs/fat scored as ranges (HF-0020)
const CAPS = { nutrition: 40, foodQuality: 20, activity: 20, sleep: 15, hydration: 5 };
const clamp01 = x => Math.max(0, Math.min(1, x));
const round = x => Math.round(x * 10) / 10;

// Behavior 1: adequacy — full credit at/above target, linear below, capped at max.
function adequacy(value, target, cap, { missing = value == null } = {}) {
  if (missing || target == null || target <= 0) return { points: 0, state: 'no_data', reason: 'Not recorded' };
  const ratio = clamp01(value / target);
  return { points: round(cap * ratio), state: ratio >= 1 ? 'reliable' : 'partial_data',
    reason: ratio >= 1 ? 'Target met' : `Recorded ${round(value)} of ${target} target` };
}

// Behavior 2: target range — full credit inside [min,max]; degrades outside; no bonus.
function targetRange(value, min, max, cap, { floor = null, missing = value == null } = {}) {
  if (missing || min == null || max == null) return { points: 0, state: 'no_data', reason: 'Not recorded' };
  if (floor != null && value < floor)
    return { points: round(cap * 0.25), state: 'safety_suspended',
      reason: 'Recorded intake is very low; points limited pending review — not treated as failure or success' };
  if (value < min) return { points: round(cap * clamp01(value / min)), state: 'partial_data', reason: `Below range (${round(value)} < ${min})` };
  if (value > max) {
    const over = clamp01(1 - (value - max) / max);
    return { points: round(cap * over), state: 'partial_data', reason: `Above range (${round(value)} > ${max})` };
  }
  return { points: cap, state: 'reliable', reason: 'Within target range' };
}

// Behavior 3: moderation — full credit under limit; degrades above; unknown stays unknown.
function moderation(value, limit, cap, { missing = value == null } = {}) {
  if (missing) return { points: 0, state: 'no_data', reason: 'Unknown — not counted as zero' };
  if (limit == null || limit <= 0) return { points: cap, state: 'not_applicable', reason: 'No reviewed limit' };
  if (value <= limit) return { points: cap, state: 'reliable', reason: 'Within moderation reference' };
  return { points: round(cap * clamp01(1 - (value - limit) / limit)), state: 'partial_data', reason: `Above reference (${round(value)} > ${limit})` };
}

// Behavior 4: weekly pattern — fraction of expected events met over window, capped.
function pattern(done, expected, cap) {
  if (expected == null || expected <= 0) return { points: 0, state: 'not_applicable', reason: 'No pattern target' };
  if (done == null) return { points: 0, state: 'no_data', reason: 'Not recorded' };
  return { points: round(cap * clamp01(done / expected)), state: done >= expected ? 'reliable' : 'partial_data',
    reason: `${done} of ${expected} expected` };
}

// Nutrition 40 (v2.1, HF-0020 fix): energy 10, protein 12, carbs 6, fat 6,
// fiber 6. Energy now EARNS points — a surplus day can no longer score 40.
// Carbs/fat are RANGE nutrients: credit inside a goal band (target ±20%, the
// same tolerance the route already uses for the calorie band; targets may
// override via carbsMin/carbsMax/fatMin/fatMax — no invented thresholds).
// Protein keeps adequacy: capped credit, never penalized (spec B02/B04).
// Below the safety floor: energy is flagged safety_suspended AND the macro
// parts are gated to 25% — dangerous underconsumption is never rewarded.
function nutrition({ proteinG, carbsG, fatG, fiberG, calories, targets, goal }) {
  const t = targets || {};
  const floor = t.calorieFloor ?? null;
  const energy = targetRange(calories, t.caloriesMin, t.caloriesMax, 10, { floor });
  const energyGate = energy.state === 'safety_suspended' ? 0.25 : 1;
  const band = (key) => (t[`${key}Min`] != null && t[`${key}Max`] != null)
    ? [t[`${key}Min`], t[`${key}Max`]]
    : t[`${key}G`] != null ? [round(t[`${key}G`] * 0.8), round(t[`${key}G`] * 1.2)] : [null, null];
  const [carbMin, carbMax] = band('carbs');
  const [fatMin, fatMax] = band('fat');
  const parts = {
    protein: adequacy(proteinG, t.proteinG, 12),
    carbs: targetRange(carbsG, carbMin, carbMax, 6),
    fat: targetRange(fatG, fatMin, fatMax, 6),
    fiber: adequacy(fiberG, t.fiberG, 6),
  };
  const earned = round(energy.points + Object.values(parts).reduce((s, p) => s + p.points, 0) * energyGate);
  return { earned, cap: CAPS.nutrition, energy, parts, gateApplied: energyGate < 1, goal: goal || 'maintenance' };
}

// Food quality 20: moderation rules for added sugar (6), saturated fat (6),
// sodium (4), trans/PHO flag (4). Unknown inputs stay no_data, never zero.
function foodQuality({ addedSugarG, saturatedFatG, sodiumMg, hasPartiallyHydrogenatedOil, refs = {} }) {
  if (hasPartiallyHydrogenatedOil) return {
    earned: 0, cap: CAPS.foodQuality, state: 'partial_data',
    reason: 'Partially hydrogenated oil in ingredients — trans-fat concern regardless of rounded label',
    parts: { pho: { points: 0, state: 'reliable', reason: 'PHO flagged' } },
  };
  const anyInput = [addedSugarG, saturatedFatG, sodiumMg].some(v => v != null);
  const parts = {
    addedSugar: moderation(addedSugarG, refs.addedSugarG ?? 50, 6),
    saturatedFat: moderation(saturatedFatG, refs.saturatedFatG ?? 20, 6),
    sodium: moderation(sodiumMg, refs.sodiumMg ?? 2300, 4),
    // "No PHO found" only earns credit when food data exists to evaluate.
    pho: anyInput ? { points: 4, state: 'reliable', reason: 'No partially hydrogenated oil' }
      : { points: 0, state: 'no_data', reason: 'No ingredient data' },
  };
  return { earned: round(Object.values(parts).reduce((s, p) => s + p.points, 0)), cap: CAPS.foodQuality, parts };
}

// Activity 20: movement 8, cardio 4, resistance 8 — weekly-adherence basis,
// so a planned rest day is not penalized and walking ≠ strength.
function activity({ weeklySteps, weeklyMovementMin, cardioSessions, resistanceSessions, expected = {}, goal, mobilityLimited = false }) {
  if (mobilityLimited) return { earned: null, cap: CAPS.activity, state: 'not_applicable',
    reason: 'Individualized accessible activity plan applies — standard movement/resistance targets not scored',
    parts: { movement: { points: 0, state: 'not_applicable', reason: 'Individualized plan' }, cardio: { points: 0, state: 'not_applicable', reason: 'Individualized plan' }, resistance: { points: 0, state: 'not_applicable', reason: 'Individualized plan' } } };
  const movementTarget = expected.movementMin ?? 150;
  const parts = {
    movement: pattern(weeklyMovementMin ?? (weeklySteps != null ? Math.min(weeklySteps / 70, 420) : null), movementTarget, 8),
    cardio: pattern(cardioSessions, expected.cardioSessions ?? 1, 4),
    resistance: pattern(resistanceSessions, expected.resistanceSessions ?? 2, 8),
  };
  const mobility = ['muscle_gain', 'bulking'].includes(goal);
  return { earned: round(Object.values(parts).reduce((s, p) => s + p.points, 0)), cap: CAPS.activity, parts,
    note: mobility ? 'Resistance training carries priority for this goal' : null };
}

// Sleep 15: duration band per AASM (7h+ adequate), partial credit below, no HRV diagnosis.
function sleep({ hoursSlept }) {
  if (hoursSlept == null) return { earned: 0, cap: CAPS.sleep, parts: { duration: { points: 0, state: 'no_data', reason: 'Not recorded' } } };
  const points = hoursSlept >= 7 ? 15 : hoursSlept >= 6 ? 9 : hoursSlept >= 5 ? 5 : 2;
  return { earned: points, cap: CAPS.sleep, parts: { duration: { points, state: hoursSlept >= 7 ? 'reliable' : 'partial_data',
    reason: `${round(hoursSlept)}h recorded — ${hoursSlept >= 7 ? 'adequate range' : 'below typical adult range'}` } } };
}

// Hydration 5: adequacy vs individualized target; restricted targets = not_applicable path.
function hydration({ waterMl, targetMl, fluidRestricted }) {
  if (fluidRestricted) return { earned: null, cap: CAPS.hydration, state: 'not_applicable', reason: 'Individual fluid guidance applies — component not scored' };
  const r = adequacy(waterMl, targetMl ?? 2000, 5);
  return { earned: r.points, cap: CAPS.hydration, parts: { intake: r } };
}

// Safety override — the ONLY way a composite gets qualified or suspended.
function dailyScore(input, { safetySuspension = null } = {}) {
  const nutrition_ = nutrition(input.nutrition || {});
  const quality = foodQuality(input.foodQuality || {});
  const act = activity(input.activity || {});
  const slp = sleep(input.sleep || {});
  const hyd = hydration(input.hydration || {});
  const components = { nutrition: nutrition_, foodQuality: quality, activity: act, sleep: slp, hydration: hyd };
  if (safetySuspension) {
    return { version: SCORE_VERSION, state: 'safety_suspended', composite: null, components,
      reason: safetySuspension, note: 'Ordinary scoring suppressed; safety guidance applies.' };
  }
  const earned = [nutrition_.earned, quality.earned, act.earned, slp.earned, hyd.earned]
    .reduce((s, v) => s + (v ?? 0), 0);
  const anyData = Object.values(components).some(c => (c.parts ? Object.values(c.parts) : []).some(p => p.state !== 'no_data'));
  return { version: SCORE_VERSION, state: anyData ? 'partial_data' : 'no_data', composite: round(earned),
    denominator: 100, components, note: 'Daily Progress Score — adherence estimate, not a health or risk measurement.' };
}
module.exports = { dailyScore, adequacy, targetRange, moderation, pattern, CAPS, SCORE_VERSION };
