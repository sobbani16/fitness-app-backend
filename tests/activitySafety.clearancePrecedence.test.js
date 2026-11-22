// Phase 17 §2 — clearance precedence: deterministic invariants.
const svc = require('../src/services/activitySafety');
const { getActivity: A } = svc;
const M = { available: true, weatherCode: 0, tempC: 22, apparentTempC: 22, aqi: { value: 30 }, alerts: [], forecast: [] };
const HOT = { ...M, apparentTempC: 44, tempC: 44 };
const mk = (o = {}) => ({ userId: 'u', conditions: [], injuries: [], surgeries: [], restrictions: [], symptomReports: [], pregnancyStatus: null, age: 40, mobility: {}, medicationFlags: [], preferences: {}, ...o });
const SX = ac => [{ procedureCategory: 'orthopedic', status: 'recovering', clinicianRestrictions: [], activityClearance: ac }];
const NWB = [{ bodyPart: 'ankle', type: 'fracture', status: 'current', weightBearingRestriction: 'non_weight_bearing' }];
const RESTR = [{ status: 'active', categories: ['weight_bearing_lower'], severity: 'prohibited', source: 'clinician_documented' }];

describe('clearance precedence', () => {
  test('general cleared suppresses its own surgery NCR', () => {
    expect(svc.evaluate(mk({ surgeries: SX({ general: 'cleared' }) }), A('outdoor_walk'), M).decision).toBe('ALLOW');
  });
  test('general cleared does NOT override a newer active NWB injury', () => {
    const r = svc.evaluate(mk({ surgeries: SX({ general: 'cleared' }), injuries: NWB }), A('outdoor_walk'), M);
    expect(r.decision).toBe('BLOCK_ACTIVITY');
  });
  test('general cleared does NOT override an active clinician restriction', () => {
    const r = svc.evaluate(mk({ surgeries: SX({ general: 'cleared' }), restrictions: RESTR }), A('outdoor_walk'), M);
    expect(r.decision).toBe('BLOCK_ACTIVITY');
  });
  test('general cleared does NOT override the surgery\'s own clinicianRestrictions', () => {
    const sx = [{ procedureCategory: 'orthopedic', status: 'recovering', clinicianRestrictions: ['weight_bearing_lower'], activityClearance: { general: 'cleared' } }];
    expect(svc.evaluate(mk({ surgeries: sx }), A('outdoor_walk'), M).decision).toBe('BLOCK_ACTIVITY');
  });
  test('general cleared does NOT suppress urgent escalation', () => {
    const r = svc.evaluate(mk({ surgeries: SX({ general: 'cleared' }), symptomReports: [{ status: 'active', symptoms: ['chest_pain'] }] }), A('outdoor_walk'), M);
    expect(r.decision).toBe('URGENT_ESCALATION');
  });
  test('general cleared does NOT clear environmental deferral', () => {
    const r = svc.evaluate(mk({ surgeries: SX({ general: 'cleared' }) }), A('outdoor_run'), HOT);
    expect(r.decision).not.toBe('ALLOW');
  });
  test('activity-specific restricted beats general cleared', () => {
    const r = svc.evaluate(mk({ surgeries: SX({ general: 'cleared', outdoor_walk: 'restricted' }) }), A('outdoor_walk'), M);
    expect(r.decision).toBe('BLOCK_ACTIVITY');
  });
  test('activity-specific cleared does NOT clear an unrelated restriction', () => {
    const r = svc.evaluate(mk({ surgeries: SX({ outdoor_walk: 'cleared' }), restrictions: RESTR }), A('outdoor_walk'), M);
    expect(r.decision).toBe('BLOCK_ACTIVITY');
  });
  test('expired clearance is ignored — NCR resumes', () => {
    const ac = { entries: [{ scope: 'general', status: 'cleared', expiresAt: '2020-01-01' }] };
    expect(svc.evaluate(mk({ surgeries: SX(ac) }), A('outdoor_run'), M).decision).toBe('NEEDS_CLINICAL_REVIEW');
  });
  test('not-yet-effective clearance treated as absent', () => {
    const ac = { entries: [{ scope: 'general', status: 'cleared', effectiveAt: '2999-01-01' }] };
    expect(svc.evaluate(mk({ surgeries: SX(ac) }), A('outdoor_run'), M).decision).toBe('NEEDS_CLINICAL_REVIEW');
  });
  test('entries-array shape resolves activity-specific + general', () => {
    const ac = { entries: [{ activityId: 'outdoor_walk', status: 'cleared', effectiveAt: '2020-01-01', documentedBy: 'dr-x' }, { scope: 'general', status: 'restricted' }] };
    const walk = svc.evaluate(mk({ surgeries: SX(ac) }), A('outdoor_walk'), M);
    const run = svc.evaluate(mk({ surgeries: SX(ac) }), A('outdoor_run'), M);
    expect(walk.decision).toBe('ALLOW');      // specific cleared beats general restricted
    expect(run.decision).toBe('BLOCK_ACTIVITY'); // general restricted applies
    expect(walk.dimensions.functional.clearances[0]).toMatchObject({ status: 'cleared', scope: 'activity', activityId: 'outdoor_walk' });
  });
  test('clearance provenance is surfaced on the dimension', () => {
    const r = svc.evaluate(mk({ surgeries: SX({ general: 'cleared' }) }), A('outdoor_walk'), M);
    const c = r.dimensions.functional.clearances;
    expect(c && c[0]).toMatchObject({ status: 'cleared', scope: 'general' });
  });
});
