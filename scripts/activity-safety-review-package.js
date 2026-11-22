#!/usr/bin/env node
// Generates the clinical review package for the activity-safety rule set.
//   node scripts/activity-safety-review-package.js
// Writes:
//   docs/clinical/activity-safety-review-package.md   — per-rule review sheet
//   tests/activitySafety.reviewPackage.test.js        — executable examples
//
// Everything in the package is generated FROM THE CODE — if a rule cannot
// fire as encoded, the package says so instead of describing intent.

const { RULES } = require('../src/services/activitySafety/rulesData');
const { ACTIVITIES } = require('../src/services/activitySafety/activityCatalog');
const { CONDITION_KEYS, SYMPTOMS_URGENT, SYMPTOMS_REVIEW, DECISION_RANK, DECISIONS } = require('../src/services/activitySafety/constants');
const { evaluateActivity } = require('../src/services/activitySafety/engine');
const { buildFlags } = require('../src/services/activitySafety/engine');

// profileFlags the engine derives via buildFlags: condition keys + fixed set.
// medicationActivityFlags is free-form — health-state tokens can arrive through
// it, but only via an unvalidated user-entered channel. Runtime/state tokens
// (env_unknown, rest_day, wb_non_weight_bearing, …) are not health states and
// cannot legitimately arrive at all → unreachable.
const DERIVED_FLAGS = new Set(['pregnancy', 'age_65_plus', 'wheelchair', 'med_flags', ...Object.values(CONDITION_KEYS)]);
// Health states plausibly carried by the free-form medicationActivityFlags array.
const MED_PLAUSIBLE = new Set(['heat_sensitivity', 'fluid_restriction', 'hypoglycemia_risk', 'recent_hypoglycemia',
  'hyperglycemia_ketones', 'hypertension_uncontrolled', 'joint_instability', 'frailty', 'fall_risk',
  'pregnancy_high_risk', 'postpartum']);
const NEVER_PRODUCED_ENV = new Set(['smoke', 'aqi_very_unhealthy']);
const WILDCARDS = new Set(['__any__', '__always__']);

const catToActivities = {};
for (const [id, a] of Object.entries(ACTIVITIES)) {
  for (const c of a.demands.categories) (catToActivities[c] = catToActivities[c] || []).push(id);
}
const ALL_ACTIVITY_IDS = Object.keys(ACTIVITIES);

const ENV_FOR_HAZARD = {
  thunderstorm: { tempC: 20, apparentTempC: 20, weatherCode: 95, precipitationMm: 1 },
  severe_alert: { tempC: 20, apparentTempC: 20, alerts: [{ event: 'Tornado Warning', severity: 'Extreme' }] },
  heat_danger: { tempC: 41, apparentTempC: 41 },
  heat_sensitive_danger: { tempC: 36, apparentTempC: 36 },
  heat_extreme_caution: { tempC: 33, apparentTempC: 33 },
  heat_caution: { tempC: 29, apparentTempC: 29 },
  cold_danger: { tempC: -20, apparentTempC: -20 },
  cold_caution: { tempC: -10, apparentTempC: -10, windSpeedKmh: 25 },
  aqi_hazardous: { tempC: 20, apparentTempC: 20, aqi: { value: 250 } },
  aqi_unhealthy: { tempC: 20, apparentTempC: 20, aqi: { value: 180 } },
  aqi_usg: { tempC: 20, apparentTempC: 20, aqi: { value: 120 } },
  uv_extreme: { tempC: 20, apparentTempC: 20, uvIndex: 9 },
  high_wind: { tempC: 20, apparentTempC: 20, windGustsKmh: 60 },
  heavy_precip: { tempC: 20, apparentTempC: 20, precipitationMm: 8 },
};
const SENSITIVE_HAZARDS = { aqi_usg: ['asthma'], heat_sensitive_danger: ['diabetes_t2'], heat_caution: ['diabetes_t2'] };
const MILD_ENV = { tempC: 20, apparentTempC: 20, aqi: { value: 30 }, uvIndex: 2 };

