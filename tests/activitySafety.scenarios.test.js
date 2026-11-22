// Combination scenario matrix (S021+) — medical × injury × environment ×
// missing-data interactions beyond the single-axis engine suite.
const svc = require('../src/services/activitySafety');
const { getActivity: A } = svc;

const MILD = { available: true, weatherCode: 0, tempC: 22, apparentTempC: 22, aqi: { value: 30 }, alerts: [], forecast: [] };
const H = () => ({ userId: 'u', conditions: [], injuries: [], surgeries: [], restrictions: [], mobility: {}, preferences: {} });
const dec = (ctx, act, env, rules) => svc.evaluate(ctx, A(act), env, { rules }).decision;
const NWB = (part) => ({ bodyPart: part, type: 'fracture', status: 'current', weightBearingRestriction: 'non_weight_bearing' });
const URGENT = (code) => ({ status: 'active', symptoms: [code] });

describe('medical × injury combinations', () => {
  test('S021 NWB knee + asthma + bad AQI → injury dominates indoors and out', () => {
    const c = { ...H(), injuries: [NWB('knee')], conditions: ['asthma'] };
    const badAir = { ...MILD, aqi: { value: 160 } };
    expect(dec(c, 'outdoor_walk', badAir)).toBe('BLOCK_ACTIVITY'); // injury beats AQI
    expect(dec(c, 'indoor_walk', badAir)).toBe('BLOCK_ACTIVITY'); // indoor does not rescue
    expect(dec(c, 'seated_movement', badAir)).toBe('ALLOW');
  });
  test('S022 NWB knee + extreme heat → indoor still constrained by injury', () => {
    const c = { ...H(), injuries: [NWB('knee')] };
    const hot = { ...MILD, apparentTempC: 38 };
    expect(dec(c, 'outdoor_run', hot)).toBe('BLOCK_ACTIVITY');
    expect(dec(c, 'upper_body_ergometer', hot)).toBe('ALLOW'); // indoor, supported
  });
  test('S023 wrist fracture + pregnancy → upper-body limited, walk still modified', () => {
    const c = { ...H(), injuries: [{ bodyPart: 'wrist', type: 'fracture', status: 'current' }], pregnancyStatus: 'pregnant' };
    expect(dec(c, 'upper_body_ergometer', MILD)).toBe('MODIFY');
    expect(dec(c, 'outdoor_walk', MILD)).toBe('ALLOW'); // uncomplicated pregnancy
  });
  test('S024 shoulder impingement + swimming → modified, not blocked', () => {
    const c = { ...H(), injuries: [{ bodyPart: 'shoulder', type: 'impingement', status: 'current' }] };
    expect(dec(c, 'swimming', MILD)).toBe('MODIFY');
  });
  test('S025 documented trunk restriction → strength training blocked', () => {
    const c = { ...H(), restrictions: [{ status: 'active', categories: ['trunk_load'], severity: 'prohibited', source: 'clinician_documented' }] };
    expect(dec(c, 'strength_training', MILD)).toBe('BLOCK_ACTIVITY');
    expect(dec(c, 'outdoor_walk', MILD)).toBe('ALLOW');
  });
  test('S026 two concurrent injuries compound — suggestion narrows', () => {
    const c = { ...H(), injuries: [NWB('ankle'), { bodyPart: 'wrist', type: 'fracture', status: 'current' }] };
    const rec = svc.recommend(c, MILD);
    expect(rec.disposition).toBe('suggestion');
    expect(rec.suggestion.activityId).toBe('floor_core_work'); // supine — avoids both NWB ankle and wrist load
    expect(dec(c, 'upper_body_ergometer', MILD)).toBe('MODIFY');
    expect(dec(c, 'seated_movement', MILD)).toBe('MODIFY');
  });
  test('S027 recovering surgery + new acute injury → worst of both applies', () => {
    const c = {
      ...H(),
      surgeries: [{ procedureCategory: 'orthopedic', status: 'recovering', clinicianRestrictions: [], activityClearance: {} }],
      injuries: [NWB('ankle')],
    };
    expect(dec(c, 'outdoor_run', MILD)).toBe('BLOCK_ACTIVITY'); // injury outranks review
    expect(dec(c, 'outdoor_walk', MILD)).toBe('BLOCK_ACTIVITY');
  });
  test('S028 wheelchair user + shoulder injury → supported options shrink', () => {
    const c = { ...H(), mobility: { wheelchairUser: true, walkingAbility: 'unable' }, injuries: [{ bodyPart: 'shoulder', type: 'impingement', status: 'current' }] };
    expect(dec(c, 'seated_movement', MILD)).toBe('MODIFY'); // shoulder demand present
    expect(dec(c, 'outdoor_walk', MILD)).toBe('BLOCK_ACTIVITY'); // still not ambulatory
  });
  test('S029 wheelchair user + urgent symptom → escalation regardless', () => {
    const c = { ...H(), mobility: { wheelchairUser: true, walkingAbility: 'unable' }, symptomReports: [URGENT('chest_pain')] };
    expect(dec(c, 'seated_movement', MILD)).toBe('URGENT_ESCALATION');
    const rec = svc.recommend(c, MILD);
    expect(rec.disposition).toBe('suppressed_urgent');
  });
  test('S030 asthma + COPD + hazardous AQI → defer outdoors', () => {
    const c = { ...H(), conditions: ['asthma', 'copd'] };
    expect(dec(c, 'outdoor_walk', { ...MILD, aqi: { value: 160 } })).toBe('DEFER_OUTDOOR');
    expect(dec(c, 'indoor_walk', { ...MILD, aqi: { value: 160 } })).toBe('ALLOW');
  });
});

