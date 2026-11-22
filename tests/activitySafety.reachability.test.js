// Reachability repair suite — Phase 15 P1.
// Positive AND negative execution per repaired trigger, coexistence, and
// missing-data honesty. Examples use real input paths only (buildFlags
// derives flags — callers never inject derived tokens as truth).
const { evaluateActivity, buildFlags, normalizeContext } = require('../src/services/activitySafety/engine');
const { ACTIVITIES } = require('../src/services/activitySafety/activityCatalog');
const { RULES } = require('../src/services/activitySafety/rulesData');

const H = () => ({ conditions: [], injuries: [], surgeries: [], restrictions: [], symptomReports: [], mobility: {}, preferences: {}, profilePresent: true });
const row = (code) => { const r = RULES.find(x => x.code === code); return { ...r, ruleCode: r.code, reviewStatus: 'DRAFT' }; };
const evalAt = (ctx, activityId, env, rules) => evaluateActivity({ context: { ...H(), ...ctx }, activity: ACTIVITIES[activityId], env, rules: rules.map(row) });
// Registry-fired rule codes only (dimensions.medical) — top-level ruleIds also
// carries structural tags from evalFunctional (e.g. 'AS-MSK-002' on any current
// injury), which must not be mistaken for a registry match.
const registryIds = (res) => res.dimensions.medical.ruleIds;
const flagsOf = (ctx) => [...buildFlags(normalizeContext({ ...H(), ...ctx }), new Date())];
const MILD = { tempC: 20, apparentTempC: 20, aqi: { value: 30 }, uvIndex: 2 };
const DAY_MS = 86400 * 1000;

describe('symptom aliases — canonical registry', () => {
  test('legacy code numbness → numbness_neuro → URGENT', () => {
    const res = evalAt({ symptomReports: [{ status: 'active', symptoms: ['numbness'] }] }, 'indoor_walk', null, []);
    expect(res.decision).toBe('URGENT_ESCALATION');
  });
  test('legacy severe_headache → severe_headache_sudden → URGENT', () => {
    const res = evalAt({ symptomReports: [{ status: 'active', symptoms: ['severe_headache'] }] }, 'seated_movement', null, []);
    expect(res.decision).toBe('URGENT_ESCALATION');
  });
  test('severe_dyspnea alias escalates identically to dyspnea_unusual', () => {
    for (const code of ['severe_dyspnea', 'dyspnea_unusual']) {
      expect(evalAt({ symptomReports: [{ status: 'active', symptoms: [code] }] }, 'indoor_walk', null, []).decision).toBe('URGENT_ESCALATION');
    }
  });
  test('muscle_soreness_doms is informational — fires DOMS rule, never urgent', () => {
    const res = evalAt({ symptomReports: [{ status: 'active', symptoms: ['muscle_soreness_doms'] }] }, 'indoor_walk', null, ['AS-MSK-006']);
    expect(res.ruleIds).toContain('AS-MSK-006');
    expect(res.decision).toBe('MODIFY');
  });
  test('systemic_illness fires AS-SYS-003; resolved report does not', () => {
    const on = evalAt({ symptomReports: [{ status: 'active', symptoms: ['systemic_illness'] }] }, 'indoor_walk', null, ['AS-SYS-003']);
    expect(on.ruleIds).toContain('AS-SYS-003');
    const off = evalAt({ symptomReports: [{ status: 'resolved', symptoms: ['systemic_illness'] }] }, 'indoor_walk', null, ['AS-SYS-003']);
    expect(off.ruleIds).not.toContain('AS-SYS-003');
  });
});