// 'derived' | 'med-flag' | 'inert' — can the token be produced by any input path?
function tokenStatus(group, token) {
  if (WILDCARDS.has(token)) return 'inert';
  switch (group) {
    case 'symptomCodes':
      return (SYMPTOMS_URGENT.has(token) || SYMPTOMS_REVIEW.has(token)) ? 'derived' : 'inert';
    case 'injuryTypes': case 'bodyParts': case 'restrictionCategories': case 'conditionKeys':
      return 'derived';
    case 'activityCategories': return catToActivities[token] ? 'derived' : 'inert';
    case 'envHazards': return NEVER_PRODUCED_ENV.has(token) ? 'inert' : 'derived';
    case 'profileFlags': return DERIVED_FLAGS.has(token) ? 'derived' : MED_PLAUSIBLE.has(token) ? 'med-flag' : 'inert';
    default: return 'inert';
  }
}

function reachNote(group, token) {
  const s = tokenStatus(group, token);
  const notes = {
    symptomCodes: s === 'inert' ? `**inert** — "${token}" is not a canonical symptom code (vocab mismatch)` : 'active UserSymptomReport',
    injuryTypes: 'unresolved UserInjury.type', bodyParts: 'unresolved UserInjury.bodyPart',
    restrictionCategories: s === 'inert' ? `**inert** — wildcard semantics not implemented (literal "${token}" never present)` : 'UserActivityRestriction.categories',
    conditionKeys: 'active UserHealthCondition → CONDITION_KEYS',
    activityCategories: s === 'inert' ? '**inert** — no catalog activity carries this category' : `carried by: ${(catToActivities[token] || []).join(', ')}`,
    envHazards: s === 'inert' ? '**inert** — never emitted by detectHazards' : 'produced by detectHazards',
    profileFlags: s === 'derived' ? 'derived by buildFlags'
      : s === 'med-flag' ? '**user-report channel** — reachable via free-form medicationActivityFlags; reviewer decides whether this unvalidated channel is acceptable'
      : '**inert** — no production path emits this token',
  };
  return `\`${token}\` — ${notes[group] || 'unrecognized group'}`;
}

// Build a concrete trigger for each required group; null ⇒ group unsatisfiable.
function triggerFor(group, tokens) {
  const usable = tokens.filter(t => tokenStatus(group, t) !== 'inert');
  if (!usable.length) return null;
  const pick = usable[0];
  switch (group) {
    case 'symptomCodes':
      return { ctx: { symptomReports: [{ status: 'active', symptoms: [pick] }] }, used: pick };
    case 'conditionKeys': return { ctx: { conditionKeys: [pick] }, used: pick };
    case 'bodyParts': return { ctx: { injuries: [{ status: 'current', bodyPart: pick, type: 'sprain' }] }, used: pick };
    case 'injuryTypes': return { ctx: { injuries: [{ status: 'current', bodyPart: 'knee', type: pick }] }, used: pick };
    case 'restrictionCategories': return { ctx: { restrictions: [{ status: 'active', categories: [pick], bodyRegions: [], severity: 'prohibited', source: 'clinician_documented' }] }, used: pick };
    case 'profileFlags': return { ctx: { flags: [pick] }, used: pick };
    case 'envHazards': {
      const env = ENV_FOR_HAZARD[pick];
      const extra = (SENSITIVE_HAZARDS[pick] || []).map(k => k);
      return { ctx: extra.length ? { conditionKeys: extra } : {}, env, used: pick };
    }
    default: return null;
  }
}

function mergeCtx(base, add) {
  for (const [k, v] of Object.entries(add || {})) {
    base[k] = Array.isArray(base[k]) && Array.isArray(v) ? [...base[k], ...v] : v;
  }
  return base;
}

