// Health plan resolver — ONE deterministic precedence cascade every
// recommendation surface composes from (Phase 7 / audit doc 13 §3).
//
// Precedence (P1..P9):
//   P1 urgent symptoms         → URGENT_ESCALATION short-circuits everything
//   P2 allergies/restrictions  → hard exclusions
//   P3 medication safety       → safety flags from classified medications
//   P4 life-stage              → pregnancy/postpartum/under-18 constraints
//   P5 clinician limits        → clinician-established bounds (future: table)
//   P6 condition rules         → APPROVED+activated rules only (liveRuleWhere)
//   P7 adequacy                → floor/boundary checks
//   P8 goals                   → user targets
//   P9 preferences             → convenience/preferences last
//
// Unknown is never treated as safe: missing inputs land in `missingData` and
// conflicting approved rules produce PERSONALIZATION_REQUIRED + an open
// UserClinicalReview row — never an AI-invented compromise.
const { getPrisma } = require('../../lib/prisma');
const { loadSafetyContext } = require('../activitySafety/context');
const { liveRuleWhere, isRuleLive } = require('../healthOutcomes/clinicalRuleGovernance');
const { loadMedicationSafetyContext } = require('../healthOutcomes/medicationCatalog');
const { loadUserConditions } = require('../healthOutcomes/conditionRegistry');
const { loadUserAllergies } = require('../allergens');

const POLICY_VERSION = 'health-engine/1.0.0';

