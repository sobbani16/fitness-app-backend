// Scenario capabilities — pure functions closing the remaining P0 fixtures
// (F05 F08 F09 J01 K04 K05 K08 K09 L02 L10). No DB access. No invented
// clinical thresholds: any policy bound (e.g., rapid-loss kg/week) arrives
// as an explicit parameter so a reviewer sets the number.
const round = (x) => Math.round(x * 10) / 10;

// F05 — explain an overage as estimated energy balance + optional activity.
// NEVER produces mandatory compensation. No eating-disorder unsafe framing.
function overeatingGuidance({ overageKcal, tdee = null }) {
  if (overageKcal == null || overageKcal <= 0) return { applies: false };
  return {
    applies: true,
    estimatedSurplusKcal: round(overageKcal),
    weeklyContext: tdee ? `About ${round(overageKcal / tdee * 100)}% of one day's estimated needs` : null,
    optionalActivity: true,      // activity may be suggested
    mandatoryCompensation: false, // NEVER required — spec F05
    framing: 'informational',     // not punitive, no moralizing
  };
}

// F09 — dedupe wearable workout records. Two records are the same session if
// same type, overlapping or within `withinMinutes`, and same duration ±tol.
function dedupeWorkouts({ sessions = [], withinMinutes = 15, durationToleranceMin = 3 } = {}) {
  const out = [], dupes = [];
  for (const s of sessions) {
    const dup = out.find((o) => o.workoutType === s.workoutType
      && Math.abs((o.durationMinutes ?? 0) - (s.durationMinutes ?? 0)) <= durationToleranceMin
      && o.startedAt && s.startedAt && Math.abs(new Date(o.startedAt) - new Date(s.startedAt)) <= withinMinutes * 60000);
    if (dup) dupes.push({ kept: dup.id, dropped: s.id }); else out.push(s);
  }
  return { sessions: out, duplicatesRemoved: dupes, energyInflated: dupes.length > 0 };
}

// J01 — supplement question policy. Engine never auto-recommends; approved
// content is required or the response routes to review. Clinically gated.
function supplementQuestionPolicy({ topic, approvedContentAvailable = false, interactionRisk = false }) {
  return {
    autoRecommend: false,                    // NEVER auto-recommend (spec J01)
    uncertaintyAcknowledged: true,           // benefit is uncertain
    risksDisclosed: true,
    outcome: interactionRisk ? 'professional_review_required'
      : approvedContentAvailable ? 'reviewed_education' : 'professional_review_required',
    requiresApprovedContent: !approvedContentAvailable,
    topic: topic || null,
  };
}

// K04 — raw↔cooked weight conversion. Requires an explicit factor (per-100g
// retention/yield from a source). Missing factor → null, never a guess.
function convertFoodState({ grams, from, to, factor }) {
  if (grams == null || from === to) return { grams, appliedFactor: 1, estimated: false };
  if (factor == null || factor <= 0) return { grams: null, appliedFactor: null, state: 'no_data', reason: 'No verified conversion factor — raw and cooked weights are not interchangeable' };
  return { grams: round(grams * factor), appliedFactor: factor, state: 'partial_data', reason: `Converted ${from}→${to} using factor ${factor}` };
}

// K05 — rescale a per-serving nutrient map. Multiplies every present value;
// nulls stay null (missing is never zero).
function rescaleServing({ nutrients = {}, servings } = {}) {
  if (servings == null || !Number.isFinite(servings)) return null;
  const out = {};
  for (const [k, v] of Object.entries(nutrients || {})) out[k] = v == null ? null : round(v * servings);
  return out;
}

// K08 — possible duplicate log entries across channels (barcode vs photo).
// Same sourceId/fdcId, or normalized name match within a time window.
function detectDuplicateLog({ a, b, windowMinutes = 30 } = {}) {
  if (!a || !b) return { possibleDuplicate: false };
  const sameId = a.fdcId && b.fdcId && a.fdcId === b.fdcId;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const sameName = a.foodName && b.foodName && norm(a.foodName) === norm(b.foodName);
  const ta = a.loggedAt ? new Date(a.loggedAt) : null, tb = b.loggedAt ? new Date(b.loggedAt) : null;
  const close = ta && tb ? Math.abs(ta - tb) <= windowMinutes * 60000 : true; // unknown time cannot clear a strong ID/name match
  const possibleDuplicate = (sameId || sameName) && close;
  return { possibleDuplicate, needsConfirmation: possibleDuplicate, basis: sameId ? 'same_source_id' : sameName ? 'same_name' : null };
}

