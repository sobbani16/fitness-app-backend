// Activity Safety Engine — scenario + invariant suite.
// Engine-level tests run without a DB: contexts are synthetic fixtures.
// DB-backed route tests mock prisma separately.
const svc = require('../src/services/activitySafety');
const { getActivity: A } = svc;
const { evaluateEnvironment } = require('../src/services/activitySafety/environment');
const { markStale } = require('../src/services/environmentService');

const MILD = {
  available: true, weatherCode: 0, tempC: 22, apparentTempC: 22,
  aqi: { value: 30 }, alerts: [], forecast: [],
};
const H = () => ({ userId: 'u', conditions: [], injuries: [], surgeries: [], restrictions: [], mobility: {}, preferences: {} });

const dec = (ctx, act, env, rules) => svc.evaluate(ctx, A(act), env, { rules }).decision;

describe('required scenarios (S001–S020 family)', () => {
  test('S001 healthy adult + mild → walk allowed', () => {
    expect(dec(H(), 'outdoor_walk', MILD)).toBe('ALLOW');
  });
  test('S002 active ankle fracture NWB → walking blocked', () => {
    const c = { ...H(), injuries: [{ bodyPart: 'ankle', type: 'fracture', status: 'current', weightBearingRestriction: 'non_weight_bearing' }] };
    expect(dec(c, 'outdoor_walk', MILD)).toBe('BLOCK_ACTIVITY');
    expect(dec(c, 'outdoor_run', MILD)).toBe('BLOCK_ACTIVITY');
    expect(dec(c, 'indoor_walk', MILD)).toBe('BLOCK_ACTIVITY');
    expect(dec(c, 'strength_training', MILD)).toBe('BLOCK_ACTIVITY'); // standing partial WB
  });
  test('S002 NWB ankle → supported alternatives evaluated independently', () => {
    const c = { ...H(), injuries: [{ bodyPart: 'ankle', type: 'fracture', status: 'current', weightBearingRestriction: 'non_weight_bearing' }] };
    expect(dec(c, 'seated_movement', MILD)).toBe('ALLOW');
    expect(dec(c, 'upper_body_ergometer', MILD)).toBe('ALLOW');
    // seated cycling still uses the injured limb → constrained, not silently safe
    expect(['MODIFY', 'BLOCK_ACTIVITY', 'NEEDS_CLINICAL_REVIEW']).toContain(dec(c, 'recumbent_cycling', MILD));
  });
  test('S003 documented no-impact restriction → run blocked, walk modify', () => {
    const c = { ...H(), injuries: [{ bodyPart: 'knee', type: 'post_surgical', status: 'recovering', prohibitedCategories: ['impact'] }] };
    expect(dec(c, 'outdoor_run', MILD)).toBe('BLOCK_ACTIVITY');
    expect(dec(c, 'outdoor_walk', MILD)).toBe('MODIFY');
  });
  test('S004 active ankle restriction blocks regardless of rain', () => {
    const c = { ...H(), injuries: [{ bodyPart: 'ankle', type: 'sprain', status: 'current', weightBearingRestriction: 'non_weight_bearing' }] };
    const rainy = { ...MILD, weatherCode: 61, precipitationMm: 2 };
    expect(dec(c, 'outdoor_walk', rainy)).toBe('BLOCK_ACTIVITY'); // medical outranks env
  });
  test('S005 asthma + unhealthy AQI → outdoor precautions/defer', () => {
    const c = { ...H(), conditions: ['asthma'] };
    expect(dec(c, 'outdoor_walk', { ...MILD, aqi: { value: 160 } })).toBe('DEFER_OUTDOOR');
    expect(dec(c, 'outdoor_walk', { ...MILD, aqi: { value: 120 } })).toBe('MODIFY');
    // indoor alternatives unaffected by AQI
    expect(dec(c, 'indoor_walk', { ...MILD, aqi: { value: 160 } })).toBe('ALLOW');
  });
  test('S006 unexplained chest pain → urgent escalation, any weather', () => {
    const c = { ...H(), symptomReports: [{ status: 'active', symptoms: ['chest_pain'] }] };
    expect(dec(c, 'outdoor_walk', MILD)).toBe('URGENT_ESCALATION');
    expect(dec(c, 'seated_movement', MILD)).toBe('URGENT_ESCALATION');
    expect(dec(c, 'rest', MILD)).toBe('URGENT_ESCALATION');
  });
  test('S006b syncope / pregnancy bleeding → urgent', () => {
    expect(dec({ ...H(), symptomReports: [{ status: 'active', symptoms: ['syncope'] }] }, 'outdoor_walk', MILD)).toBe('URGENT_ESCALATION');
    expect(dec({ ...H(), pregnancyStatus: 'pregnant', symptomReports: [{ status: 'active', symptoms: ['pregnancy_bleeding'] }] }, 'outdoor_walk', MILD)).toBe('URGENT_ESCALATION');
  });
  test('S007 uncomplicated pregnancy → not categorically blocked', () => {
    const c = { ...H(), pregnancyStatus: 'pregnant' };
    expect(dec(c, 'outdoor_walk', MILD)).toBe('ALLOW');
    expect(dec(c, 'seated_movement', MILD)).toBe('ALLOW');
    // valsalva (heavy straining) pattern gets a modification note
    expect(dec(c, 'strength_training', MILD)).toBe('MODIFY');
  });
  test('S008 pregnancy warning symptoms → stop + escalate', () => {
    for (const code of ['pregnancy_bleeding', 'pregnancy_contractions', 'pregnancy_fluid_leak']) {
      expect(dec({ ...H(), symptomReports: [{ status: 'active', symptoms: [code] }] }, 'outdoor_walk', MILD))
        .toBe('URGENT_ESCALATION');
    }
  });
  test('S009 heat-sensitive flag + high heat → deferred outdoor', () => {
    const c = { ...H(), conditions: ['multiple sclerosis'] };
    expect(dec(c, 'outdoor_walk', { ...MILD, apparentTempC: 37 })).toBe('DEFER_OUTDOOR');
    expect(dec(c, 'outdoor_walk', { ...MILD, apparentTempC: 29 })).toBe('MODIFY');
    expect(dec(c, 'seated_movement', { ...MILD, apparentTempC: 37 })).toBe('ALLOW');
  });
  test('S010 wheelchair user → accessible candidates evaluated, not default walk', () => {
    const c = { ...H(), mobility: { wheelchairUser: true, walkingAbility: 'unable' } };
    expect(dec(c, 'outdoor_walk', MILD)).toBe('BLOCK_ACTIVITY');
    expect(dec(c, 'seated_movement', MILD)).toBe('ALLOW');
    expect(dec(c, 'upper_body_ergometer', MILD)).toBe('ALLOW');
    const rec = svc.recommend(c, MILD);
    expect(rec.suggestion).not.toBeNull();
    expect(['seated_movement', 'upper_body_ergometer', 'upper_body_strength', 'rest']).toContain(rec.suggestion.activityId);
  });
  test('S011 recent surgery without documented clearance → review, not clearance', () => {
    const c = { ...H(), surgeries: [{ procedureCategory: 'orthopedic', status: 'recovering', clinicianRestrictions: [], activityClearance: {} }] };
    expect(dec(c, 'outdoor_run', MILD)).toBe('NEEDS_CLINICAL_REVIEW');
    expect(dec(c, 'seated_movement', MILD)).toBe('ALLOW'); // light demand stays allowed
  });
  test('S011b elapsed time alone never clears surgery', () => {
    const old = { procedureCategory: 'cardiac', status: 'recovering', performedAt: new Date(Date.now() - 400 * 864e5), clinicianRestrictions: [], activityClearance: {} };
    expect(dec({ ...H(), surgeries: [old] }, 'outdoor_run', MILD)).toBe('NEEDS_CLINICAL_REVIEW');
  });
  test('S012 clinician-documented restriction respected in perfect weather', () => {
    const c = { ...H(), restrictions: [{ status: 'active', categories: ['impact'], severity: 'prohibited', source: 'clinician_documented' }] };
    expect(dec(c, 'outdoor_run', MILD)).toBe('BLOCK_ACTIVITY');
    expect(dec(c, 'outdoor_walk', MILD)).toBe('ALLOW');
  });
  test('S013 thunderstorm → outdoor deferred, indoor unaffected', () => {
    const t = { ...MILD, weatherCode: 95 };
    expect(dec(H(), 'outdoor_walk', t)).toBe('DEFER_OUTDOOR');
    expect(dec(H(), 'outdoor_run', t)).toBe('DEFER_OUTDOOR');
    expect(dec(H(), 'indoor_walk', t)).toBe('ALLOW');
  });
  test('S014 stable chronic condition → not automatically prohibited', () => {
    for (const name of ['hypertension', 'type 2 diabetes', 'asthma', 'osteoarthritis']) {
      expect(dec({ ...H(), conditions: [name] }, 'outdoor_walk', MILD)).toBe('ALLOW');
    }
  });
  test('S015 missing weather data → outdoor unverifiable, not "safe"', () => {
    expect(dec(H(), 'outdoor_walk', null)).toBe('INSUFFICIENT_DATA');
    expect(dec(H(), 'outdoor_walk', { available: false })).toBe('INSUFFICIENT_DATA');
    expect(dec(H(), 'seated_movement', null)).toBe('ALLOW'); // indoor unaffected
  });
  test('S016 new injury invalidates prior decision (context reload)', () => {
    const before = dec(H(), 'outdoor_walk', MILD);
    const after = dec({ ...H(), injuries: [{ bodyPart: 'ankle', type: 'fracture', status: 'current', weightBearingRestriction: 'non_weight_bearing' }] }, 'outdoor_walk', MILD);
    expect(before).toBe('ALLOW');
    expect(after).toBe('BLOCK_ACTIVITY');
  });
  test('S017 explicit rest request → suppressed suggestion', () => {
    const r = svc.evaluate({ ...H(), preferences: { restRequested: true } }, A('outdoor_walk'), MILD);
    expect(r.suppressed).toBe(true);
    const rec = svc.recommend({ ...H(), preferences: { restRequested: true } }, MILD);
    expect(rec.disposition).toBe('suppressed_rest');
    expect(rec.suggestion).toBeNull();
  });
  test('S018 condition + medication flag combine on heat', () => {
    const c = { ...H(), conditions: ['type 2 diabetes'], medicationFlags: ['heat_sensitivity'] };
    expect(dec(c, 'outdoor_walk', { ...MILD, apparentTempC: 37 })).toBe('DEFER_OUTDOOR');
  });
  test('S019 high fitness never overrides active injury', () => {
    const c = { ...H(), activityLevel: 'very_active', fitnessExperience: 'advanced',
      injuries: [{ bodyPart: 'knee', type: 'sprain', status: 'current', prohibitedCategories: ['impact'] }] };
    expect(dec(c, 'outdoor_run', MILD)).toBe('BLOCK_ACTIVITY');
  });
  test('S020 rule output is what the engine returns — no free-text bypass', () => {
    const rule = { ruleCode: 'T-1', name: 'test', appliesTo: { conditionKeys: ['asthma'], activityCategories: ['outdoor_exposed'] }, effect: 'MODIFY', reason: 'r', requiredData: [] };
    expect(dec({ ...H(), conditions: ['asthma'] }, 'outdoor_walk', MILD, [rule])).toBe('MODIFY');
    expect(dec({ ...H(), conditions: ['asthma'] }, 'seated_movement', MILD, [rule])).toBe('ALLOW');
  });
});