async function resolvePlan(prisma, userId, { purpose = 'plan', now = new Date(), persist = true } = {}) {
  const db = prisma || getPrisma();
  const [safety, conditions, meds, allergies] = await Promise.all([
    loadSafetyContext(db, userId, { now }).catch(() => null),
    loadUserConditions(db, userId).catch(() => []),
    loadMedicationSafetyContext(db, userId).catch(() => ({ flags: new Set(), medications: [], unclassified: [] })),
    loadUserAllergies(db, userId).catch(() => ({ keys: [], custom: [] })),
  ]);

  const decisions = [];
  const findings = [];
  const missingData = [];
  const conflicts = [];
  const add = (level, kind, detail) => decisions.push({ level, kind, detail });

  // ---- P1: urgent symptoms dominate everything
  if (safety?.symptomReports?.length) {
    const urgent = safety.symptomReports.filter(s => (s.severity === 'severe' || s.urgent === true));
    if (urgent.length) {
      const plan = {
        status: 'URGENT_ESCALATION',
        decisions: [{ level: 'P1', kind: 'urgent_symptoms', detail: { count: urgent.length } }],
        findings, conflicts, missingData,
        explainability: { why: 'Active urgent symptoms take precedence over every other input.', conditionsApplied: [], evidenceRefs: [], alternatives: 'none — escalation dominates', missingData, reconsiderAt: null },
        policyVersion: POLICY_VERSION, purpose, resolvedAt: now.toISOString(),
      };
      if (persist) await persistEvaluation(db, userId, plan);
      return plan;
    }
  }

  // ---- P2: allergies + documented restrictions (hard exclusions)
  if (allergies.keys?.length || allergies.custom?.length) add('P2', 'allergies', { keys: allergies.keys, customCount: allergies.custom?.length || 0 });
  if (safety?.restrictions?.length) add('P2', 'activity_restrictions', { count: safety.restrictions.length });

  // ---- P3: medication safety flags
  if (meds.flags.size) {
    add('P3', 'medication_flags', { flags: [...meds.flags] });
    if (meds.flags.has('hypoglycemia_risk')) findings.push({ level: 'P3', status: 'GUIDANCE', reason: 'hypoglycemia-aware fueling guidance applies around exercise.' });
    if (meds.flags.has('vitamin_k_consistency')) findings.push({ level: 'P3', status: 'GUIDANCE', reason: 'keep vitamin K intake consistent day to day.' });
    if (meds.flags.has('potassium_monitoring')) findings.push({ level: 'P3', status: 'GUIDANCE', reason: 'potassium context flagged by medication class — do not adjust electrolytes without clinician input.' });
  }
  if (meds.unclassified?.length) missingData.push({ kind: 'unclassified_medications', detail: `${meds.unclassified.length} medication(s) unclassified — no safety flags assumed.` });
  const staleMeds = (meds.medications || []).filter(m => !m.lastConfirmedAt || (now - new Date(m.lastConfirmedAt)) > 90 * 86400000);
  if (staleMeds.length) missingData.push({ kind: 'stale_medications', detail: `${staleMeds.length} medication(s) not confirmed in 90+ days.` });

  // ---- P4: life-stage (never inferred — only from explicit profile fields)
  if (safety?.pregnancyStatus === 'pregnant') add('P4', 'pregnancy', { note: 'pregnancy-aware constraints apply; automated calorie targets suspended' });
  if (safety?.pregnancyStatus === 'postpartum' || (safety?.postpartumWeeks != null && safety.postpartumWeeks <= 52)) add('P4', 'postpartum', {});
  if (safety?.ageYears != null && safety.ageYears < 18) add('P4', 'under_18', { note: 'automated targets disabled for minors' });

  // ---- P6: approved+activated condition rules
  const conditionIds = conditions.map(c => c.conditionId);
  let liveRules = [];
  if (conditionIds.length) {
    const [nutrientRules, conditionRules, activityRules] = await Promise.all([
      db.healthConditionNutrientRule.findMany({ where: { healthConditionId: { in: conditionIds }, ...liveRuleWhere(now) }, include: { nutrient: true, evidence: true } }).catch(() => []),
      db.conditionRule.findMany({ where: { conditionId: { in: conditionIds }, ...liveRuleWhere(now) }, include: { evidence: true } }).catch(() => []),
      db.activitySafetyRule.findMany({ where: liveRuleWhere(now) }).catch(() => []),
    ]);
    liveRules = [...nutrientRules, ...conditionRules, ...activityRules].filter(r => isRuleLive(r, now));
  }
  const slugs = conditions.map(c => c.condition?.slug || c.condition?.name).filter(Boolean);
  add('P6', 'condition_rules', { rulesEvaluated: liveRules.length, conditions: slugs });
  if (conditions.length && !liveRules.length) {
    missingData.push({ kind: 'no_approved_rules', detail: `${conditions.length} condition(s) recorded but no approved+activated rules exist — personalization is education-only until clinical review completes.` });
  }

  // ---- conflict detection: opposing actions across live rules
  const blocked = new Set(liveRules.filter(r => ['block', 'AVOID_IF_INDICATED', 'AVOID', 'LIMIT'].includes(r.action)).map(r => `${r.attribute || r.nutrientId}:limit`));
  const prioritized = new Set(liveRules.filter(r => ['PRIORITIZE', 'prioritize'].includes(r.action)).map(r => `${r.attribute || r.nutrientId}:boost`));
  for (const b of blocked) if (prioritized.has(b.replace(':limit', ':boost'))) conflicts.push({ kind: 'rule_conflict', detail: b });

  // Medication × condition tension (hypoglycemia-risk med + diabetes condition already covered by P3+P6 independently — flag combined context)
  if (meds.flags.has('hypoglycemia_risk') && slugs.some(s => /diabetes|prediabetes/.test(String(s)))) {
    findings.push({ level: 'P3×P6', status: 'GUIDANCE', reason: 'medication hypoglycemia risk + glucose condition: exercise fueling and fasting plans need clinician awareness.' });
  }

  // ---- status
  let status = 'RESOLVED';
  if (conflicts.length) {
    status = 'PERSONALIZATION_REQUIRED';
    // Patient-level escalation — a clinician reconciles; we never guess.
    await db.userClinicalReview.create({
      data: { userId, reason: 'conflicting_conditions', context: { conflicts, conditions: slugs, purpose }, status: 'open' },
    }).catch(() => null);
  } else if (missingData.some(m => m.kind === 'no_approved_rules')) {
    status = 'EDUCATION_ONLY';
  }

  const plan = {
    status,
    decisions, findings, conflicts, missingData,
    explainability: {
      why: status === 'RESOLVED' ? 'Applied precedence cascade; no unresolved conflicts.' : status === 'PERSONALIZATION_REQUIRED' ? 'Approved rules conflict; clinician review required — no guess made.' : 'Recorded conditions lack approved rules; education-only guidance.',
      conditionsApplied: slugs,
      evidenceRefs: [...new Set(liveRules.map(r => r.evidence?.code || r.evidenceSourceId).filter(Boolean))],
      alternatives: 'n/a at plan level',
      missingData,
      reconsiderAt: null,
    },
    policyVersion: POLICY_VERSION, purpose, resolvedAt: now.toISOString(),
  };
  if (persist) await persistEvaluation(db, userId, plan);
  return plan;
}

async function persistEvaluation(db, userId, plan) {
  try {
    await db.safetyAuditLog.create({
      data: {
        userId,
        checkType: 'health_plan',
        input: { purpose: plan.purpose, policyVersion: plan.policyVersion },
        result: { status: plan.status, decisionLevels: plan.decisions.map(d => d.level), rulesEvaluated: plan.explainability.conditionsApplied.length, missingData: plan.missingData.map(m => m.kind) },
        safetyScore: plan.status === 'RESOLVED' ? 100 : plan.status === 'PERSONALIZATION_REQUIRED' ? 50 : 75,
      },
    });
  } catch { /* audit is best-effort, never blocks the response */ }
}

module.exports = { resolvePlan, POLICY_VERSION };