function exampleSpec(rule) {
  const a = rule.appliesTo || {};
  const groups = Object.entries(a).filter(([g, v]) => g !== 'activityCategories' && Array.isArray(v) && v.length);
  const ctx = {}; let env = null; const inertGroups = []; const flags = [];
  let activityId = 'seated_movement';

  // activity choice: first covered category; env rules need outdoor exposure.
  const catTokens = a.activityCategories || [];
  const envRule = !!a.envHazards?.length;
  for (const c of catTokens) if (catToActivities[c]?.length) { activityId = catToActivities[c][0]; break; }
  if (envRule && !catTokens.length) activityId = 'outdoor_walk';
  if (catTokens.length && !catTokens.some(c => catToActivities[c])) {
    inertGroups.push('activityCategories (no catalog coverage)');
  }

  for (const [group, tokens] of groups) {
    // prefer a non-urgent symptom token so the rule (not the short-circuit) fires
    const ordered = group === 'symptomCodes'
      ? [...tokens].sort((x, y) => (SYMPTOMS_URGENT.has(x) ? 1 : 0) - (SYMPTOMS_URGENT.has(y) ? 1 : 0))
      : tokens;
    const t = triggerFor(group, ordered);
    if (!t) { inertGroups.push(group); continue; }
    mergeCtx(ctx, t.ctx);
    if (t.ctx?.flags) flags.push(...t.ctx.flags);
    if (t.env) env = t.env;
  }
  const isOutdoor = ACTIVITIES[activityId].demands.categories.includes('outdoor_exposed');
  if (isOutdoor && !env) env = MILD_ENV; // else INSUFFICIENT_DATA masks the decision

  const fired = (ctx.symptomReports || []).flatMap(s => s.symptoms);
  const isMirror = fired.some(s => SYMPTOMS_URGENT.has(s));
  return { ctx, flags, env, activityId, inertGroups, isMirror };
}

function conflicts(rules) {
  const domains = ['symptomCodes', 'conditionKeys', 'profileFlags', 'envHazards', 'restrictionCategories', 'injuryTypes', 'bodyParts'];
  const out = {};
  for (const r of rules) out[r.code] = [];
  for (let i = 0; i < rules.length; i++) for (let j = i + 1; j < rules.length; j++) {
    const A = rules[i], B = rules[j];
    const shared = [];
    for (const g of domains) {
      const av = new Set(A.appliesTo?.[g] || []), bv = new Set(B.appliesTo?.[g] || []);
      for (const t of av) if (bv.has(t)) shared.push(`${g}:${t}`);
    }
    if (!shared.length) continue;
    const ac = new Set(A.appliesTo?.activityCategories || []), bc = new Set(B.appliesTo?.activityCategories || []);
    if (!(!ac.size || !bc.size || [...ac].some(c => bc.has(c)))) continue;
    out[A.code].push({ other: B.code, shared });
    out[B.code].push({ other: A.code, shared });
  }
  return out;
}
const conf = conflicts(RULES);

// sanity-verify each spec against the live engine before emitting
const verified = {};
for (const r of RULES) {
  const spec = exampleSpec(r);
  const res = evaluateActivity({
    context: { conditions: [], injuries: [], surgeries: [], restrictions: [], symptomReports: [], mobility: {}, preferences: {}, ...spec.ctx, flags: new Set(spec.flags) },
    activity: ACTIVITIES[spec.activityId], env: spec.env,
    rules: [{ ...r, ruleCode: r.code }],
  });
  verified[r.code] = { fired: res.ruleIds.includes(r.code), decision: res.decision, spec };
}