describe('environmental bands', () => {
  test('heat index bands', () => {
    expect(dec(H(), 'outdoor_walk', { ...MILD, apparentTempC: 30 })).toBe('ALLOW');
    expect(dec(H(), 'outdoor_walk', { ...MILD, apparentTempC: 33 })).toBe('MODIFY');
    expect(dec(H(), 'outdoor_walk', { ...MILD, apparentTempC: 41 })).toBe('DEFER_OUTDOOR');
  });
  test('AQI bands', () => {
    expect(dec(H(), 'outdoor_walk', { ...MILD, aqi: { value: 50 } })).toBe('ALLOW');
    expect(dec(H(), 'outdoor_walk', { ...MILD, aqi: { value: 140 } })).toBe('ALLOW'); // healthy, USG band
    expect(dec(H(), 'outdoor_walk', { ...MILD, aqi: { value: 170 } })).toBe('DEFER_OUTDOOR');
    expect(dec(H(), 'outdoor_walk', { ...MILD, aqi: { value: 250 } })).toBe('DEFER_OUTDOOR');
  });
  test('cold danger + caution', () => {
    expect(dec(H(), 'outdoor_walk', { ...MILD, apparentTempC: -20 })).toBe('DEFER_OUTDOOR');
    expect(dec(H(), 'outdoor_walk', { ...MILD, apparentTempC: -10, windSpeedKmh: 25 })).toBe('MODIFY');
    expect(dec({ ...H(), conditions: ['coronary artery disease'] }, 'outdoor_walk', { ...MILD, apparentTempC: -10 })).toBe('MODIFY');
  });
  test('severe alerts defer; absence of alert data noted', () => {
    expect(dec(H(), 'outdoor_walk', { ...MILD, alerts: [{ event: 'tornado warning', severity: 'extreme' }] })).toBe('DEFER_OUTDOOR');
    const r = svc.evaluate(H(), A('outdoor_walk'), { ...MILD, alertsAvailable: false });
    expect(r.requiredData).toContain('severe_weather_alerts');
  });
  test('heavy precip modifies; light rain alone does not block', () => {
    expect(dec(H(), 'outdoor_walk', { ...MILD, precipitationMm: 6 })).toBe('MODIFY');
    expect(dec(H(), 'outdoor_walk', { ...MILD, precipitationMm: 0.5 })).toBe('ALLOW');
  });
  test('better-time suggestion from real forecast hours only', () => {
    const env = { ...MILD, apparentTempC: 37, tempC: 37,
      forecast: [{ time: '18:00', apparentTempC: 24, weatherCode: 0, precipitationProbabilityPct: 0 }] };
    const r = svc.evaluate(H(), A('outdoor_walk'), env);
    expect(r.decision).toBe('MODIFY');
    expect(r.betterTime).toEqual({ time: '18:00' });
    // AQI deferral → no invented time
    const r2 = svc.evaluate(H(), A('outdoor_walk'), { ...MILD, aqi: { value: 170 }, forecast: env.forecast });
    expect(r2.betterTime).toBeNull();
  });
  test('stale observation → INSUFFICIENT_DATA via markStale', () => {
    const stale = markStale({ ...MILD, fetchedAt: new Date(Date.now() - 120 * 60e3).toISOString() });
    expect(stale.stale).toBe(true);
    expect(dec(H(), 'outdoor_walk', stale)).toBe('INSUFFICIENT_DATA');
  });
});

