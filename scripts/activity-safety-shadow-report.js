#!/usr/bin/env node
// Shadow-mode disagreement report — evaluates a representative scenario matrix
// under live rules (APPROVED-only — currently zero) vs shadow rules (all 71
// DRAFT) and reports EVERY decision disagreement. This is the artifact a
// clinician reviews to see what activating each draft rule would change.
//   node scripts/activity-safety-shadow-report.js [--json]
// Privacy: output carries scenario labels, activity ids, decision codes and
// rule codes only — never user data.

const { RULES } = require('../src/services/activitySafety/rulesData');
const { ACTIVITIES } = require('../src/services/activitySafety/activityCatalog');
const { evaluateActivity } = require('../src/services/activitySafety/engine');
const { DECISION_RANK } = require('../src/services/activitySafety/constants');

const MILD = { tempC: 20, apparentTempC: 20, aqi: { value: 30 }, uvIndex: 2, alerts: [], alertsAvailable: true };
const HOT = { ...MILD, tempC: 38, apparentTempC: 38 };
const AQI_BAD = { ...MILD, aqi: { value: 180 } };
const AQI_USG = { ...MILD, aqi: { value: 120 } };
const THUNDER = { ...MILD, weatherCode: 95 };
const COLD = { ...MILD, tempC: -10, apparentTempC: -10, windSpeedKmh: 25 };
const ALERT = { ...MILD, alerts: [{ event: 'Tornado Warning', severity: 'Extreme' }] };
const NO_ENV = null;

const H = () => ({ conditions: [], injuries: [], surgeries: [], restrictions: [], symptomReports: [], mobility: {}, preferences: {} });
const inj = (o) => ({ status: 'current', laterality: 'right', ...o });
const restr = (o) => ({ status: 'active', severity: 'prohibited', source: 'clinician_documented', categories: [], bodyRegions: [], ...o });
const sym = (codes) => ({ status: 'active', symptoms: codes, reportedAt: new Date() });

// Representative scenarios — labels describe the fixture, not a real user.
const SCENARIOS = [
  ['healthy', H(), MILD],
  ['ankle_nwb_fracture', { ...H(), injuries: [inj({ bodyPart: 'ankle', type: 'fracture', weightBearingRestriction: 'non_weight_bearing' })] }, MILD],
  ['wrist_strain', { ...H(), injuries: [inj({ bodyPart: 'wrist', type: 'strain' })] }, MILD],
  ['knee_severe_pain', { ...H(), injuries: [inj({ bodyPart: 'knee', type: 'pain_unspecified', painLevel: 8 })] }, MILD],
  ['shoulder_prohibition', { ...H(), restrictions: [restr({ categories: ['upper_limb_load'] })] }, MILD],
  ['blanket_prohibition', { ...H(), restrictions: [restr({ categories: ['weight_bearing_lower', 'lower_limb_load', 'upper_limb_load', 'trunk_load', 'impact', 'balance_challenging', 'water_immersion', 'outdoor_exposed', 'vigorous'], bodyRegions: ['lower_limb', 'upper_limb', 'trunk'] })] }, MILD],
  ['post_surgical_undocumented', { ...H(), surgeries: [{ procedureCategory: 'knee_arthroscopy', status: 'recovering', clinicianRestrictions: [], activityClearance: {} }] }, MILD],
  ['asthma_aqi_usg', { ...H(), conditionKeys: ['asthma'] }, AQI_USG],
  ['asthma_aqi_unhealthy', { ...H(), conditionKeys: ['asthma'] }, AQI_BAD],
  ['healthy_aqi_unhealthy', H(), AQI_BAD],
  ['fever', { ...H(), symptomReports: [sym(['fever'])] }, MILD],
  ['doms', { ...H(), symptomReports: [sym(['muscle_soreness_doms'])] }, MILD],
  ['dizziness', { ...H(), symptomReports: [sym(['dizziness'])] }, MILD],
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
  ['no_env_data', H(), NO_ENV],
  ['fall_risk_flag', { ...H(), medicationFlags: ['fall_risk'] }, COLD],
  ['immunosuppressed', { ...H(), conditionKeys: ['immunosuppressed'] }, MILD],
  ['respiratory_infection', { ...H(), symptomReports: [sym(['systemic_illness'])] }, MILD],
];