describe('injury-derived profile flags', () => {
  test('wb_non_weight_bearing fires AS-MSK-001 on weight-bearing, not seated', () => {
    const ctx = { injuries: [{ status: 'current', type: 'fracture', bodyPart: 'ankle', weightBearingRestriction: 'non_weight_bearing' }] };
    const wb = evalAt(ctx, 'outdoor_walk', MILD, ['AS-MSK-001']);
    expect(wb.ruleIds).toContain('AS-MSK-001');
    const seated = evalAt(ctx, 'seated_movement', null, ['AS-MSK-001']);
    expect(seated.ruleIds).not.toContain('AS-MSK-001'); // no weight_bearing_lower demand
  });
  test('acute_injury_72h flag exists only inside the window', () => {
    expect(flagsOf({ injuries: [{ status: 'current', type: 'sprain', bodyPart: 'knee', injuredAt: new Date(Date.now() - DAY_MS).toISOString() }] })).toContain('acute_injury_72h');
    expect(flagsOf({ injuries: [{ status: 'current', type: 'sprain', bodyPart: 'knee', injuredAt: new Date(Date.now() - 4 * DAY_MS).toISOString() }] })).not.toContain('acute_injury_72h');
    // registry fires the rule on the derived flag (top-level ruleIds would also
    // show the structural 'AS-MSK-002' tag for any current injury — not a match)
    const res = evalAt({ injuries: [{ status: 'current', type: 'sprain', bodyPart: 'knee', injuredAt: new Date(Date.now() - DAY_MS).toISOString() }] }, 'indoor_walk', null, ['AS-MSK-002']);
    expect(registryIds(res)).toContain('AS-MSK-002');
  });
  test('severe_undiagnosed_pain (painLevel ≥7) fires AS-MSK-005', () => {
    const on = evalAt({ injuries: [{ status: 'current', type: 'undiagnosed_pain', bodyPart: 'hip', painLevel: 8 }] }, 'indoor_walk', null, ['AS-MSK-005']);
    expect(on.ruleIds).toContain('AS-MSK-005');
    expect(on.decision).toBe('NEEDS_CLINICAL_REVIEW');
    const off = evalAt({ injuries: [{ status: 'current', type: 'sprain', bodyPart: 'hip', painLevel: 4 }] }, 'indoor_walk', null, ['AS-MSK-005']);
    expect(off.ruleIds).not.toContain('AS-MSK-005');
  });
  test('post_fall_pain token has no input path — severe_undiagnosed_pain still carries the rule', () => {
    // Honest: 'post_fall_pain' cannot be produced by any field; the OR partner
    // severe_undiagnosed_pain makes the rule reachable without fabricating.
    const res = evalAt({ injuries: [{ status: 'current', type: 'contusion', bodyPart: 'knee', painLevel: 9 }] }, 'indoor_walk', null, ['AS-MSK-005']);
    expect(res.ruleIds).toContain('AS-MSK-005');
  });
  test('rehab_plan_active fires on recovering injury, not resolved', () => {
    const on = evalAt({ injuries: [{ status: 'recovering', type: 'sprain', bodyPart: 'ankle' }] }, 'indoor_walk', null, ['AS-MSK-004']);
    expect(on.ruleIds).toContain('AS-MSK-004');
    const off = evalAt({ injuries: [{ status: 'resolved', type: 'sprain', bodyPart: 'ankle' }] }, 'indoor_walk', null, ['AS-MSK-004']);
    expect(off.ruleIds).not.toContain('AS-MSK-004');
  });
  test('post_surgical_undocumented only when clearance + restrictions both absent', () => {
    expect(flagsOf({ surgeries: [{ status: 'recovering', procedureCategory: 'orthopedic', activityClearance: null, clinicianRestrictions: [] }] })).toContain('post_surgical_undocumented');
    expect(flagsOf({ surgeries: [{ status: 'recovering', procedureCategory: 'orthopedic', activityClearance: { indoor_walk: 'restricted' }, clinicianRestrictions: [] }] })).not.toContain('post_surgical_undocumented');
    const res = evalAt({ surgeries: [{ status: 'recovering', procedureCategory: 'orthopedic', activityClearance: null, clinicianRestrictions: [] }] }, 'indoor_walk', null, ['AS-MSK-008']);
    expect(registryIds(res)).toContain('AS-MSK-008');
  });
  test('joint_instability derivable via symptom OR injury type', () => {
    const viaSymptom = evalAt({ symptomReports: [{ status: 'active', symptoms: ['joint_instability'] }] }, 'outdoor_run', MILD, ['AS-MSK-003']);
    expect(viaSymptom.ruleIds).toContain('AS-MSK-003');
    const viaInjury = evalAt({ injuries: [{ status: 'current', type: 'joint_instability', bodyPart: 'knee' }] }, 'outdoor_run', MILD, ['AS-MSK-003']);
    expect(viaInjury.ruleIds).toContain('AS-MSK-003');
  });
});

