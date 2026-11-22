#!/usr/bin/env node
// Phase 16.2 — rule-by-rule validation audit.
// Emits docs/audits/activity-safety-rule-by-rule-validation.md + machine-readable
// docs/audits/activity-safety-rule-audit.json.
// AUTOMATED ANALYSIS ONLY — proves encoded behavior + evidence linkage,
// never clinical correctness. All rules remain DRAFT pending qualified review.
const { RULES } = require('../src/services/activitySafety/rulesData');
const { SYMPTOMS_URGENT, SYMPTOM_CODES, SYMPTOM_ALIASES, DERIVABLE_PROFILE_FLAGS } = require('../src/services/activitySafety/constants');
const { exampleSpec, verified, mirrors, conf } = require('./activity-safety-review-package');
const fs = require('fs'), path = require('path');

const DIMENSION = { core: 'medical', cv: 'medical', resp: 'medical', endo: 'medical', neuro: 'medical', msk: 'functional', preg: 'medical', surg: 'functional', med: 'medical', env: 'environmental', per: 'personalization', rec: 'personalization', sys: 'medical' };
const GUIDANCE = {
  ACSM_SCREEN_2015: { org: 'ACSM', note: 'ACSM preparticipation screening update (Riebe 2015) — urgent-symptom referral; reviewer verifies symptom list vs current ACSM algorithm.', tier: 'physician-or-clinical-exercise-physiologist' },
  PARQ_PLUS: { org: 'PAR-Q+', note: 'PAR-Q+ 2021 evidence-based screening — general readiness gating; verify wording alignment.', tier: 'clinical-exercise-physiologist' },
  ACOG_804: { org: 'ACOG', note: 'ACOG Committee Opinion 804 (2020) physical activity in pregnancy/postpartum — absolute+relative contraindications; verify each trigger against the table.', tier: 'obstetric-specialist' },
  APTA_ANKLE_2021: { org: 'APTA/JOSPT', note: 'JOSPT ankle instability/return-to-sport guidance — non-weight-bearing and graded-loading framing; verify thresholds.', tier: 'sports-physio-or-physician' },
  EPA_AQI: { org: 'EPA', note: 'US AQI bands (101–150 USG, 151–200 unhealthy, 201+ very unhealthy) + AirNow activity guidance; verify band edges used by environmentService.', tier: 'exercise-physiologist' },
  WMO_HEAT: { org: 'WMO/WHO', note: 'Heat-health warning framing; verify apparent-temp thresholds vs WMO HHWWS tiers.', tier: 'exercise-physiologist' },
  CDC: { org: 'CDC', note: 'US physical-activity guidance during illness; verify "above/below the neck" framing is not over-applied.', tier: 'physician' },
  ADA: { org: 'ADA', note: 'ADA Standards of Care — hypoglycemia precautions, foot checks, retinopathy/neuropathy activity caveats.', tier: 'physician-or-CDE' },
  AHA: { org: 'AHA', note: 'AHA scientific statements on exercise in cardiovascular conditions.', tier: 'physician' },
  'PRODUCT-POLICY': { org: 'internal', note: 'Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself.', tier: 'product+clinical' },
  ACSM_BONE_2004: { org: 'ACSM', note: 'ACSM position stand on physical activity & bone health — osteoporosis loading/fracture-risk framing; verify flexion/rotation restrictions vs current guidance.', tier: 'physician-or-clinical-exercise-physiologist' },
  ACSM_CANCER_2019: { org: 'ACSM', note: 'ACSM roundtable on exercise for cancer survivors (2019) — fatigue/lymphedema/immunosuppression precautions.', tier: 'physician-or-clinical-exercise-physiologist' },
  ADA_PA_2016: { org: 'ADA', note: 'ADA position statement: physical activity/exercise and diabetes (2016) — hypoglycemia risk windows, foot care, retinopathy caveats.', tier: 'physician-or-CDE' },
  'AHA statement': { org: 'AHA', note: 'Generic AHA statement ref — reviewer must identify the specific statement for this rule.', tier: 'physician' },
  AHA_RESISTANCE_CVD: { org: 'AHA', note: 'AHA scientific statement on resistance exercise in CVD — Valsalva/BP-response precautions.', tier: 'physician' },
  CDC_EXTREME_HEAT: { org: 'CDC', note: 'CDC extreme-heat guidance — verify apparent-temp thresholds + population exclusions.', tier: 'exercise-physiologist' },
  CDC_PA_ADULTS: { org: 'CDC/HHS', note: 'US physical-activity guidelines — general volume framing; verify no over-restriction of appropriate activity.', tier: 'qualified-exercise-professional' },
  CDC_STEADI: { org: 'CDC', note: 'CDC STEADI fall-risk screening — balance/fall-risk activity precautions for older adults.', tier: 'physician-or-clinical-exercise-physiologist' },
  DOMS_ACSM: { org: 'ACSM', note: 'ACSM DOMS position content — delayed-onset soreness ≠ injury; verify MODIFY-vs-ALLOW calibration.', tier: 'clinical-exercise-physiologist' },
  EPA_AQ_ACTIVITY: { org: 'EPA', note: 'EPA/AirNow activity guidance per AQI band — verify outdoor deferral bands.', tier: 'exercise-physiologist' },
  EPA_UV: { org: 'EPA', note: 'EPA UV-index exposure guidance.', tier: 'exercise-physiologist' },
  EPA_WILDFIRE: { org: 'EPA', note: 'EPA wildfire-smoke/AQI guidance — verify smoke-hazard behavior vs AQI bands.', tier: 'exercise-physiologist' },
  EPILEPSY_EXERCISE: { org: 'ILAE/specialist', note: 'Exercise & epilepsy consensus guidance — seizure-trigger precautions; specialist review required.', tier: 'physician/neurology' },
  HHS_PAG_2018: { org: 'HHS', note: 'HHS Physical Activity Guidelines 2nd ed (2018) — general guidance + older-adult balance framing.', tier: 'qualified-exercise-professional' },
  NKF_CKD_EXERCISE: { org: 'NKF', note: 'National Kidney Foundation exercise guidance for CKD — dialysis-day and access-site precautions.', tier: 'physician/nephrology' },
  NMSS_HEAT: { org: 'NMSS', note: 'National MS Society heat-sensitivity guidance (Uhthoff) — temperature thresholds need specialist check.', tier: 'physician/neurology' },
  NWS: { org: 'NWS', note: 'National Weather Service alert severity semantics.', tier: 'engineering-verified' },
  NWS_HEAT_INDEX: { org: 'NWS', note: 'NWS heat-index bands (caution/extreme caution/danger/extreme danger) — verify mapping.', tier: 'exercise-physiologist' },
  NWS_LIGHTNING: { org: 'NWS', note: 'NWS lightning-safety guidance ("when thunder roars, go indoors").', tier: 'exercise-physiologist' },
  NWS_WINDCHILL: { org: 'NWS', note: 'NWS windchill frostbite-time bands — verify threshold mapping.', tier: 'exercise-physiologist' },
  PARKINSON_EXERCISE: { org: 'specialist', note: 'Parkinson disease exercise guidance — balance/gait precautions; specialist review.', tier: 'physician/neurology' },
  WHO_PA_2020: { org: 'WHO', note: 'WHO 2020 guidelines on physical activity & sedentary behaviour — verify volume framing per population.', tier: 'qualified-exercise-professional' },
  'clinician-doc': { org: 'clinician', note: 'Clinician-documented input — rule acts on clinician-entered restriction data.', tier: 'documenting-clinician' },
  'clinician-document': { org: 'clinician', note: 'Clinician-documented input — rule acts on clinician-entered restriction data.', tier: 'documenting-clinician' },
};
const INPUT_CHANNEL = (g) => ({ symptoms: 'POST /symptoms → UserSymptomReport (canonical registry + aliases)', injuries: 'POST /injuries → UserInjury', surgeries: 'POST → UserSurgery', conditions: 'UserHealthCondition→HealthCondition.name', profileFlags: 'derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags', environmentHazards: 'environmentService hazards', environment: 'environmentService obs', activityCategories: 'activity catalog demand match', bodyRegions: 'restriction/injury bodyRegions', activityPreferences: 'UserActivityProfile.prefs' })[g] || g;