const liveRules = []; // APPROVED set is empty — live = structural only
const shadowRules = RULES.map(r => ({ ...r, ruleCode: r.code }));

const rows = [];
for (const [label, ctx, env] of SCENARIOS) {
  for (const act of Object.values(ACTIVITIES)) {
    const live = evaluateActivity({ context: ctx, activity: act, env, rules: liveRules });
    const shadow = evaluateActivity({ context: ctx, activity: act, env, rules: shadowRules });
    if (live.decision === shadow.decision) continue;
    const dr = (DECISION_RANK[shadow.decision] || 0) - (DECISION_RANK[live.decision] || 0);
    rows.push({
      scenario: label, activity: act.id,
      live: live.decision, shadow: shadow.decision,
      direction: dr > 0 ? 'stricter' : dr < 0 ? 'LOOSER' : 'lateral',
      rules: shadow.ruleIds.filter(id => !live.ruleIds.includes(id)),
    });
  }
}

const looser = rows.filter(r => r.direction === 'LOOSER');
const lateral = rows.filter(r => r.direction === 'lateral');
const stricter = rows.filter(r => r.direction === 'stricter');

const summary = {
  scenarios: SCENARIOS.length,
  evaluations: SCENARIOS.length * Object.keys(ACTIVITIES).length,
  disagreements: rows.length,
  stricter: stricter.length,
  lateral: lateral.length,
  looser: looser.length,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ summary, rows }, null, 1));
  return;
}
let md = `# Activity Safety — Shadow Disagreement Report (auto-generated)

**Generated by** \`scripts/activity-safety-shadow-report.js\` · live = APPROVED-only rules (currently zero — structural mechanics only) vs shadow = all 71 DRAFT rules.

**This report lists every context where a draft rule would change the decision a user sees today.** Direction *stricter* = draft rules make it more conservative. Direction *LOOSER* = draft rules would relax a decision — each LOOSER row is a potential inappropriate-recommendation risk requiring explicit reviewer scrutiny before any approval.

| Metric | Value |
|---|---|
| Scenarios | ${summary.scenarios} |
| Evaluations | ${summary.evaluations} |
| Disagreements | ${summary.disagreements} |
| Stricter | ${summary.stricter} |
| Lateral (same rank — semantic shift) | ${summary.lateral} |
| **LOOSER** | **${summary.looser}** |

## LOOSER disagreements (review first)

${looser.length ? looser.map(r => `- **${r.scenario}** · \`${r.activity}\` — live \`${r.live}\` → shadow \`${r.shadow}\` via ${r.rules.join(', ')}`).join('\n') : '_none — no draft rule relaxes any live decision in this matrix_'}

## Lateral disagreements (DEFER_OUTDOOR ↔ MODIFY, same rank)

${lateral.length ? lateral.map(r => `- **${r.scenario}** · \`${r.activity}\` — live \`${r.live}\` → shadow \`${r.shadow}\` via ${r.rules.join(', ')}`).join('\n') : '_none_'}

## LOOSER disagreements (review first)

${looser.length ? looser.map(r => `- **${r.scenario}** · \`${r.activity}\` — live \`${r.live}\` → shadow \`${r.shadow}\` via ${r.rules.join(', ')}`).join('\n') : '_none — no draft rule relaxes any live decision in this matrix_'}

## Stricter disagreements

${stricter.length ? stricter.map(r => `- **${r.scenario}** · \`${r.activity}\` — live \`${r.live}\` → shadow \`${r.shadow}\` via ${r.rules.join(', ')}`).join('\n') : '_none_'}

---
_Note: rules inert as encoded (see the review package) naturally produce no disagreement rows — their absence here is itself review evidence._
`;
require('fs').writeFileSync(require('path').join(__dirname, '../docs/audits/activity-safety-shadow-report.md'), md);
console.log(`scenarios ${summary.scenarios} · evals ${summary.evaluations} · disagreements ${summary.disagreements} (stricter ${summary.stricter} / LOOSER ${summary.looser})`);
