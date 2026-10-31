// Conservative progression engine — deterministic, suggestion-only.
// Never auto-applies: every suggestion requires user approval.
// Direction: 'increase' | 'maintain' | 'reduce' — increase only with
// sufficient reliable history; discomfort/missed sessions bias down.
const PROGRESSION_VERSION = 'progression.v1';
const MIN_SESSIONS = 2;          // need ≥2 logged sessions before suggesting increases
const MAX_WEEKLY_PCT = 10;       // conservative ceiling for load increases
const COMFORTABLE_RIR = 2;       // suggest increase only when ≥2 reps left in reserve

/**
 * Suggest next-step per exercise.
 * history: [{ sets:[{reps, weightLbs?}], rir?: number, discomfort?: boolean, at: string }]
 *        ordered oldest→newest, same exercise only.
 * Returns { direction, reason, suggested?, confidence, evidence }.
 */
function suggestNext(exerciseId, history = [], prefs = {}) {
  const base = { exerciseId, direction: 'maintain', confidence: 'low', version: PROGRESSION_VERSION };
  if (!history.length) return { ...base, reason: 'No completed sessions yet — keep the starting prescription.', evidence: { sessions: 0 } };
  const sessions = history.length;
  const last = history[history.length - 1];

  // Discomfort or pain report → reduce, always.
  if (last.discomfort) {
    return { ...base, direction: 'reduce', confidence: 'high',
      reason: 'You reported discomfort — reduce load or swap for a listed alternative.',
      suggested: reduceSuggestion(last), evidence: { sessions, discomfort: true } };
  }
  // Hard-feedback preference (user asked to keep it easy) → maintain.
  if (prefs.intensity === 'gentle') {
    return { ...base, reason: 'You chose a gentle program — maintaining current difficulty.', evidence: { sessions } };
  }
  // Not enough data → maintain.
  if (sessions < MIN_SESSIONS) {
    return { ...base, reason: `Only ${sessions} completed session${sessions === 1 ? '' : 's'} — need at least ${MIN_SESSIONS} before suggesting progression.`,
      evidence: { sessions } };
  }
  // Performance declined at same load → reduce.
  const prev = history[history.length - 2];
  const vol = s => s.sets.reduce((a, x) => a + (x.reps || 0), 0);
  if (vol(last) < vol(prev) * 0.8) {
    return { ...base, direction: 'reduce', confidence: 'medium',
      reason: 'Total reps dropped vs the previous session — reduce or hold difficulty and prioritize recovery.',
      suggested: reduceSuggestion(last), evidence: { sessions, lastVolume: vol(last), prevVolume: vol(prev) } };
  }
  // Sufficient, comfortable data → modest increase suggestion.
  const rir = last.rir;
  const comfortable = Number.isFinite(rir) && rir >= COMFORTABLE_RIR;
  const sameLoad = heaviest(last) === heaviest(prev);
  if (comfortable && sameLoad && vol(last) >= vol(prev)) {
    const w = heaviest(last);
    const suggested = w ? { weightLbs: round(w * (1 + Math.min(MAX_WEEKLY_PCT, 5) / 100)), sets: last.sets.length }
                        : { addReps: 1 };
    return { ...base, direction: 'increase', confidence: 'medium',
      reason: `${sessions} consistent sessions${rir != null ? ` with ~${rir} reps in reserve` : ''} — a small increase is reasonable if you feel recovered.`,
      suggested, evidence: { sessions, lastVolume: vol(last), prevVolume: vol(prev), rir } };
  }
  return { ...base, reason: 'Keep current difficulty until performance is consistent at this level.', evidence: { sessions, lastVolume: vol(last) } };
}

const heaviest = s => Math.max(0, ...s.sets.map(x => x.weightLbs || 0)) || null;
const round = w => Math.round(w * 2) / 2; // 0.5 lb granularity

function reduceSuggestion(session) {
  const w = heaviest(session);
  return w ? { weightLbs: round(w * 0.9), note: 'reduce ~10% or use an alternative' }
           : { note: 'reduce reps/sets or use an alternative' };
}

/**
 * Plan-level review: missed workouts never punish; 2+ consecutive misses
 * suggest easing rather than catching up.
 */
function missedSessionNote(consecutiveMissed) {
  if (consecutiveMissed >= 2) return 'Several missed sessions — resume at the last comfortable level; no need to catch up.';
  if (consecutiveMissed === 1) return 'One missed session — continue as planned.';
  return null;
}

module.exports = { suggestNext, missedSessionNote, PROGRESSION_VERSION, MIN_SESSIONS, MAX_WEEKLY_PCT };