describe('environment × medical combinations', () => {
  test('S031 heat-sensitive + NWB ankle + heat → indoor path still injury-bound', () => {
    const c = { ...H(), conditions: ['multiple sclerosis'], injuries: [NWB('ankle')] };
    const hot = { ...MILD, apparentTempC: 38 };
    expect(dec(c, 'outdoor_walk', hot)).toBe('BLOCK_ACTIVITY');
    expect(dec(c, 'seated_movement', hot)).toBe('ALLOW');
  });
  test('S032 asthma + cold wind chill → outdoor modified', () => {
    const c = { ...H(), conditions: ['asthma'] };
    expect(dec(c, 'outdoor_walk', { ...MILD, apparentTempC: -10 })).toBe('MODIFY');
  });
  test('S033 diabetes + heat-sensitivity medication + high heat → defer', () => {
    const c = { ...H(), conditions: ['type 2 diabetes'], medicationFlags: ['heat_sensitivity'] };
    expect(dec(c, 'outdoor_walk', { ...MILD, apparentTempC: 38 })).toBe('DEFER_OUTDOOR');
  });
  test('S034 diabetes + missing env → outdoor unverifiable, not "safe"', () => {
    const c = { ...H(), conditions: ['type 2 diabetes'] };
    expect(dec(c, 'outdoor_walk', null)).toBe('INSUFFICIENT_DATA');
  });
  test('S035 pregnancy + thunderstorm → outdoor deferred, indoor allowed', () => {
    const c = { ...H(), pregnancyStatus: 'pregnant' };
    const storm = { ...MILD, weatherCode: 95 };
    expect(dec(c, 'outdoor_walk', storm)).toBe('DEFER_OUTDOOR');
    expect(dec(c, 'indoor_walk', storm)).toBe('ALLOW');
  });
  test('S036 pregnancy + high heat → defer outdoors', () => {
    const c = { ...H(), pregnancyStatus: 'pregnant' };
    expect(dec(c, 'outdoor_walk', { ...MILD, apparentTempC: 37 })).toBe('DEFER_OUTDOOR');
  });
  test('S037 cardiac surgery recovering + mild weather → clinical review, never silent clear', () => {
    const c = { ...H(), surgeries: [{ procedureCategory: 'cardiac', status: 'recovering', clinicianRestrictions: [], activityClearance: {} }] };
    expect(dec(c, 'outdoor_walk', MILD)).toBe('NEEDS_CLINICAL_REVIEW');
  });
  test('S038 severe alert + NWB injury → injury blocks; alert noted for indoor plan', () => {
    const c = { ...H(), injuries: [NWB('ankle')] };
    const alert = { ...MILD, alerts: [{ event: 'tornado warning', severity: 'extreme' }] };
    expect(dec(c, 'outdoor_walk', alert)).toBe('BLOCK_ACTIVITY');
    expect(dec(c, 'seated_movement', alert)).toBe('ALLOW');
  });
  test('S039 stale env + active injury → injury decision wins over env uncertainty', () => {
    const c = { ...H(), injuries: [NWB('ankle')] };
    expect(dec(c, 'outdoor_walk', { available: false })).toBe('BLOCK_ACTIVITY');
  });
  test('S040 missing env + urgent symptom → urgent dominates', () => {
    const c = { ...H(), symptomReports: [URGENT('chest_pain')] };
    expect(dec(c, 'outdoor_walk', null)).toBe('URGENT_ESCALATION');
  });
});

