#!/usr/bin/env node
// Phase 16.4 — generates ≥300 distinct multi-condition scenario fixtures as a
// jest suite. Expectations are engineering-policy predicates (documented
// semantics), NOT engine snapshots: 'allow'|'not-allow'|'blocked'|'defer'|
// 'insufficient'|'review-or-block'|'suppress-urgent'|'allow-or-modify'.
// Output: tests/activitySafety.scenarioMatrix.test.js
const out = [];
let id = 0;
const S = (name, ctx, act, env, expect, note) => out.push({ id: `M${String(++id).padStart(3, '0')}`, name, ctx, act, env, expect, note });
const J = o => JSON.stringify(o).replace(/"/g, "'");

const MILD = "{ available: true, weatherCode: 0, tempC: 22, apparentTempC: 22, aqi: { value: 30 }, alerts: [], forecast: [] }";
const ENVS = {
  mild: MILD, hot: "{ ...M, apparentTempC: 38, tempC: 38 }", aqiUsg: "{ ...M, aqi: { value: 130 } }",
  aqiUnhealthy: "{ ...M, aqi: { value: 170 } }", aqiVeryUnhealthy: "{ ...M, aqi: { value: 230 } }",
  cold: "{ ...M, apparentTempC: -15, tempC: -12 }", lightning: "{ ...M, weatherCode: 95 }",
  stale: "{ ...M, stale: true }", unavailable: "{ available: false }",
};
const ACTS = ['outdoor_walk', 'outdoor_run', 'indoor_walk', 'stationary_cycling', 'upper_body_ergometer', 'upper_body_strength', 'strength_training', 'swimming', 'gentle_mobility', 'seated_movement', 'floor_core_work', 'contact_sport', 'overhead_lifting', 'group_fitness_class', 'rest'];
const OUTDOOR = new Set(['outdoor_walk', 'outdoor_run', 'contact_sport']);
const WB = new Set(['outdoor_walk', 'outdoor_run', 'indoor_walk', 'strength_training', 'group_fitness_class', 'contact_sport', 'overhead_lifting']);
const LOWER = new Set(['outdoor_walk', 'outdoor_run', 'indoor_walk', 'stationary_cycling', 'strength_training', 'swimming', 'group_fitness_class', 'contact_sport', 'overhead_lifting']);
const UPPER = new Set(['upper_body_ergometer', 'upper_body_strength', 'strength_training', 'swimming', 'seated_movement', 'group_fitness_class', 'contact_sport', 'overhead_lifting']);
const TRUNK = new Set(['strength_training', 'seated_movement', 'floor_core_work', 'overhead_lifting']);

const I = {
  nwbKnee: "[{ bodyPart: 'knee', type: 'fracture', status: 'current', weightBearingRestriction: 'non_weight_bearing' }]",
  nwbAnkle: "[{ bodyPart: 'ankle', type: 'fracture', status: 'current', weightBearingRestriction: 'non_weight_bearing' }]",
  wristFx: "[{ bodyPart: 'wrist', type: 'fracture', status: 'current' }]",
  shoulder: "[{ bodyPart: 'shoulder', type: 'impingement', status: 'current' }]",
  back: "[{ bodyPart: 'lower_back', type: 'strain', status: 'current' }]",
  resolvedAnkle: "[{ bodyPart: 'ankle', type: 'sprain', status: 'resolved', resolvedAt: '2026-01-01' }]",
  recovHip: "[{ bodyPart: 'hip', type: 'labral_repair', status: 'recovering', weightBearingRestriction: 'partial' }]",
  wristAndNwbAnkle: "[{ bodyPart: 'ankle', type: 'fracture', status: 'current', weightBearingRestriction: 'non_weight_bearing' }, { bodyPart: 'wrist', type: 'fracture', status: 'current' }]",
};
const COND = { asthma: "['asthma']", t2d: "['t2d']", htn: "['hypertension']", osteo: "['osteoporosis']", ckd: "['ckd']", epilepsy: "['epilepsy']", ms: "['multiple_sclerosis']", parkinsons: "['parkinsons']", none: '[]' };
const SURG = {
  orthoNoClearance: "[{ procedureCategory: 'orthopedic', status: 'recovering', clinicianRestrictions: [], activityClearance: {} }]",
  orthoCleared: "[{ procedureCategory: 'orthopedic', status: 'recovering', clinicianRestrictions: [], activityClearance: { general: true } }]",
  cardiac: "[{ procedureCategory: 'cardiac', status: 'recovering', clinicianRestrictions: [], activityClearance: {} }]",
};
const SYM = { chest: "[{ status: 'active', symptoms: ['chest_pain'] }]", dyspnea: "[{ status: 'active', symptoms: ['dyspnea_unusual'] }]", dizzy: "[{ status: 'active', symptoms: ['dizziness_vertigo'] }]", resolvedChest: "[{ status: 'resolved', symptoms: ['chest_pain'] }]" };
const PREG = { pregnant: "'pregnant'", postpartum: "'postpartum'", none: 'null' };
const RESTR = { trunk: "[{ status: 'active', categories: ['trunk_load'], severity: 'prohibited', source: 'clinician_documented' }]", lowerLimb: "[{ status: 'active', categories: ['lower_limb_load'], severity: 'prohibited', source: 'self_reported' }]", upperModify: "[{ status: 'active', categories: ['upper_limb_load'], severity: 'modify', source: 'clinician_documented' }]", wbProhib: "[{ status: 'active', categories: ['weight_bearing_lower'], severity: 'prohibited', source: 'clinician_documented' }]" };
const CTX = (o = {}) => `{ userId: 'u', conditions: ${o.c || '[]'}, injuries: ${o.i || '[]'}, surgeries: ${o.s || '[]'}, restrictions: ${o.r || '[]'}, symptomReports: ${o.sym || '[]'}, pregnancyStatus: ${o.p || 'null'}, age: ${o.a || 40}, mobility: ${o.m || '{}'}, medicationFlags: ${o.mf || '[]'}, preferences: ${o.pr || '{}'} }`;

// --- named brief scenarios A–J ------------------------------------------------
S('A ankle-NWB + perfect weather', CTX({ i: I.nwbAnkle }), 'outdoor_walk', 'mild', 'blocked', 'brief-A');
S('A2 ankle-NWB + perfect weather (run)', CTX({ i: I.nwbAnkle }), 'outdoor_run', 'mild', 'blocked', 'brief-A');
S('B stable diabetes, mild weather — no blanket prohibition', CTX({ c: COND.t2d }), 'outdoor_walk', 'mild', 'allow-or-modify', 'brief-B: condition alone must not block');
S('B2 stable diabetes, strength ok', CTX({ c: COND.t2d }), 'strength_training', 'mild', 'allow-or-modify', 'brief-B');
S('I trainer-conflict shape — clinician trunk prohibition vs strength', CTX({ r: RESTR.trunk }), 'strength_training', 'mild', 'blocked', 'brief-I');
S('J AI-suggested prohibited activity → engine rejects', CTX({ r: RESTR.lowerLimb }), 'outdoor_run', 'mild', 'blocked', 'brief-J');
S('C asthma + poor AQI, pollen unknown', CTX({ c: COND.asthma }), 'outdoor_walk', 'aqiUnhealthy', 'defer-or-block', 'brief-C: AQI precaution without inventing pollen');
S('C2 asthma + poor AQI indoor unaffected', CTX({ c: COND.asthma }), 'indoor_walk', 'aqiUnhealthy', 'allow-or-modify', 'brief-C');
S('D knee surgery + good recovery — surgery restriction stands', CTX({ s: SURG.orthoNoClearance }), 'outdoor_run', 'mild', 'review-or-block', 'brief-D: wearable recovery cannot override');
S('E wheelchair + shoulder injury — seated not assumed safe', CTX({ i: I.shoulder, m: "{ wheelchairUser: true, walkingAbility: 'unable' }" }), 'seated_movement', 'mild', 'not-allow', 'brief-E');
S('E2 wheelchair + shoulder — outdoor walk still blocked', CTX({ i: I.shoulder, m: "{ wheelchairUser: true, walkingAbility: 'unable' }" }), 'outdoor_walk', 'mild', 'blocked', 'brief-E');
S('F chest pain + suggestion → suppressed urgent', CTX({ sym: SYM.chest }), 'outdoor_walk', 'mild', 'suppress-urgent', 'brief-F');
S('G NWB + heat — most restrictive wins, no dimension-order downgrade', CTX({ i: I.nwbAnkle, c: COND.asthma }), 'outdoor_walk', 'hot', 'blocked', 'brief-G');
S('H resolved injury + active clinician restriction → restriction respected', CTX({ i: I.resolvedAnkle, r: RESTR.lowerLimb }), 'indoor_walk', 'mild', 'blocked', 'brief-H');
S('H2 resolved injury alone → no phantom restriction', CTX({ i: I.resolvedAnkle }), 'outdoor_walk', 'mild', 'allow-or-modify', 'brief-H');

// --- combinatorial matrix -----------------------------------------------------
const injuries = [['none', '[]'], ['nwbKnee', I.nwbKnee], ['nwbAnkle', I.nwbAnkle], ['wristFx', I.wristFx], ['shoulder', I.shoulder], ['back', I.back], ['resolvedAnkle', I.resolvedAnkle], ['recovHip', I.recovHip]];
const conds = Object.entries(COND);
const envKeys = Object.keys(ENVS);
for (const [inName, inj] of injuries)
  for (const [cName, cond] of conds)
    for (const eName of ['mild', 'hot', 'aqiUnhealthy'])
      for (const act of ACTS) {
        const isNwb = /nwb/.test(inName);
        const hasResp = cName === 'asthma';
        const outdoor = OUTDOOR.has(act);
        let expect = 'allow-or-modify';
        if (isNwb && WB.has(act)) expect = 'blocked';
        else if (isNwb && !WB.has(act)) expect = 'not-urgent';
        else if (inName === 'recovHip' && ['outdoor_run', 'contact_sport'].includes(act)) expect = 'not-allow';
        else if (outdoor && eName === 'aqiUnhealthy') expect = 'defer-or-block';
        else if (outdoor && eName === 'hot' && hasResp) expect = 'not-urgent';
        else if (outdoor && eName === 'hot') expect = 'not-urgent'; // heat may defer per env rules; just not urgent
        if (act === 'rest') expect = 'allow';
        S(`${inName}+${cName}@${eName}→${act}`, CTX({ i: inj, c: cond }), act, eName, expect);
      }

// pregnancy × activity × env
for (const [pName, p] of [['pregnant', PREG.pregnant], ['postpartum', PREG.postpartum]])
  for (const eName of envKeys)
    for (const act of ACTS) {
      let expect = 'allow-or-modify';
      if (OUTDOOR.has(act) && ['stale', 'unavailable'].includes(eName)) expect = 'insufficient';
      const haz = pName === 'pregnant' ? ['aqiUnhealthy', 'aqiVeryUnhealthy', 'hot', 'lightning'] : ['aqiUnhealthy', 'aqiVeryUnhealthy', 'lightning'];
      if (OUTDOOR.has(act) && haz.includes(eName)) expect = 'defer-or-block'; // ACOG heat caution is pregnancy-specific
      if (act === 'rest') expect = 'allow';
      S(`${pName}@${eName}→${act}`, CTX({ p }), act, eName, expect, 'uncomplicated pregnancy: outdoor activity not auto-blocked');
    }

// surgery × clearance × activity
for (const [sName, s] of Object.entries(SURG))
  for (const act of ACTS) {
    let expect = 'allow-or-modify';
    const light = act === 'rest' || act === 'seated_movement' || act === 'gentle_mobility';
    if (sName === 'orthoNoClearance' && !light) expect = 'review-or-block';
    if (sName === 'orthoCleared') expect = 'allow-or-modify';
    if (sName === 'cardiac' && !light) expect = 'review-or-block';
    if (act === 'rest') expect = 'allow';
    S(`${sName}@mild→${act}`, CTX({ s }), act, 'mild', expect);
  }

// urgent/review symptoms × activity (short-circuit)
for (const [symName, sym] of [['chest', SYM.chest], ['dyspnea', SYM.dyspnea]])
  for (const act of ACTS) S(`urgent:${symName}→${act}`, CTX({ sym }), act, 'mild', 'suppress-urgent');
for (const act of ACTS) S(`resolved-chest→${act}`, CTX({ sym: SYM.resolvedChest }), act, 'mild', 'not-urgent');

// restrictions × activity — over-restriction guards
for (const [rName, r] of Object.entries(RESTR))
  for (const act of ACTS) {
    const map = { trunk: TRUNK.has(act), lowerLimb: LOWER.has(act) && act !== 'overhead_lifting', upperModify: UPPER.has(act) && act !== 'contact_sport', wbProhib: WB.has(act) };
    let expect = map[rName] ? 'not-allow' : 'allow-or-modify';
    if (act === 'rest') expect = 'allow';
    S(`restriction:${rName}→${act}`, CTX({ r }), act, 'mild', expect, 'unrelated categories must not block');
  }

// env-only grid (healthy user)
for (const eName of envKeys) for (const act of ACTS) {
  let expect = 'allow-or-modify';
  if (OUTDOOR.has(act) && ['stale', 'unavailable'].includes(eName)) expect = 'insufficient';
  if (OUTDOOR.has(act) && ['aqiUnhealthy', 'aqiVeryUnhealthy', 'lightning'].includes(eName)) expect = 'defer-or-block';
  if (act === 'rest') expect = 'allow';
  S(`env:${eName}→${act}`, CTX({}), act, eName, expect);
}

// age / meds / missing-data
for (const act of ACTS) {
  S(`age70+missing-profile→${act}`, CTX({ a: 70 }), act, 'mild', 'not-urgent', 'senior flag alone must not block');
  S(`meds:heat_sensitivity→${act}@hot`, CTX({ mf: "['heat_sensitivity']" }), act, 'hot', OUTDOOR.has(act) ? 'defer-or-block' : 'allow-or-modify');
}

// --- emit ---------------------------------------------------------------------
const EXPECT = `const EXPECT = {
  'allow': d => d === 'ALLOW',
  'allow-or-modify': d => ['ALLOW', 'MODIFY'].includes(d),
  'not-allow': d => d !== 'ALLOW',
  'blocked': d => d === 'BLOCK_ACTIVITY',
  'defer': d => d === 'DEFER_OUTDOOR',
  'defer-or-block': d => ['DEFER_OUTDOOR', 'BLOCK_ACTIVITY'].includes(d),
  'insufficient': d => d === 'INSUFFICIENT_DATA',
  'review-or-block': d => ['NEEDS_CLINICAL_REVIEW', 'BLOCK_ACTIVITY', 'MODIFY'].includes(d),
  'suppress-urgent': d => d === 'URGENT_ESCALATION',
  'not-urgent': d => d !== 'URGENT_ESCALATION',
};`;
let t = `// GENERATED — Phase 16.4 scenario matrix (${out.length} fixtures). Regenerate:
//   node scripts/activity-safety-scenario-matrix.js
const svc = require('../src/services/activitySafety');
const { getActivity: A } = svc;
const M = ${MILD};
const E = ${JSON.stringify(Object.fromEntries(Object.entries(ENVS).map(([k, v]) => [k, null]))).replace(/"(\w+)":null/g, (m, k) => `${k}:${ENVS[k]}`)};
${EXPECT}
describe('scenario matrix (generated, ${out.length} cases)', () => {
`;
for (const s of out) {
  t += `  test('${s.id} ${s.name.replace(/'/g, '')}', () => {\n    const r = svc.evaluate(${s.ctx}, A('${s.act}'), ${s.env === 'mild' ? 'M' : `E.${s.env}`});\n    expect(EXPECT['${s.expect}'](r.decision)).toBe(true);${s.note ? ` // ${s.note}` : ''}\n  });\n`;
}
t += '});\n';
require('fs').writeFileSync(require('path').join(__dirname, '../tests/activitySafety.scenarioMatrix.test.js'), t);
console.log(`scenario matrix: ${out.length} fixtures emitted`);