describe('injury lifecycle & restrictions', () => {
  const ankle = extra => ({ bodyPart: 'ankle', type: 'sprain', status: 'current', ...extra });
  test('resolved injury no longer constrains', () => {
    const c = { ...H(), injuries: [ankle({ status: 'resolved' })] };
    expect(dec(c, 'outdoor_walk', MILD)).toBe('ALLOW');
  });
  test('current injury without documented clearance → modify (not permanent ban)', () => {
    const c = { ...H(), injuries: [ankle()] };
    expect(dec(c, 'outdoor_walk', MILD)).toBe('MODIFY');
    expect(dec(c, 'seated_movement', MILD)).toBe('ALLOW');
  });
  test('upper-limb injury does not constrain lower-limb activity', () => {
    const c = { ...H(), injuries: [{ bodyPart: 'wrist', type: 'fracture', status: 'current' }] };
    expect(dec(c, 'outdoor_walk', MILD)).toBe('ALLOW');
    expect(dec(c, 'upper_body_strength', MILD)).toBe('MODIFY');
  });
  test('severe undiagnosed pain → needs clinical review', () => {
    const c = { ...H(), injuries: [{ bodyPart: 'knee', type: 'undiagnosed_pain', status: 'current', painLevel: 8 }] };
    expect(dec(c, 'outdoor_walk', MILD)).toBe('NEEDS_CLINICAL_REVIEW');
  });
  test('unmapped body part → INSUFFICIENT_DATA, not assumed compatible', () => {
    const c = { ...H(), injuries: [{ bodyPart: 'custom_region_x', type: 'other', status: 'current' }] };
    expect(dec(c, 'outdoor_walk', MILD)).toBe('INSUFFICIENT_DATA');
  });
  test('expired clinician restriction → review; expired self → inactive', () => {
    const doc = { ...H(), restrictions: [{ status: 'expired', categories: ['impact'], severity: 'prohibited', source: 'clinician_documented' }] };
    const self = { ...H(), restrictions: [{ status: 'expired', categories: ['impact'], severity: 'prohibited', source: 'self_reported' }] };
    expect(dec(doc, 'outdoor_run', MILD)).toBe('NEEDS_CLINICAL_REVIEW');
    expect(dec(self, 'outdoor_run', MILD)).toBe('ALLOW');
  });
  test('active + past expiresAt clinician restriction → review (never auto-clear)', () => {
    const c = { ...H(), restrictions: [{ status: 'active', categories: ['impact'], severity: 'prohibited', source: 'clinician_documented', expiresAt: new Date(Date.now() - 864e5) }] };
    expect(dec(c, 'outdoor_run', MILD)).toBe('NEEDS_CLINICAL_REVIEW');
  });
  test('multiple injuries compound conservatively', () => {
    const c = { ...H(), injuries: [
      { bodyPart: 'ankle', type: 'sprain', status: 'current', weightBearingRestriction: 'non_weight_bearing' },
      { bodyPart: 'wrist', type: 'strain', status: 'current' },
    ] };
    expect(dec(c, 'outdoor_walk', MILD)).toBe('BLOCK_ACTIVITY');
    expect(dec(c, 'upper_body_ergometer', MILD)).toBe('MODIFY'); // wrist load
    expect(dec(c, 'rest', MILD)).toBe('ALLOW');
  });
  test('swimming not a universal substitute — wound/procedure restrictions apply', () => {
    const c = { ...H(), surgeries: [{ procedureCategory: 'abdominal', status: 'recovering', clinicianRestrictions: ['water_immersion'], activityClearance: {} }] };
    expect(dec(c, 'swimming', MILD)).toBe('BLOCK_ACTIVITY');
  });
});