describe('composite + wildcard semantics', () => {
  test('AS-CORE-003 needs BOTH screening_incomplete AND risk_flags (a+b conjunction)', () => {
    const both = evalAt({ profilePresent: false, ageYears: 62 }, 'indoor_walk', null, ['AS-CORE-003']);
    expect(both.ruleIds).toContain('AS-CORE-003');
    const riskOnly = evalAt({ profilePresent: true, ageYears: 62 }, 'indoor_walk', null, ['AS-CORE-003']);
    expect(riskOnly.ruleIds).not.toContain('AS-CORE-003'); // OR would flag every 60+ user — never
    const screenOnly = evalAt({ profilePresent: false }, 'indoor_walk', null, ['AS-CORE-003']);
    expect(screenOnly.ruleIds).not.toContain('AS-CORE-003');
  });
  test('AS-CORE-002 __match_activity__ blocks only activities demanding a restricted category', () => {
    const ctx = { restrictions: [{ status: 'active', categories: ['lower_limb_load'], bodyRegions: [], severity: 'prohibited', source: 'clinician_documented' }] };
    const blocked = evalAt(ctx, 'outdoor_walk', MILD, ['AS-CORE-002']);
    expect(blocked.ruleIds).toContain('AS-CORE-002');
    expect(blocked.decision).toBe('BLOCK_ACTIVITY');
    const unrelated = evalAt(ctx, 'overhead_lifting', null, ['AS-CORE-002']);
    expect(unrelated.ruleIds).not.toContain('AS-CORE-002'); // restriction never blocks what it doesn't name
  });
  test('AS-PREG-003 __any__ fires only when a restriction exists', () => {
    const ctx = { pregnancyStatus: 'pregnant', medicationFlags: ['pregnancy_high_risk'], restrictions: [{ status: 'active', categories: ['impact'], bodyRegions: [], severity: 'prohibited', source: 'clinician_documented' }] };
    expect(evalAt(ctx, 'indoor_walk', null, ['AS-PREG-003']).ruleIds).toContain('AS-PREG-003');
    const noRestriction = { ...ctx, restrictions: [] };
    expect(evalAt(noRestriction, 'indoor_walk', null, ['AS-PREG-003']).ruleIds).not.toContain('AS-PREG-003');
  });
  test('AS-PER-005 __always__ fires on any activity', () => {
    expect(evalAt(H(), 'indoor_walk', null, ['AS-PER-005']).ruleIds).toContain('AS-PER-005');
  });
});

describe('env-state + preference derivations', () => {
  test('env_unknown/env_stale flags fire AS-ENV-010/011 on outdoor only', () => {
    const unknown = evalAt(H(), 'outdoor_walk', null, ['AS-ENV-010']);
    expect(unknown.ruleIds).toContain('AS-ENV-010');
    const stale = evalAt(H(), 'outdoor_walk', { ...MILD, stale: true }, ['AS-ENV-011']);
    expect(stale.ruleIds).toContain('AS-ENV-011');
    const indoor = evalAt(H(), 'seated_movement', null, ['AS-ENV-010']);
    expect(indoor.ruleIds).not.toContain('AS-ENV-010'); // indoor → env eval not_applicable → no flag
    const fresh = evalAt(H(), 'outdoor_walk', MILD, ['AS-ENV-010', 'AS-ENV-011']);
    expect(fresh.ruleIds).toEqual([]);
  });
  test('preference_match fires AS-PER-001 only on the preferred activity', () => {
    const ctx = { activityPreferences: ['indoor_walk'] };
    expect(evalAt(ctx, 'indoor_walk', null, ['AS-PER-001']).ruleIds).toContain('AS-PER-001');
    expect(evalAt(ctx, 'seated_movement', null, ['AS-PER-001']).ruleIds).not.toContain('AS-PER-001');
  });
  test('rest_day / workout_planned / rest_requested derive from preferences', () => {
    expect(evalAt({ preferences: { restDay: true } }, 'indoor_walk', null, ['AS-PER-003']).ruleIds).toContain('AS-PER-003');
    expect(evalAt({ preferences: { workoutPlanned: true } }, 'outdoor_walk', { ...MILD, precipitationMm: 8 }, ['AS-PER-002']).ruleIds).toContain('AS-PER-002');
    expect(evalAt({ preferences: { restRequested: true } }, 'indoor_walk', null, ['AS-REC-001']).ruleIds).toContain('AS-REC-001');
  });
});