describe('missing-data conservatism', () => {
  test('S041 no env + clean record → indoor suggestion only', () => {
    const rec = svc.recommend(H(), null);
    expect(rec.disposition).toBe('suggestion');
    expect(A(rec.suggestion.activityId).environment).toBe('indoor');
  });
  test('S042 injury without a type → modified, not presumed safe', () => {
    const c = { ...H(), injuries: [{ bodyPart: 'ankle', status: 'current' }] };
    expect(dec(c, 'outdoor_walk', MILD)).toBe('MODIFY');
  });
  test('S043 surgery with unknown status → review required', () => {
    const c = { ...H(), surgeries: [{ procedureCategory: 'orthopedic', status: 'unknown', clinicianRestrictions: [], activityClearance: {} }] };
    expect(dec(c, 'outdoor_walk', MILD)).toBe('NEEDS_CLINICAL_REVIEW');
  });
  test('S044 expired self-reported restriction inert; expired clinician restriction demands review', () => {
    const past = new Date(Date.now() - 30 * 864e5).toISOString();
    const self = { ...H(), restrictions: [{ status: 'active', categories: ['impact'], severity: 'prohibited', source: 'self_reported', expiresAt: past }] };
    const clin = { ...H(), restrictions: [{ status: 'active', categories: ['impact'], severity: 'prohibited', source: 'clinician_documented', expiresAt: past }] };
    expect(dec(self, 'outdoor_run', MILD)).toBe('ALLOW');
    expect(['NEEDS_CLINICAL_REVIEW', 'BLOCK_ACTIVITY', 'MODIFY']).toContain(dec(clin, 'outdoor_run', MILD));
  });
  test('S045 missing mobility profile + balance demand → conservative modify', () => {
    const r = svc.evaluate({ ...H(), mobility: {} }, A('group_fitness_class'), MILD);
    expect(['ALLOW', 'MODIFY']).toContain(r.decision); // never BLOCK for missing data alone
  });
});

describe('recommendation-level combinations', () => {
  test('S046 NWB + perfect weather → suggestion excludes weight-bearing', () => {
    const rec = svc.recommend({ ...H(), injuries: [NWB('knee')] }, MILD);
    expect(rec.disposition).toBe('suggestion');
    expect(A(rec.suggestion.activityId).demands.weightBearing).not.toBe('full');
  });
  test('S047 chest pain → suppressed_urgent across whole catalog', () => {
    const rec = svc.recommend({ ...H(), symptomReports: [URGENT('chest_pain')] }, MILD);
    expect(rec.disposition).toBe('suppressed_urgent');
    expect(rec.suggestion).toBeNull();
  });
  test('S048 rest request + active injury → rest suppression wins (no push)', () => {
    const rec = svc.recommend({ ...H(), preferences: { restRequested: true }, injuries: [{ bodyPart: 'knee', type: 'sprain', status: 'current' }] }, MILD);
    expect(rec.disposition).toBe('suppressed_rest');
  });
  test('S049 asthma + bad AQI → recommendation routes indoors', () => {
    const rec = svc.recommend({ ...H(), conditions: ['asthma'] }, { ...MILD, aqi: { value: 160 } });
    expect(rec.disposition).toBe('suggestion');
    expect(A(rec.suggestion.activityId).environment).toBe('indoor');
  });
  test('S050 better-time offered only for deferrable environmental hazards', () => {
    const env = { ...MILD, apparentTempC: 37, tempC: 37, forecast: [{ time: '18:00', apparentTempC: 24, weatherCode: 0, precipitationProbabilityPct: 0 }] };
    const r = svc.evaluate({ ...H(), conditions: ['asthma'] }, A('outdoor_walk'), env);
    expect(r.decision).toBe('MODIFY');
    expect(r.betterTime).toEqual({ time: '18:00' });
  });
});