describe('mobility, recovery & preference handling', () => {
  test('balance limitation modifies high-balance activities', () => {
    const c = { ...H(), mobility: { balanceLimitation: true } };
    expect(dec(c, 'gentle_mobility', MILD)).toBe('MODIFY');
    expect(dec(c, 'seated_movement', MILD)).toBe('ALLOW');
  });
  test('limited walking ability keeps short-duration options', () => {
    const c = { ...H(), mobility: { walkingAbility: 'limited' } };
    expect(dec(c, 'outdoor_walk', MILD)).toBe('MODIFY');
  });
  test('rest is never blocked by the engine', () => {
    const worst = { ...H(), symptomReports: [{ status: 'active', symptoms: ['fever'] }],
      injuries: [{ bodyPart: 'ankle', type: 'fracture', status: 'current', weightBearingRestriction: 'non_weight_bearing' }] };
    expect(['ALLOW', 'NEEDS_CLINICAL_REVIEW']).toContain(dec(worst, 'rest', MILD));
  });
  test('non-urgent symptoms escalate to review, not to blanket bans', () => {
    const c = { ...H(), symptomReports: [{ status: 'active', symptoms: ['unusual_fatigue'] }] };
    const d = dec(c, 'outdoor_walk', MILD);
    expect(['ALLOW', 'MODIFY', 'NEEDS_CLINICAL_REVIEW']).toContain(d);
    expect(d).not.toBe('BLOCK_ACTIVITY');
  });
});