describe('unsupported_input — never inferred', () => {
  test('AS-REC-003/AS-REC-004 stay inactive even with injected flag-like context', () => {
    const res = evalAt({ flags: new Set(['distress_signals', 'compulsive_pattern_flags']) }, 'indoor_walk', null, ['AS-REC-003', 'AS-REC-004']);
    expect(res.ruleIds).toEqual([]);
  });
});

describe('over-restriction guards — a restriction never blocks what it does not name', () => {
  test('upper_limb_load prohibition leaves lower-body activity eligible', () => {
    const ctx = { restrictions: [{ status: 'active', categories: ['upper_limb_load'], bodyRegions: [], severity: 'prohibited', source: 'clinician_documented' }] };
    expect(evalAt(ctx, 'outdoor_walk', MILD, ['AS-CORE-002']).decision).toBe('ALLOW');
    expect(evalAt(ctx, 'overhead_lifting', null, ['AS-CORE-002']).decision).toBe('BLOCK_ACTIVITY');
  });
  test('seated_movement restrictable via trunk_load, unrelated activity unaffected', () => {
    const ctx = { restrictions: [{ status: 'active', categories: ['trunk_load'], bodyRegions: [], severity: 'prohibited', source: 'clinician_documented' }] };
    expect(evalAt(ctx, 'seated_movement', null, ['AS-CORE-002']).ruleIds).toContain('AS-CORE-002');
    expect(evalAt(ctx, 'outdoor_walk', MILD, ['AS-CORE-002']).decision).toBe('ALLOW');
  });
});

describe('coexistence + missing data', () => {
  test('NWB ankle + diabetes — injury block dominates; condition does not block walking', () => {
    const ctx = { conditionKeys: ['diabetes_t2'], injuries: [{ status: 'current', type: 'fracture', bodyPart: 'ankle', weightBearingRestriction: 'non_weight_bearing' }] };
    const res = evalAt(ctx, 'outdoor_walk', MILD, ['AS-MSK-001', 'AS-DM-005']);
    expect(res.decision).toBe('BLOCK_ACTIVITY');
    expect(res.ruleIds).toContain('AS-MSK-001');
  });
  test('asthma + active injury + mild AQI — AQI USG caution coexists with injury modify', () => {
    const ctx = { conditionKeys: ['asthma'], injuries: [{ status: 'current', type: 'sprain', bodyPart: 'wrist' }] };
    const res = evalAt(ctx, 'outdoor_walk', { ...MILD, aqi: { value: 120 } }, ['AS-RESP-001']);
    expect(res.decision).not.toBe('URGENT_ESCALATION');
    expect(res.decision).not.toBe('BLOCK_ACTIVITY'); // wrist sprain never blocks walking
  });
  test('missing information never becomes certainty: empty ctx → no restrictive verdict, INSUFFICIENT outdoor only via env', () => {
    const indoor = evalAt(H(), 'indoor_walk', null, ['AS-CORE-003', 'AS-CORE-004']);
    expect(indoor.decision).not.toBe('BLOCK_ACTIVITY');
    expect(indoor.decision).not.toBe('INSUFFICIENT_DATA');
    expect(indoor.decision).not.toBe('URGENT_ESCALATION');
    expect(registryIds(indoor)).toEqual(['AS-CORE-004']); // __always__ info marker only — no screening claim
    const outdoor = evalAt(H(), 'outdoor_walk', null, []);
    expect(outdoor.decision).toBe('INSUFFICIENT_DATA'); // unknown env ≠ safe — the honest claim
  });
  test('profilePresent false alone is not a clinical verdict — composite requires risk too', () => {
    const res = evalAt({ profilePresent: false }, 'seated_movement', null, ['AS-CORE-003']);
    expect(res.ruleIds).toEqual([]);
  });
});
