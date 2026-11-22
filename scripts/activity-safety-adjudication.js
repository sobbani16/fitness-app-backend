#!/usr/bin/env node
// Shadow-disagreement adjudication queue — Phase 15 P2 deliverable.
//   node scripts/activity-safety-adjudication.js [--json]
// Writes docs/clinical/activity-safety-adjudication-queue.md.
//
// Every live-vs-shadow disagreement is: attributed to the dimension that
// produced it, mechanically re-verified (removing the contributing rules must
// restore the live decision), classified, and queued for reviewer decision.
// Stricter is NOT assumed correct — BLOCK/NCR transitions are flagged as
// potential over-restriction for adjudication. Privacy: scenario labels,
// activity ids, decision codes and rule codes only.

const { RULES } = require('../src/services/activitySafety/rulesData');
const { ACTIVITIES } = require('../src/services/activitySafety/activityCatalog');
const { evaluateActivity } = require('../src/services/activitySafety/engine');
const { DECISION_RANK } = require('../src/services/activitySafety/constants');
const fs = require('fs');
const path = require('path');

const MILD = { tempC: 20, apparentTempC: 20, aqi: { value: 30 }, uvIndex: 2, alerts: [], alertsAvailable: true };
const HOT = { ...MILD, tempC: 38, apparentTempC: 38 };
const AQI_BAD = { ...MILD, aqi: { value: 180 } };
const AQI_USG = { ...MILD, aqi: { value: 120 } };
const THUNDER = { ...MILD, weatherCode: 95 };
const COLD = { ...MILD, tempC: -10, apparentTempC: -10, windSpeedKmh: 25 };
const ALERT = { ...MILD, alerts: [{ event: 'Tornado Warning', severity: 'Extreme' }] };

const H = () => ({ conditions: [], injuries: [], surgeries: [], restrictions: [], symptomReports: [], mobility: {}, preferences: {} });
const inj = (o) => ({ status: 'current', laterality: 'right', ...o });
const restr = (o) => ({ status: 'active', severity: 'prohibited', source: 'clinician_documented', categories: [], bodyRegions: [], ...o });
const sym = (codes) => ({ status: 'active', symptoms: codes, reportedAt: new Date() });

const SCENARIOS = [
  ['healthy', H(), MILD],
  ['ankle_nwb_fracture', { ...H(), injuries: [inj({ bodyPart: 'ankle', type: 'fracture', weightBearingRestriction: 'non_weight_bearing', injuredAt: new Date() })] }, MILD],
  ['wrist_strain', { ...H(), injuries: [inj({ bodyPart: 'wrist', type: 'strain', injuredAt: new Date() })] }, MILD],
  ['knee_severe_pain', { ...H(), injuries: [inj({ bodyPart: 'knee', type: 'undiagnosed_pain', painLevel: 8 })] }, MILD],
  ['shoulder_prohibition', { ...H(), restrictions: [restr({ categories: ['upper_limb_load'] })] }, MILD],
  ['blanket_prohibition', { ...H(), restrictions: [restr({ categories: ['weight_bearing_lower', 'lower_limb_load', 'upper_limb_load', 'trunk_load', 'impact', 'balance_challenging', 'water_immersion', 'outdoor_exposed', 'vigorous'], bodyRegions: ['lower_limb', 'upper_limb', 'trunk'] })] }, MILD],
  ['post_surgical_undocumented', { ...H(), surgeries: [{ procedureCategory: 'orthopedic', status: 'recovering', clinicianRestrictions: [], activityClearance: null }] }, MILD],
  ['post_surgical_documented', { ...H(), surgeries: [{ procedureCategory: 'orthopedic', status: 'recovering', clinicianRestrictions: ['impact'], activityClearance: {} }] }, MILD],
  ['asthma_aqi_usg', { ...H(), conditionKeys: ['asthma'] }, AQI_USG],
  ['asthma_aqi_unhealthy', { ...H(), conditionKeys: ['asthma'] }, AQI_BAD],
  ['healthy_aqi_unhealthy', H(), AQI_BAD],
  ['fever', { ...H(), symptomReports: [sym(['fever'])] }, MILD],
  ['doms', { ...H(), symptomReports: [sym(['muscle_soreness_doms'])] }, MILD],
  ['dizziness', { ...H(), symptomReports: [sym(['dizziness'])] }, MILD],
  ['systemic_illness', { ...H(), symptomReports: [sym(['systemic_illness'])] }, MILD],
  ['cad_heat', { ...H(), conditionKeys: ['cad'] }, HOT],
  ['diabetes_stable', { ...H(), conditionKeys: ['diabetes_t2'] }, MILD],
  ['diabetes_heat', { ...H(), conditionKeys: ['diabetes_t2'] }, HOT],
  ['pregnancy_heat', { ...H(), pregnancyStatus: 'pregnant' }, HOT],
  ['ms_heat', { ...H(), conditionKeys: ['ms'] }, HOT],
  ['wheelchair', { ...H(), mobility: { wheelchairUser: true, walkingAbility: 'unable' } }, MILD],
  ['osteoarthritis', { ...H(), conditionKeys: ['osteoarthritis'] }, MILD],
  ['osteoporosis', { ...H(), conditionKeys: ['osteoporosis'] }, MILD],
  ['seizure', { ...H(), conditionKeys: ['seizure'] }, MILD],
  ['parkinsons', { ...H(), conditionKeys: ['parkinsons'] }, MILD],
  ['age65_heat', { ...H(), ageYears: 70 }, HOT],
  ['missing_health_data', { ...H(), ageYears: 70, profilePresent: false }, MILD],
  ['thunder', H(), THUNDER],
  ['severe_alert', H(), ALERT],
  ['cold_wind', H(), COLD],
  ['no_env_data', H(), null],
  ['stale_env', H(), { ...MILD, stale: true }],
  ['fall_risk_flag', { ...H(), mobility: { balanceLimitation: true }, ageYears: 70 }, COLD],
  ['immunosuppressed', { ...H(), conditionKeys: ['immunosuppressed'] }, MILD],
  ['joint_instability_symptom', { ...H(), symptomReports: [sym(['joint_instability'])] }, MILD],
  ['recent_hypoglycemia_dm', { ...H(), conditionKeys: ['diabetes_t1'], medicationFlags: ['hypoglycemia_risk'], symptomReports: [sym(['hypoglycemia'])] }, MILD],
  ['rest_day_user', { ...H(), preferences: { restDay: true } }, MILD],
  ['workout_planned_rain', { ...H(), preferences: { workoutPlanned: true } }, { ...MILD, precipitationMm: 8 }],
  ['high_risk_pregnancy_restriction', { ...H(), pregnancyStatus: 'pregnant', medicationFlags: ['pregnancy_high_risk'], restrictions: [restr({ categories: ['impact'] })] }, MILD],
];