let md = `# Activity Safety — Clinical Review Package (auto-generated)

**Generated by** \`scripts/activity-safety-review-package.js\` from \`src/services/activitySafety/rulesData.js\` — regenerate after any rule change so the package always describes the code as shipped, never intent.

**Status: every rule is \`reviewStatus: DRAFT\` and inert for real users.** Nothing in this document is approval. A qualified reviewer must sign off per rule before APPROVED; the DB CHECK constraint requires \`reviewedBy\`/\`reviewedAt\`/\`evidenceSourceId\` with APPROVED. Executable examples demonstrate *implemented behavior* only — they cannot demonstrate clinical correctness.

## Reachability vocabulary

- **reachable** — a documented production input produces this token.
- **med-flag-only** — reachable only via free-form \`medicationActivityFlags\` (unvalidated user-entered strings). The reviewer must decide whether that channel is acceptable or a validated derivation path is required.
- **inert** — no production path emits this token; the rule is inert as encoded. Structural engine mechanics may still cover the intent (noted per rule).

## Engine-level findings the reviewer must see

- **Urgent-symptom short-circuit:** \`evalMedical\` returns before rule evaluation whenever an urgent symptom code is active. Rules whose only triggers are urgent codes (${RULES.filter(r => { const s = exampleSpec(r); return s.isMirror && !s.inertGroups.length; }).map(r => r.code).join(', ') || 'none'}) can never appear in \`ruleIds\` — they are audit mirrors of the always-on structural path, which is correct by design (urgent handling must not depend on rule review status).
- **Symptom-code vocabulary mismatches** are flagged per rule as *inert* tokens (e.g. \`severe_dyspnea\` vs canonical \`dyspnea_unusual\`). The mobile/API vocabulary is authoritative — either fix the rule tokens or map aliases.
- **Wildcard tokens** (\`__any__\`, \`__always__\`) match literally — no wildcard semantics exist; rules relying on them cannot fire.
- **Uncovered categories** (\`contact_fall_risk\`, \`supine_prolonged\`, \`overhead\`) have no catalog activity — rules constrained to them cannot fire on today's catalog.

## Rule index

| # | Code | Name | Category | Effect | Severity | Class | Evidence | Fires as encoded |
|---|------|------|----------|--------|----------|-------|----------|------------------|
`;
RULES.forEach((r, i) => {
  const v = verified[r.code];
  const fires = v.spec.isMirror ? 'structural mirror' : v.fired ? 'yes' : (v.spec.inertGroups.length ? '**no — inert**' : '**no — investigate**');
  md += `| ${i + 1} | ${r.code} | ${r.name} | ${r.category} | ${r.effect} | ${r.severity} | ${r.evidenceClass} | ${r.evidenceRef} | ${fires} |\n`;
});
md += `\n---\n\n`;