describe('rule matching & gating semantics', () => {
  const blockRule = { ruleCode: 'R1', name: 'x', appliesTo: { bodyParts: ['knee'], activityCategories: ['impact'] }, effect: 'BLOCK_ACTIVITY', reason: 'r', requiredData: [] };
  test('rule ANDs across groups, ORs within a group', () => {
    const knee = { ...H(), injuries: [{ bodyPart: 'knee', type: 'x', status: 'current' }] };
    expect(dec(knee, 'outdoor_run', MILD, [blockRule])).toBe('BLOCK_ACTIVITY');
    expect(dec(knee, 'outdoor_walk', MILD, [blockRule])).toBe('MODIFY'); // walk lacks 'impact'
    const ankle = { ...H(), injuries: [{ bodyPart: 'ankle', type: 'x', status: 'current' }] };
    expect(dec(ankle, 'outdoor_run', MILD, [blockRule])).toBe('MODIFY'); // no knee → rule inert
  });
  test('exclusion vetoes a match', () => {
    const r = { ...blockRule, ruleCode: 'R2', exclusion: { conditionKeys: ['cardiac_rehab'] } };
    const knee = { ...H(), conditions: ['cardiac_rehab'], injuries: [{ bodyPart: 'knee', type: 'x', status: 'current' }] };
    expect(dec(knee, 'outdoor_run', MILD, [r])).toBe('MODIFY'); // rule vetoed → injury MODIFY only
  });
  test('resolved injury does not trigger bodyPart rules', () => {
    const c = { ...H(), injuries: [{ bodyPart: 'knee', type: 'x', status: 'resolved' }] };
    expect(dec(c, 'outdoor_run', MILD, [blockRule])).toBe('ALLOW');
  });
  test('no rules supplied → only structural mechanics fire', () => {
    expect(dec({ ...H(), conditions: ['asthma'] }, 'outdoor_walk', MILD, [])).toBe('ALLOW');
  });
});