const liveRules = [];
const shadowRules = RULES.map(r => ({ ...r, ruleCode: r.code }));
const INFO_MARKERS = new Set(['AS-CORE-004', 'AS-PREG-006', 'AS-PER-005']); // __always__ wording/policy markers
const CLINICAL_CLASSES = new Set(['EC', 'CP', 'EA']); // clinical evidence classes → clinician review
const CLASS_NAME = { EC: 'established_contraindication', CP: 'condition_precaution', EA: 'supported_adaptation', PD: 'product_default', UH: 'hypothesis' };
const ruleByCode = Object.fromEntries(shadowRules.map(r => [r.ruleCode, r]));

// Dimension that produced the change: registry rules only fire inside
// dimensions.medical; the merged decision can still land anywhere.
function changedDimensions(live, shadow) {
  const dims = [];
  for (const d of ['medical', 'functional', 'environmental', 'personalization']) {
    const l = live.dimensions[d].decision || 'ALLOW', s = shadow.dimensions[d].decision || 'ALLOW';
    if (l !== s) dims.push(d);
  }
  return dims.length ? dims : ['medical']; // medical dim holds ruleIds even when merged decision hides it
}

const raw = [];
for (const [scenario, ctx, env] of SCENARIOS) {
  for (const act of Object.values(ACTIVITIES)) {
    const live = evaluateActivity({ context: ctx, activity: act, env, rules: liveRules });
    const shadow = evaluateActivity({ context: ctx, activity: act, env, rules: shadowRules });
    if (live.decision === shadow.decision) continue;
    const contributing = shadow.ruleIds.filter(id => !live.ruleIds.includes(id));
    // Mechanical re-verification: remove the contributing rules → live decision must return.
    const sans = evaluateActivity({ context: ctx, activity: act, env, rules: shadowRules.filter(r => !contributing.includes(r.ruleCode)) });
    const dr = (DECISION_RANK[shadow.decision] || 0) - (DECISION_RANK[live.decision] || 0);
    const infoOnly = contributing.every(c => INFO_MARKERS.has(c));
    raw.push({
      scenario, activity: act.id, live: live.decision, shadow: shadow.decision,
      direction: dr > 0 ? 'stricter' : dr < 0 ? 'LOOSER' : 'lateral',
      rules: contributing, infoOnly,
      dims: changedDimensions(live, shadow),
      requiredData: [...new Set(shadow.requiredData)],
      mechanicallyVerified: sans.decision === live.decision,
    });
  }
}