for (const r of RULES) {
  const spec = verified[r.code].spec;
  const affected = (r.appliesTo?.activityCategories || []).length
    ? [...new Set((r.appliesTo.activityCategories).flatMap(c => catToActivities[c] || []))]
    : ALL_ACTIVITY_IDS;
  md += `## ${r.code} — ${r.name}\n\n`;
  md += `- **Effect:** ${r.effect} · **Severity:** ${r.severity} · **Class:** ${r.evidenceClass} · **Evidence:** ${r.evidenceRef}\n`;
  md += `- **Reason string (review wording):** "${r.reason}"\n`;
  if (r.requiredData?.length) md += `- **Required data when triggered:** ${r.requiredData.join(', ')}\n`;
  md += `- **Trigger (encoded — AND across groups / OR within):**\n`;
  for (const [group, tokens] of Object.entries(r.appliesTo || {})) {
    if (!Array.isArray(tokens) || !tokens.length) continue;
    md += `  - **${group}:**\n`;
    for (const t of tokens) md += `    - ${reachNote(group, t)}\n`;
  }
  md += `- **Affected catalog activities:** ${affected.length === ALL_ACTIVITY_IDS.length ? 'all (no activityCategories constraint)' : affected.join(', ') || 'none'}\n`;
  if (conf[r.code].length) {
    md += `- **Can co-fire with (decision rank resolves):**\n`;
    for (const c of conf[r.code]) md += `  - ${c.other} — shared: ${c.shared.join(', ')}\n`;
  } else md += `- **Can co-fire with:** none detected\n`;
  md += `- **Uncertainty / missing-data:** unknown never counts as favorable. ${r.evidenceClass === 'UH' ? 'Class UH — encoded hypothesis needing explicit reviewer validation.' : ''}${r.evidenceClass === 'PD' ? 'Class PD — product default, not a clinical standard.' : ''}\n`;
  if (spec.isMirror) {
    md += `- **Encoding note:** urgent-symptom short-circuit precedes rule evaluation — this rule is an audit mirror of the always-on structural path; it cannot appear in ruleIds.\n`;
  } else if (spec.inertGroups.length) {
    md += `- **⚠ Inert as encoded:** group(s) with no satisfiable token: ${spec.inertGroups.join(', ')}. Fix encoding or document reliance on structural coverage.\n`;
  }
  md += `- **Executable example** (generated test): activity=\`${spec.activityId}\` ctx=${JSON.stringify({ ...spec.ctx, flags: spec.flags.length ? spec.flags : undefined })} env=${JSON.stringify(spec.env)} → verified: ${verified[r.code].fired ? `fires, merged decision \`${verified[r.code].decision}\`` : spec.isMirror ? `structural path → \`${verified[r.code].decision}\` (rule not in ruleIds by design)` : 'does not fire' }.\n\n`;
}
require('fs').writeFileSync(require('path').join(__dirname, '../docs/clinical/activity-safety-review-package.md'), md);

// ---- executable examples -------------------------------------------------------
let test = `// AUTO-GENERATED by scripts/activity-safety-review-package.js — do not edit.
// Executable examples for the clinical review package. Passing tests prove
// implemented behavior only — NOT clinical approval. All rules are DRAFT.
const { ACTIVITIES } = require('../src/services/activitySafety/activityCatalog');
const { RULES } = require('../src/services/activitySafety/rulesData');
const { evaluateActivity } = require('../src/services/activitySafety/engine');
const H = () => ({ conditions: [], injuries: [], surgeries: [], restrictions: [], symptomReports: [], mobility: {}, preferences: {} });
const row = (code) => { const r = RULES.find(x => x.code === code); return { ...r, ruleCode: r.code, reviewStatus: 'DRAFT' }; };
const run = (code, ctx, activityId, env) => evaluateActivity({ context: { ...H(), ...ctx, flags: new Set(ctx.flags || []) }, activity: ACTIVITIES[activityId], env, rules: [row(code)] });
describe('review package — executable examples (all rules DRAFT)', () => {
`;
for (const r of RULES) {
  const spec = verified[r.code].spec;
  const ctxJson = JSON.stringify({ ...spec.ctx, flags: spec.flags });
  test += `  test('${r.code} ${r.name.replace(/'/g, "\\'")}', () => {\n`;
  test += `    const res = run('${r.code}', ${ctxJson}, '${spec.activityId}', ${JSON.stringify(spec.env)});\n`;
  if (spec.isMirror) {
    test += `    expect(res.decision).toBe('URGENT_ESCALATION'); // structural urgent path\n    expect(res.ruleIds).not.toContain('${r.code}'); // mirror — short-circuit precedes rules\n`;
  } else if (spec.inertGroups.length) {
    test += `    expect(res.ruleIds).not.toContain('${r.code}'); // inert as encoded — ${spec.inertGroups.join('; ')}\n`;
  } else {
    test += `    expect(res.ruleIds).toContain('${r.code}');\n    expect(res.decision).toBe('${verified[r.code].decision}');\n`;
  }
  test += `  });\n`;
}
test += `});\n`;
require('fs').writeFileSync(require('path').join(__dirname, '../tests/activitySafety.reviewPackage.test.js'), test);
const inert = RULES.filter(r => exampleSpec(r).inertGroups.length).map(r => r.code);
const mirror = RULES.filter(r => exampleSpec(r).isMirror).map(r => r.code);
console.log(`package: ${RULES.length} rules · mirrors: ${mirror.join(',') || 'none'} · inert: ${inert.join(',') || 'none'}`);
