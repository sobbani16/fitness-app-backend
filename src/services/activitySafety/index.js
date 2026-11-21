// Activity Safety — public service API. ONE entry point used by every
// recommendation producer (dashboard suggestions, health priorities, voice
// pre-checks, reminder suppression, evaluation endpoint) so no path can
// bypass the same policy.
//
//   loadSafetyContext(prisma, userId, opts)
//   loadRules(prisma, {includeDrafts})        — APPROVED-only by default
//   evaluateActivity(context, activity, env, opts)
//   recommend(context, env, opts)             — ranks the candidate catalog
//   evaluateAndPersist(prisma, ctx, ...)      — writes ActivitySafetyEvaluation
//   invalidateCheck(evalRow, ctx)             — cache-bypass protection

const { POLICY_VERSION, DECISIONS: D, DECISION_RANK } = require('./constants');
const { evaluateActivity, normalizeContext } = require('./engine');
const { listActivities, getActivity } = require('./activityCatalog');
const { loadSafetyContext } = require('./context');

// Rules: only APPROVED rows fire for real users. includeDrafts is for
// shadow-mode evaluation and tests — never the default.
async function loadRules(prisma, { includeDrafts = false } = {}) {
  const where = includeDrafts ? {} : { reviewStatus: 'APPROVED' };
  return prisma.activitySafetyRule.findMany({ where });
}

function evaluate(context, activity, env, { rules = [], now } = {}) {
  return evaluateActivity({ context: normalizeContext(context), activity, env, rules, now: now || new Date() });
}

// Evaluate every candidate and derive the recommendation set. The pipeline:
// suppress-if-rest → per-candidate evaluation → alternatives = eligible
// candidates → pick preferred eligible → compose explanation.
function recommend(context, env, { rules = [], now = new Date(), candidates } = {}) {
  const list = candidates || listActivities();
  const ctx = normalizeContext(context);
  const results = list.map(a => evaluate(ctx, a, env, { rules, now }));

  if (results.some(r => r.decision === D.URGENT_ESCALATION)) {
    const urgent = results.find(r => r.decision === D.URGENT_ESCALATION);
    return {
      disposition: 'suppressed_urgent',
      suggestion: null,
      urgent: pick(urgent),
      results,
      policyVersion: POLICY_VERSION,
    };
  }

  const suppressed = results.every(r => r.suppressed);
  if (suppressed) {
    return { disposition: 'suppressed_rest', suggestion: null, results, policyVersion: POLICY_VERSION };
  }

  // Eligible = ALLOW or MODIFY. DEFER_OUTDOOR activities stay listed so the
  // user sees *why* the outdoor option isn't suggested, but they aren't
  // offered as alternatives.
  const rank = r => DECISION_RANK[r.decision] ?? 0;
  const eligible = results.filter(r => [D.ALLOW, D.MODIFY].includes(r.decision));
  const blocked = results.filter(r => rank(r) > DECISION_RANK.MODIFY);

  // Personalization boosts preference-matched eligible candidates.
  const prefs = new Set(ctx.activityPreferences || ctx.preferences?.activityPreferences || []);
  const preferred = eligible.slice().sort((a, b) => {
    const pa = prefs.has(a.candidateActivityId) ? 1 : 0;
    const pb = prefs.has(b.candidateActivityId) ? 1 : 0;
    return pb - pa || rank(a) - rank(b);
  });

  const suggestion = preferred.length ? {
    activityId: preferred[0].candidateActivityId,
    decision: preferred[0].decision,
    reasons: preferred[0].reasons,
    betterTime: preferred[0].betterTime,
    modifyNotes: preferred[0].decision === D.MODIFY ? preferred[0].reasons : [],
  } : null;

  // Fill allowedAlternatives on every result so each evaluation explains
  // what else was still compatible.
  const alternativeIds = eligible.map(r => r.candidateActivityId);
  for (const r of results) r.allowedAlternatives = alternativeIds.filter(id => id !== r.candidateActivityId);

  return {
    disposition: suggestion ? 'suggestion' : (blocked.length ? 'no_safe_candidate' : 'no_suggestion'),
    suggestion,
    requiredData: [...new Set(results.flatMap(r => r.requiredData || []))],
    results,
    policyVersion: POLICY_VERSION,
  };
}

function pick(r) {
  const { candidateActivityId, decision, reasons, ruleIds, requiredData, policyVersion } = r;
  return { candidateActivityId, decision, reasons, ruleIds, requiredData, policyVersion };
}

// Persist an evaluation with input provenance. The inputsStamp is the newest
// updatedAt across all safety inputs — a cached row is invalid the moment an
// injury/restriction/symptom changes.
async function persistEvaluation(prisma, result, ctx, { environmentObsId = null, shadow = false, expiresAt = null } = {}) {
  return prisma.activitySafetyEvaluation.create({
    data: {
      userId: ctx.userId,
      activityId: result.candidateActivityId,
      decision: result.decision,
      dimensions: { ...result.dimensions, inputsStamp: ctx.inputsStamp || null },
      ruleIds: result.ruleIds,
      reasons: result.reasons,
      restrictions: result.restrictions,
      requiredData: result.requiredData,
      alternatives: result.allowedAlternatives,
      policyVersion: result.policyVersion || POLICY_VERSION,
      environmentObsId, shadow,
      expiresAt,
    },
  });
}

// Cache-bypass protection: a persisted evaluation is only reusable when the
// recorded inputsStamp matches the *current* inputsStamp and the policy
// version matches — a new injury or restriction can never be bypassed.
function isEvaluationFresh(row, ctx, { now = new Date() } = {}) {
  if (!row) return false;
  if (row.policyVersion !== POLICY_VERSION) return false;
  if (row.expiresAt && new Date(row.expiresAt) <= now) return false;
  const recorded = row.dimensions && row.dimensions.inputsStamp;
  return (recorded || null) === (ctx.inputsStamp || null);
}

module.exports = {
  POLICY_VERSION, DECISIONS: D, DECISION_RANK,
  loadSafetyContext, loadRules, evaluate, recommend, persistEvaluation, isEvaluationFresh,
  listActivities, getActivity, normalizeContext,
};