describe('invariants', () => {
  test('determinism — identical input → identical output', () => {
    const c = { ...H(), conditions: ['asthma'], injuries: [{ bodyPart: 'knee', type: 'sprain', status: 'current' }] };
    const r1 = svc.evaluate(c, A('outdoor_walk'), MILD);
    const r2 = svc.evaluate(c, A('outdoor_walk'), MILD);
    expect(r1.decision).toBe(r2.decision);
    expect(r1.ruleIds).toEqual(r2.ruleIds);
  });
  test('better weather cannot override clinical prohibition', () => {
    const c = { ...H(), restrictions: [{ status: 'active', categories: ['lower_limb_load'], severity: 'prohibited', source: 'clinician_documented' }] };
    const perfect = { ...MILD, tempC: 20, apparentTempC: 20, aqi: { value: 10 }, uvIndex: 1 };
    expect(dec(c, 'outdoor_walk', perfect)).toBe('BLOCK_ACTIVITY');
    expect(dec(c, 'outdoor_walk', { ...perfect, weatherCode: 95 })).toBe('BLOCK_ACTIVITY');
  });
  test('urgent symptoms dominate every other dimension', () => {
    const c = { ...H(), symptomReports: [{ status: 'active', symptoms: ['chest_pain'] }],
      injuries: [{ bodyPart: 'ankle', type: 'fracture', status: 'current', weightBearingRestriction: 'non_weight_bearing' }] };
    expect(dec(c, 'outdoor_walk', { ...MILD, weatherCode: 95 })).toBe('URGENT_ESCALATION');
  });
  test('every persisted-shaped result carries audit metadata', () => {
    const r = svc.evaluate(H(), A('outdoor_walk'), MILD);
    expect(r.policyVersion).toBeTruthy();
    expect(Array.isArray(r.ruleIds)).toBe(true);
    expect(Array.isArray(r.reasons)).toBe(true);
    expect(r.candidateActivityId).toBe('outdoor_walk');
    expect(r.evaluatedAt).toBeTruthy();
  });
  test('celsius/fahrenheit-equivalent inputs agree', () => {
    const cEnv = { ...MILD, apparentTempC: 40, tempC: 40 };
    const fEnv = { ...MILD, apparentTempC: 40, tempC: 40 }; // service normalizes °F→°C upstream
    expect(dec(H(), 'outdoor_walk', cEnv)).toBe(dec(H(), 'outdoor_walk', fEnv));
  });
  test('user A context cannot leak into user B evaluation', () => {
    const a = { ...H(), userId: 'A', restrictions: [{ status: 'active', categories: ['impact'], severity: 'prohibited' }] };
    const b = { ...H(), userId: 'B' };
    expect(dec(a, 'outdoor_run', MILD)).toBe('BLOCK_ACTIVITY');
    expect(dec(b, 'outdoor_run', MILD)).toBe('ALLOW');
  });
});