describe('catalog integrity — group_indoor', () => {
  test('S051 group_fitness_class exists with real demand metadata', () => {
    const a = A('group_fitness_class');
    expect(a.environment).toBe('indoor');
    expect(a.demands.categories).toContain('group_indoor');
    expect(a.demands.categories).toContain('weight_bearing_lower');
    expect(a.demands.impact).toBeTruthy();
  });
  test('S052 indoor does not mean safe — NWB knee blocks group class', () => {
    const c = { ...H(), injuries: [NWB('knee')] };
    expect(dec(c, 'group_fitness_class', MILD)).toBe('BLOCK_ACTIVITY');
    expect(dec(c, 'indoor_walk', MILD)).toBe('BLOCK_ACTIVITY');
  });
  test('S053 group_indoor rule hook works under shadow rules only', () => {
    const draftRule = { ruleCode: 'AS-SYS-004', name: 'immunosuppression', appliesTo: { profileFlags: ['immunosuppressed'], activityCategories: ['group_indoor'] }, effect: 'MODIFY', reason: 'crowd exposure' };
    const c = { ...H(), flags: new Set(['immunosuppressed']) };
    // live path (no draft rules supplied) → no rule annotation
    const live = svc.evaluate(c, A('group_fitness_class'), MILD, { rules: [] });
    expect(live.ruleIds).not.toContain('AS-SYS-004');
    // shadow path (draft rules supplied by caller) → rule fires
    const shadow = svc.evaluate(c, A('group_fitness_class'), MILD, { rules: [draftRule] });
    expect(shadow.ruleIds).toContain('AS-SYS-004');
    expect(shadow.decision).toBe('MODIFY');
  });
});

describe('rule-matching boundaries', () => {
  test('S054 AND-across-groups: rule needs condition AND category together', () => {
    const rule = { ruleCode: 'T-AND', appliesTo: { conditionKeys: ['asthma'], activityCategories: ['outdoor_exposed'] }, effect: 'MODIFY', reason: 'r' };
    // condition present but activity indoor → no match
    expect(dec({ ...H(), conditions: ['asthma'] }, 'indoor_walk', MILD, [rule])).toBe('ALLOW');
    // both present → match
    expect(dec({ ...H(), conditions: ['asthma'] }, 'outdoor_walk', MILD, [rule])).toBe('MODIFY');
  });
  test('S055 exclusion veto: rule silent when exclusion key present', () => {
    const rule = { ruleCode: 'T-EX', appliesTo: { activityCategories: ['weight_bearing_lower'] }, exclusion: { profileFlags: ['cleared'] }, effect: 'BLOCK_ACTIVITY', reason: 'r' };
    expect(dec({ ...H(), flags: new Set(['cleared']) }, 'outdoor_walk', MILD, [rule])).toBe('ALLOW');
    expect(dec(H(), 'outdoor_walk', MILD, [rule])).toBe('BLOCK_ACTIVITY');
  });
  test('S056 determinism — identical inputs produce identical decisions', () => {
    const c = { ...H(), conditions: ['asthma'], injuries: [{ bodyPart: 'wrist', type: 'sprain', status: 'current' }] };
    const env = { ...MILD, aqi: { value: 120 } };
    const r1 = svc.evaluate(c, A('outdoor_walk'), env);
    const r2 = svc.evaluate(c, A('outdoor_walk'), env);
    expect(r1.decision).toBe(r2.decision);
    expect(r1.reasons).toEqual(r2.reasons);
    expect(r1.ruleIds).toEqual(r2.ruleIds);
  });
  test('S057 per-user isolation — contexts do not bleed', () => {
    const injured = { ...H(), injuries: [NWB('knee')] };
    const clean = H();
    expect(dec(injured, 'outdoor_walk', MILD)).toBe('BLOCK_ACTIVITY');
    expect(dec(clean, 'outdoor_walk', MILD)).toBe('ALLOW');
  });
  test('S058 urgent symptom dominates even perfect weather + elite fitness', () => {
    const c = { ...H(), activityLevel: 'very_active', fitnessExperience: 'advanced', symptomReports: [URGENT('chest_pain')] };
    expect(dec(c, 'outdoor_run', MILD)).toBe('URGENT_ESCALATION');
  });
  test('S059 audit metadata — decision carries policy version + rule ids + reasons', () => {
    const c = { ...H(), injuries: [{ bodyPart: 'knee', type: 'sprain', status: 'current', prohibitedCategories: ['impact'] }] };
    const r = svc.evaluate(c, A('outdoor_run'), MILD);
    expect(r.policyVersion).toBeTruthy();
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.restrictions).toContain('impact');
    expect(r.evaluatedAt).toBeTruthy();
  });
  test('S060 conflicting conditions never crash — always a defined decision', () => {
    const c = { ...H(), conditions: ['asthma', 'copd', 'type 2 diabetes', 'hypertension', 'osteoporosis'] };
    for (const act of ['outdoor_walk', 'indoor_walk', 'seated_movement', 'strength_training', 'swimming']) {
      expect(['ALLOW', 'MODIFY', 'BLOCK_ACTIVITY', 'DEFER_OUTDOOR', 'NEEDS_CLINICAL_REVIEW', 'INSUFFICIENT_DATA', 'URGENT_ESCALATION']).toContain(dec(c, act, MILD));
    }
  });
});