const audit = RULES.map(r => {
  const spec = exampleSpec(r);
  const v = verified[r.code];
  const cat = (r.code.match(/AS-([A-Z]+)-/) || [])[1]?.toLowerCase();
  const evRefs = String(r.evidenceRef || '').split(';').map(s => s.trim()).filter(Boolean);
  const guidance = evRefs.map(ref => ({ ref, ...(GUIDANCE[ref] || { org: 'unmapped', note: 'evidence ref not in known-guidance map — reviewer must verify source.', tier: 'triage' }) }));
  const triggers = Object.entries(r.appliesTo || {}).flatMap(([g, toks]) => (toks || []).map(t => ({ group: g, token: t, channel: INPUT_CHANNEL(g) })));
  const flags = [];
  if (spec.isMirror) flags.push('structural-urgent-mirror: short-circuit precedes rule eval — by design; cannot appear in ruleIds');
  if (r.inputStatus === 'unsupported_input') flags.push('UNSUPPORTED_INPUT: no validated collection path — intentionally inactive');
  if ((r.appliesTo?.profileFlags || []).includes('__always__')) flags.push('always-fires info marker — verify it never escalates a decision');
  if ((r.appliesTo?.profileFlags || []).includes('__match_activity__')) flags.push('demand-intersection semantics — prevents unrelated-category over-restriction');
  if (JSON.stringify(r.appliesTo || {}).match(/\d/)) flags.push('threshold-bearing — numeric trigger needs specialist signoff vs guidance bands');
  const nonCanonical = (r.appliesTo?.symptoms || []).filter(t => !SYMPTOM_CODES.has(t) && SYMPTOM_ALIASES[t]);
  if (nonCanonical.length) flags.push(`non-canonical symptom tokens normalized via alias registry: ${nonCanonical.join(',')}`);
  const cof = (conf[r.code] || []).filter(c => c !== r.code);
  return {
    ruleId: r.code, name: r.name, category: cat, dimension: DIMENSION[cat] || 'unknown',
    purpose: r.reason, effect: r.effect, severity: r.severity,
    reviewStatus: 'DRAFT', inputStatus: r.inputStatus || 'supported',
    reachability: spec.isMirror ? 'intentional-mirror' : (r.inputStatus === 'unsupported_input' ? 'unsupported' : (spec.inertGroups.length ? 'INERT-BUG' : 'reachable')),
    executableExample: v ? { activityId: v.spec.activityId, decision: v.decision, fired: v.fired } : null,
    triggers, exclusions: r.exclusion || {}, requiredData: r.requiredData || [],
    missingDataBehavior: r.missingDataBehavior || 'conservative',
    coFiringRules: cof, guidance,
    falsePositiveRisk: r.effect === 'BLOCK_ACTIVITY' && triggers.length <= 2 ? 'broad-trigger block — check single-token sufficiency' : 'low',
    falseNegativeRisk: spec.inertGroups.length ? 'INERT — cannot fire' : (nonCanonical.length ? 'alias-resolved' : 'low'),
    reviewerTier: guidance.some(g => /physician|specialist/.test(g.tier)) ? 'physician/specialist' : 'qualified-exercise-professional',
    flags,
  };
});

