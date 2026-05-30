// Pure business logic for smart exercise logging.
// Keep this framework-agnostic so it is trivially unit-testable.

/**
 * Given the previous session for an exercise, derive the suggested weight
 * for the next session's first set.
 *
 * Rules:
 *  - No previous session → null (user must enter manually)
 *  - Previous session with sets → weight of the last set performed
 */
function suggestWeightFromHistory(previousSession) {
  if (!previousSession || !Array.isArray(previousSession.sets) || previousSession.sets.length === 0) {
    return null;
  }
  const last = previousSession.sets[previousSession.sets.length - 1];
  return typeof last.weight === 'number' ? last.weight : null;
}

/**
 * Autofill weight for the next set within the current session.
 *
 * Rules:
 *  - If user hasn't overridden → reuse the weight from the most recent set
 *  - Explicit override → return the override
 *  - No prior set + no override → return null (caller falls back to history / manual)
 */
function autofillSetWeight(currentSets, override) {
  if (override !== undefined && override !== null && Number.isFinite(Number(override))) {
    return Number(override);
  }
  if (Array.isArray(currentSets) && currentSets.length > 0) {
    const last = currentSets[currentSets.length - 1];
    if (Number.isFinite(Number(last.weight))) return Number(last.weight);
  }
  return null;
}

/**
 * Build the payload we return from the "prefill" endpoint.
 * Consumers use this to pre-populate the UI before the user logs any set.
 */
function buildPrefill(previousSession) {
  const suggestedWeight = suggestWeightFromHistory(previousSession);
  return {
    suggestedWeight,
    lastSessionAt: previousSession ? previousSession.createdAt : null,
    lastSetCount: previousSession ? previousSession.sets.length : 0,
  };
}

module.exports = {
  suggestWeightFromHistory,
  autofillSetWeight,
  buildPrefill,
};
