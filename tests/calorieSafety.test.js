// Fixtures for the G4 calorie-safety policy proposal (INACTIVE module).
// Each case documents expected policy behavior — none are clinical assertions.
const { calorieSafetyPolicy } = require('../src/services/calorieSafety');

describe('calorieSafetyPolicy — supervised populations never get automated floors', () => {
  test('adolescent (16y) → clinician review, no floor, no targets', () => {
    const r = calorieSafetyPolicy({ sex: 'female', weightKg: 55, heightCm: 160, ageYears: 16, goal: 'weight_loss' });
    expect(r.status).toBe('clinician_review_required');
    expect(r.floorKcal).toBeNull();
    expect(r.reviewTriggers.map(t => t.code)).toContain('under_18');
  });

  test('pregnancy → clinician review, no automated floor/deficit', () => {
    const r = calorieSafetyPolicy({ sex: 'female', weightKg: 68, heightCm: 165, ageYears: 31, flags: { pregnant: true }, goal: 'weight_loss' });
    expect(r.status).toBe('clinician_review_required');
    expect(r.floorKcal).toBeNull();
    expect(r.reviewTriggers.map(t => t.code)).toContain('pregnancy');
  });

  test('lactation → clinician review', () => {
    const r = calorieSafetyPolicy({ sex: 'female', weightKg: 68, heightCm: 165, ageYears: 31, flags: { lactating: true } });
    expect(r.reviewTriggers.map(t => t.code)).toContain('lactation');
  });

  test('eating-disorder risk flag → clinician review', () => {
    const r = calorieSafetyPolicy({ sex: 'other', weightKg: 60, heightCm: 170, ageYears: 25, flags: { eatingDisorderRisk: true } });
    expect(r.reviewTriggers.map(t => t.code)).toContain('ed_risk');
  });

  test('medically complex (CKD) → clinician review', () => {
    const r = calorieSafetyPolicy({ sex: 'male', weightKg: 80, heightCm: 178, ageYears: 54, conditionCodes: ['CKD'] });
    expect(r.status).toBe('clinician_review_required');
    expect(r.reviewTriggers.map(t => t.code)).toContain('condition:ckd');
  });

  test('older adult (72y) + low-normal BMI + weight_loss goal → review', () => {
    const r = calorieSafetyPolicy({ sex: 'male', weightKg: 60, heightCm: 172, ageYears: 72, goal: 'weight_loss' });
    expect(r.status).toBe('clinician_review_required');
    expect(r.reviewTriggers.map(t => t.code)).toContain('older_low_bmi_weight_loss');
  });
});

describe('calorieSafetyPolicy — individualized floors for eligible adults', () => {
  test('standard adult → floor = 0.8 × BMR (Mifflin–St Jeor)', () => {
    // M, 80kg, 178cm, 30y → BMR = 800+1112.5-150+5 = 1767.5 → floor ≈ 1414
    const r = calorieSafetyPolicy({ sex: 'male', weightKg: 80, heightCm: 178, ageYears: 30, activityLevel: 'moderate' });
    expect(r.status).toBe('eligible');
    expect(r.floorKcal).toBe(Math.round(0.8 * 1767.5));
    expect(r.maxDeficitKcal).toBe(Math.round(r.tdee - r.floorKcal));
    expect(r.targetEligibility).toBe('standard');
  });

  test('low-weight user → individualized floor, weight_loss triggers review if BMI < 18.5', () => {
    const under = calorieSafetyPolicy({ sex: 'female', weightKg: 40, heightCm: 170, ageYears: 28, goal: 'weight_loss' });
    expect(under.status).toBe('clinician_review_required');
    expect(under.reviewTriggers.map(t => t.code)).toContain('underweight_weight_loss');
    // Same person at maintenance goal → eligible with their own (small) floor.
    const ok = calorieSafetyPolicy({ sex: 'female', weightKg: 40, heightCm: 170, ageYears: 28, goal: 'maintain' });
    expect(ok.status).toBe('eligible');
    expect(ok.floorKcal).toBeLessThan(1000); // 0.8 × BMR(~1220) — small person, small floor, not a universal 1200
  });

  test('highly active user → floor capped at 0.8 × TDEE + fueling watch flag', () => {
    // BMR 1900 → 0.8×BMR = 1520; TDEE(1.9) = 3610 → 0.8×TDEE = 2888 → floor = min = 1520
    const r = calorieSafetyPolicy({ sex: 'male', weightKg: 90, heightCm: 185, ageYears: 27, activityLevel: 'very_active' });
    expect(r.status).toBe('eligible');
    expect(r.floorKcal).toBe(Math.round(Math.min(0.8 * r.bmr, 0.8 * r.tdee)));
    expect(r.fuelingFlags[0].code).toBe('low_energy_availability_watch');
  });

  test('weight_loss target that would dip below floor → review trigger', () => {
    // sedentary small woman: TDEE ≈ BMR×1.2; −500 deficit may breach floor
    const r = calorieSafetyPolicy({ sex: 'female', weightKg: 55, heightCm: 160, ageYears: 45, activityLevel: 'sedentary', goal: 'weight_loss' });
    const deficitTarget = r.tdee - 500;
    if (deficitTarget < r.floorKcal) {
      expect(r.status).toBe('clinician_review_required');
      expect(r.reviewTriggers.map(t => t.code)).toContain('deficit_below_floor');
    } else {
      expect(r.targetEligibility).toBe('standard');
    }
    expect(r.maxDeficitKcal).toBe(Math.round(r.tdee - r.floorKcal));
  });
});

describe('calorieSafetyPolicy — honest missing data', () => {
  test('missing anthropometrics → insufficient_data, floor null (never a universal minimum)', () => {
    for (const partial of [{}, { sex: 'male' }, { sex: 'male', weightKg: 80 }]) {
      const r = calorieSafetyPolicy(partial);
      expect(r.status).toBe('insufficient_data');
      expect(r.floorKcal).toBeNull();
    }
  });

  test('never returns a universal fixed minimum', () => {
    const small = calorieSafetyPolicy({ sex: 'female', weightKg: 42, heightCm: 150, ageYears: 60 });
    const large = calorieSafetyPolicy({ sex: 'male', weightKg: 120, heightCm: 195, ageYears: 30 });
    expect(small.floorKcal).not.toBe(large.floorKcal);
    expect(small.floorKcal).toBeLessThan(large.floorKcal);
  });
});