const summary = {
  generatedAt: new Date().toISOString(), total: audit.length,
  reachable: audit.filter(a => a.reachability === 'reachable').length,
  mirrors: audit.filter(a => a.reachability === 'intentional-mirror').length,
  unsupported: audit.filter(a => a.reachability === 'unsupported').length,
  inertBug: audit.filter(a => a.reachability === 'INERT-BUG').length,
  physicianTier: audit.filter(a => a.reviewerTier === 'physician/specialist').length,
  unmappedEvidence: audit.filter(a => a.guidance.some(g => g.org === 'unmapped')).map(a => a.ruleId),
};

fs.writeFileSync(path.join(__dirname, '../docs/audits/activity-safety-rule-audit.json'), JSON.stringify({ summary, rules: audit }, null, 2));

let md = `# Rule-by-Rule Validation Audit (Phase 16.2)\n\nGenerated ${summary.generatedAt} — automated behavioral + evidence-linkage analysis only.\n**No entry below constitutes clinical approval. All ${summary.total} rules remain DRAFT.**\n\nSummary: ${summary.reachable} reachable · ${summary.mirrors} intentional URGENT mirrors · ${summary.unsupported} unsupported-input · ${summary.inertBug} inert-defects · ${summary.physicianTier} require physician/specialist tier.\n\n`;
for (const a of audit) {
  md += `## ${a.ruleId} — ${a.name}\n- dimension: ${a.dimension} · effect: ${a.effect} · severity: ${a.severity} · reachability: **${a.reachability}**\n`;
  if (a.executableExample) md += `- executable example: ${a.executableExample.activityId} → ${a.executableExample.decision} (fired: ${a.executableExample.fired})\n`;
  md += `- triggers: ${a.triggers.map(t => `\`${t.group}:${t.token}\``).join(' ') || 'none'}\n- input channel(s): ${[...new Set(a.triggers.map(t => t.channel))].join(' | ')}\n`;
  if (a.requiredData.length) md += `- requiredData (missing → conservative): ${a.requiredData.join(', ')}\n`;
  if (Object.keys(a.exclusions).length) md += `- exclusions: \`${JSON.stringify(a.exclusions)}\`\n`;
  if (a.coFiringRules.length) md += `- co-fires with: ${a.coFiringRules.join(', ')}\n`;
  md += `- evidence: ${a.guidance.map(g => `${g.ref} (${g.org})`).join(' · ') || 'NONE — flag'}\n`;
  for (const g of a.guidance) if (g.org !== 'unmapped') md += `  - ${g.org}: ${g.note} [tier: ${g.tier}]\n`;
  md += `- reviewer tier: ${a.reviewerTier} · missing-data: ${a.missingDataBehavior}\n`;
  if (a.flags.length) md += `- flags: ${a.flags.join(' | ')}\n`;
  md += `- purpose: ${a.purpose}\n\n`;
}
md += `## Machine-readable artifact\n\ndocs/audits/activity-safety-rule-audit.json — same data, consumable by the reviewer workflow.\n`;
fs.writeFileSync(path.join(__dirname, '../docs/audits/activity-safety-rule-by-rule-validation.md'), md);
console.log(`rule-validation: ${summary.total} rules → md+json · reachable ${summary.reachable} · mirrors ${summary.mirrors} · unsupported ${summary.unsupported} · inert-bugs ${summary.inertBug} · physician-tier ${summary.physicianTier} · unmapped-evidence ${summary.unmappedEvidence.length}`);