// Dedupe to adjudication entries: same contributing-rule set + same transition.
const entries = new Map();
for (const r of raw) {
  const key = `${r.rules.join('+')}|${r.live}->${r.shadow}`;
  if (!entries.has(key)) entries.set(key, { rules: r.rules, live: r.live, shadow: r.shadow, direction: r.direction, dims: r.dims, requiredData: r.requiredData, infoOnly: r.infoOnly, mechanicallyVerified: true, instances: [] });
  const e = entries.get(key);
  e.instances.push(`${r.scenario}/${r.activity}`);
  e.mechanicallyVerified = e.mechanicallyVerified && r.mechanicallyVerified;
}
const queue = [...entries.values()].map((e, i) => {
  const clinical = e.rules.some(c => CLINICAL_CLASSES.has(ruleByCode[c]?.evidenceClass));
  const potentialOverRestriction = ['BLOCK_ACTIVITY', 'NEEDS_CLINICAL_REVIEW', 'URGENT_ESCALATION'].includes(e.shadow);
  return {
    id: `ADJ-${String(i + 1).padStart(3, '0')}`,
    ...e,
    expectedBehavior: e.infoOnly
      ? 'annotation only — wording/policy marker; decision shift is an artifact of the marker effect, not a clinical change'
      : `reviewer confirms ${e.shadow} is appropriate when ${e.rules.join(' + ')} matches`,
    clinicalReviewRequired: clinical,
    potentialOverRestriction: potentialOverRestriction && !e.infoOnly,
  };
});

const counts = {
  evaluations: SCENARIOS.length * Object.keys(ACTIVITIES).length,
  rawDisagreements: raw.length,
  entries: queue.length,
  looser: raw.filter(r => r.direction === 'LOOSER').length,
  infoOnly: queue.filter(e => e.infoOnly).length,
  overRestriction: queue.filter(e => e.potentialOverRestriction).length,
  clinicalReview: queue.filter(e => e.clinicalReviewRequired).length,
  mechanicalFailures: queue.filter(e => !e.mechanicallyVerified).length,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ counts, queue }, null, 1));
  return;
}

const ruleLine = (c) => { const r = ruleByCode[c]; return r ? `\`${c}\` (${CLASS_NAME[r.evidenceClass] || r.evidenceClass}, ${r.effect})` : `\`${c}\``; };
let md = `# Activity Safety — Shadow Adjudication Queue (auto-generated)

**Generated by** \`scripts/activity-safety-adjudication.js\` · live = APPROVED-only (zero — structural only) vs shadow = all ${RULES.length} DRAFT rules · ${counts.evaluations} evaluations across ${SCENARIOS.length} scenarios × ${Object.keys(ACTIVITIES).length} activities.

**For qualified reviewers.** Each entry is a distinct decision transition caused by a draft rule set; instances list every scenario/activity exhibiting it. "Mechanically verified" means removing the contributing rules reproduces the live decision — the disagreement is fully attributed. **Stricter is not assumed correct** — BLOCK/NEEDS_CLINICAL_REVIEW/URGENT transitions are flagged for over-restriction adjudication. Nothing here is clinical approval.

| Metric | Value |
|---|---|
| Raw disagreements | ${counts.rawDisagreements} |
| Distinct adjudication entries | ${counts.entries} |
| LOOSER transitions (inappropriate-recommendation risk) | ${counts.looser} |
| Annotation-only (info/policy markers) | ${counts.infoOnly} |
| Potential over-restriction (BLOCK/NCR/URGENT) | ${counts.overRestriction} |
| Entries requiring clinician review | ${counts.clinicalReview} |
| Mechanical attribution failures | ${counts.mechanicalFailures} |

`;
for (const e of queue) {
  md += `## ${e.id} — live \`${e.live}\` → shadow \`${e.shadow}\` (${e.direction}${e.infoOnly ? ' · annotation-only' : ''}${e.potentialOverRestriction ? ' · ⚠ potential over-restriction' : ''})\n\n`;
  md += `- **Contributing rules:** ${e.rules.map(ruleLine).join(', ')}\n`;
  md += `- **Dimension:** ${e.dims.join(', ')} · **Mechanically verified:** ${e.mechanicallyVerified ? 'yes' : '**NO — investigate**'}\n`;
  if (e.requiredData.length) md += `- **Missing/conflicting info surfaced:** ${e.requiredData.join(', ')}\n`;
  md += `- **Expected behavior:** ${e.expectedBehavior}\n`;
  md += `- **Clinical review required:** ${e.clinicalReviewRequired ? 'yes' : 'product review sufficient'}\n`;
  md += `- **Instances (${e.instances.length}):** ${e.instances.slice(0, 12).join(', ')}${e.instances.length > 12 ? ` … +${e.instances.length - 12} more` : ''}\n\n`;
}
md += `---\n_Mechanically verified = removing contributing rules restores the live decision. Inert/unsupported rules produce no rows — their absence is itself review evidence._\n`;
fs.writeFileSync(path.join(__dirname, '../docs/clinical/activity-safety-adjudication-queue.md'), md);
console.log(`evals ${counts.evaluations} · disagreements ${counts.rawDisagreements} → ${counts.entries} adjudication entries (LOOSER ${counts.looser}, annotation-only ${counts.infoOnly}, over-restriction ${counts.overRestriction}, mech-fail ${counts.mechanicalFailures})`);