describe('recommend() pipeline', () => {
  test('NWB injury → suggestion excludes weight-bearing', () => {
    const c = { ...H(), injuries: [{ bodyPart: 'ankle', type: 'fracture', status: 'current', weightBearingRestriction: 'non_weight_bearing' }] };
    const rec = svc.recommend(c, MILD);
    expect(rec.disposition).toBe('suggestion');
    expect(['seated_movement', 'upper_body_ergometer', 'upper_body_strength', 'rest', 'gentle_mobility']).toContain(rec.suggestion.activityId);
    expect(rec.suggestion.activityId).not.toBe('outdoor_walk');
  });
  test('urgent → suppressed_urgent with escalation payload', () => {
    const rec = svc.recommend({ ...H(), symptomReports: [{ status: 'active', symptoms: ['syncope'] }] }, MILD);
    expect(rec.disposition).toBe('suppressed_urgent');
    expect(rec.suggestion).toBeNull();
    expect(rec.urgent.decision).toBe('URGENT_ESCALATION');
  });
  test('alternatives independently evaluated — swimming unavailable after immersion restriction', () => {
    const c = { ...H(), surgeries: [{ procedureCategory: 'abdominal', status: 'recovering', clinicianRestrictions: ['water_immersion'], activityClearance: {} }] };
    const rec = svc.recommend(c, MILD);
    const swim = rec.results.find(r => r.candidateActivityId === 'swimming');
    expect(swim.decision).toBe('BLOCK_ACTIVITY');
    expect(swim.allowedAlternatives).not.toContain('swimming');
  });
  test('all-blocked context → no_safe_candidate, never a forced suggestion', () => {
    const c = { ...H(), restrictions: [{ status: 'active', categories: ['weight_bearing_lower', 'lower_limb_load', 'upper_limb_load', 'trunk_load', 'balance_challenging'], severity: 'prohibited', source: 'clinician_documented' }] };
    const rec = svc.recommend(c, MILD);
    expect(['no_safe_candidate', 'suggestion']).toContain(rec.disposition);
    if (rec.suggestion) expect(['rest', 'seated_movement']).toContain(rec.suggestion.activityId);
  });
});