// K09 — wearable expenditure plausibility. Caller passes the plausible bound
// (e.g., fraction of TDEE or an absolute cap); implausible values are flagged
// and the automatic eating allowance is capped, never inflated.
function validateWearableEnergy({ activeKcal, plausibleMaxKcal }) {
  if (activeKcal == null) return { plausible: null, state: 'no_data' };
  if (plausibleMaxKcal == null) return { plausible: null, state: 'no_data', reason: 'No plausibility bound configured' };
  const plausible = activeKcal <= plausibleMaxKcal;
  return {
    plausible,
    reportedKcal: round(activeKcal),
    allowanceKcal: plausible ? round(activeKcal) : round(plausibleMaxKcal), // never inflate beyond bound
    flagged: !plausible,
    reason: plausible ? 'Within plausibility bound' : `Implausible (${round(activeKcal)} > bound ${round(plausibleMaxKcal)}) — capped, no automatic eating allowance`,
  };
}

// L02 — repeated rapid weight loss. `maxLossKgPerWeek` is the REVIEWED bound —
// this module does not pick a clinical number. Loss faster than the bound on
// 2+ consecutive intervals → review flag; no reward for faster loss.
function assessWeightLossRate({ weeklyLosses, maxLossKgPerWeek }) {
  if (!Array.isArray(weeklyLosses) || weeklyLosses.length === 0) return { state: 'no_data' };
  if (maxLossKgPerWeek == null) return { state: 'no_data', reason: 'No reviewed rate bound configured' };
  const over = weeklyLosses.filter((w) => w != null && w > maxLossKgPerWeek);
  const consecutive = weeklyLosses.length >= 2 && weeklyLosses.slice(-2).every((w) => w != null && w > maxLossKgPerWeek);
  return {
    state: over.length ? 'partial_data' : 'reliable',
    weeksOverBound: over.length,
    rapidConsecutive: consecutive,
    outcomeReview: consecutive,
    rewardFasterLoss: false, // NEVER reward speed
    reason: consecutive ? 'Sustained loss faster than reviewed bound — recommend evaluation' : over.length ? 'Some weeks above reviewed bound — monitor' : 'Within reviewed rate',
  };
}

// L10 — score-vs-outcome divergence. High recent scores but no goal progress
// → outcome review, not a success claim.
function detectOutcomeDivergence({ recentScores = [], goalProgress = null, minWeeks = 2 }) {
  const usable = recentScores.filter((s) => s != null);
  if (usable.length < minWeeks || goalProgress == null) return { state: 'no_data' };
  const avg = usable.reduce((a, b) => a + b, 0) / usable.length;
  const high = avg >= 80; // internal consistency threshold, not a clinical claim
  const stalled = goalProgress === 'stalled' || goalProgress === 'regressing';
  return {
    state: 'reliable', avgScore: round(avg), progress: goalProgress,
    outcomeReview: high && stalled,
    reason: high && stalled ? 'High adherence scores without goal progress — review targets and measurement' : 'Score/outcome relationship unremarkable',
  };
}

module.exports = { overeatingGuidance, dedupeWorkouts, supplementQuestionPolicy, convertFoodState, rescaleServing, detectDuplicateLog, validateWearableEnergy, assessWeightLossRate, detectOutcomeDivergence };

// A10 — goal switch policy. Never silent: requires explicit confirmation,
// preserves the old goal/targets/score history, activates exactly one new
// primary goal. Persistence itself is the route's job (GoalHistory rows).
function planGoalSwitch({ currentGoal, currentTargets = null, newGoal, confirmed = false }) {
  const { normalizeGoal } = require('./calorieEngine');
  const canon = normalizeGoal(newGoal);
  if (!canon) return { ok: false, reason: 'Unknown goal — rejected, not reinterpreted' };
  if (canon === normalizeGoal(currentGoal)) return { ok: false, reason: 'Goal unchanged' };
  if (!confirmed) return { ok: false, requiresConfirmation: true, proposedGoal: canon, preservesHistory: true };
  return {
    ok: true, requiresConfirmation: false,
    previousGoal: normalizeGoal(currentGoal) || currentGoal,
    preservedTargets: currentTargets,
    activeGoal: canon,
    preservesHistory: true,   // old goal + targets + score history retained (GoalHistory + DailyScoreSnapshot rows are never rewritten)
    singlePrimaryGoal: true,
  };
}

// D07 — nutrient caution policy. Blanket warnings are OFF by default; a
// reviewed restriction (approved rule with threshold) is required to warn.
// Potassium-and-CKD is the spec example; the shape is nutrient-agnostic.
function assessNutrientCaution({ nutrient, valueG, reviewedLimitG = null }) {
  if (valueG == null) return { state: 'no_data', warning: false, reason: 'Intake unknown — not treated as zero or excessive' };
  if (reviewedLimitG == null) return { state: 'reliable', warning: false, reason: `No reviewed ${nutrient} restriction applies — no blanket warning` };
  const warning = valueG > reviewedLimitG;
  return { state: warning ? 'partial_data' : 'reliable', warning, reason: warning ? `Above reviewed limit (${round(valueG)} > ${reviewedLimitG})` : 'Within reviewed limit' };
}

module.exports = Object.assign(module.exports, { planGoalSwitch, assessNutrientCaution });
