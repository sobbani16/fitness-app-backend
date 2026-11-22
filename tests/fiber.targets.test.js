// Fiber target resolution — deterministic rules over age/sex/calorie/condition
// inputs. Core invariants: minors never get the adult formula; clinician and
// custom overrides always win and keep provenance; restricting conditions
// produce a conservative reference + review flag, never a silent prescription.
const { resolveFiberTarget, ageFrom } = require('../src/services/fiber/targets');
const { suggestFoods, FIBER_FOODS } = require('../src/services/fiber/suggestions');

const ADULT_DOB = new Date(Date.now() - 30 * 365.25 * 86400000);
const goal = (over = {}) => ({ fiberTarget: 30, caloriesTarget: 2000, ...over });

describe('fiber/targets.resolveFiberTarget', () => {
  it('applies ~14 g/1,000 kcal to the adult calorie target', () => {
    const r = resolveFiberTarget({ dateOfBirth: ADULT_DOB, gender: 'female', macroGoal: goal() });
    expect(r.targetG).toBe(28);
    expect(r.basis).toBe('formula_adult');
    expect(r.reference.calorieBasis).toBe(2000);
    expect(r.reviewRequired).toBe(false);
  });

  it('scales with the calorie target, not a fixed 30', () => {
    expect(resolveFiberTarget({ dateOfBirth: ADULT_DOB, macroGoal: goal({ caloriesTarget: 1500 }) }).targetG).toBe(21);
    expect(resolveFiberTarget({ dateOfBirth: ADULT_DOB, macroGoal: goal({ caloriesTarget: 3000 }) }).targetG).toBe(42);
  });

  it('never applies the adult formula to minors — IOM AI table instead', () => {
    const dob10 = new Date(Date.now() - 10 * 365.25 * 86400000);
    expect(resolveFiberTarget({ dateOfBirth: dob10, gender: 'male', macroGoal: goal() }).targetG).toBe(31);
    expect(resolveFiberTarget({ dateOfBirth: dob10, gender: 'female', macroGoal: goal() }).targetG).toBe(26);
    const dob16 = new Date(Date.now() - 16 * 365.25 * 86400000);
    expect(resolveFiberTarget({ dateOfBirth: dob16, gender: 'male', macroGoal: goal() }).targetG).toBe(38);
    const dob6 = new Date(Date.now() - 6 * 365.25 * 86400000);
    const r = resolveFiberTarget({ dateOfBirth: dob6, gender: 'female', macroGoal: goal() });
    expect(r.targetG).toBe(25);
    expect(r.basis).toBe('reference_minor');
  });

  it('uses IOM AI for pregnancy and lactation', () => {
    expect(resolveFiberTarget({ gender: 'female', conditionNames: ['Pregnancy'], macroGoal: goal() }).targetG).toBe(28);
    expect(resolveFiberTarget({ gender: 'female', conditionNames: ['Breastfeeding'], macroGoal: goal() }).targetG).toBe(29);
  });

  it('flags restricting GI conditions for professional review', () => {
    for (const c of ['Bowel obstruction', 'Crohn disease', 'Gastroparesis', 'Diverticulitis', 'low-residue diet post-op']) {
      const r = resolveFiberTarget({ dateOfBirth: ADULT_DOB, conditionNames: [c], macroGoal: goal() });
      expect(r.reviewRequired).toBe(true);
      expect(r.basis).toBe('restricted_reference');
      expect(r.targetG).toBe(14); // conservative reference — not the stored default
      expect(r.restrictions.length).toBeGreaterThan(0);
    }
  });

  it('clinician override wins over everything and keeps provenance', () => {
    const r = resolveFiberTarget({ dateOfBirth: ADULT_DOB, conditionNames: ['Crohn disease'], macroGoal: goal({ fiberTarget: 15, fiberTargetBasis: 'clinician', fiberTargetNote: 'low-residue per GI' }) });
    expect(r.targetG).toBe(15);
    expect(r.basis).toBe('clinician');
    expect(r.reference.note).toBe('low-residue per GI');
  });

  it('custom user override wins over the formula', () => {
    const r = resolveFiberTarget({ dateOfBirth: ADULT_DOB, macroGoal: goal({ fiberTarget: 35, fiberTargetBasis: 'custom' }) });
    expect(r.targetG).toBe(35);
    expect(r.basis).toBe('custom');
  });

  it('legacy non-default stored values report unknown provenance', () => {
    const r = resolveFiberTarget({ dateOfBirth: ADULT_DOB, macroGoal: goal({ fiberTarget: 33 }) });
    expect(r.targetG).toBe(33);
    expect(r.basis).toBe('stored_unknown');
  });

  it('falls back to adult AI when no calorie target exists', () => {
    const r = resolveFiberTarget({ dateOfBirth: ADULT_DOB, gender: 'female', macroGoal: { fiberTarget: 30 } });
    expect(r.targetG).toBe(25);
    expect(r.basis).toBe('reference_adult_ai');
  });

  it('falls back to the static default when nothing is known', () => {
    const r = resolveFiberTarget({});
    expect(r.targetG).toBe(30);
    expect(r.basis).toBe('default');
  });
});

describe('fiber/targets.ageFrom', () => {
  it('computes age and rejects impossible values', () => {
    expect(ageFrom(new Date(Date.now() - 30 * 365.25 * 86400000))).toBeGreaterThanOrEqual(29);
    expect(ageFrom(null)).toBeNull();
    expect(ageFrom(new Date('invalid'))).toBeNull();
    expect(ageFrom(new Date(Date.now() + 86400000))).toBeNull(); // future
  });
});

describe('fiber/suggestions.suggestFoods', () => {
  it('returns realistic servings with fiber values', () => {
    const s = suggestFoods({ gapG: 10 });
    expect(s.length).toBeGreaterThan(0);
    for (const f of s) {
      expect(f.serving).toBeTruthy();
      expect(f.approxFiberG).toBeGreaterThan(0);
    }
  });

  it('excludes allergen-matching foods', () => {
    const s = suggestFoods({ gapG: 10, allergenTerms: new Set(['tree nut']) });
    expect(s.some((f) => /almond/.test(f.food))).toBe(false);
  });

  it('excludes user-disliked / never-recommend foods', () => {
    const s = suggestFoods({ gapG: 10, avoidNames: new Set(['broccoli']) });
    expect(s.some((f) => /broccoli/.test(f.food))).toBe(false);
  });

  it('prefers non-starchy vegetables when sequencing-first is requested', () => {
    const s = suggestFoods({ gapG: 10, preferSequencingFirst: true });
    expect(s[0].classes).toContain('non_starchy_veg');
  });

  it('every catalog entry is a real food with a plausible serving (no supplement sneak-in)', () => {
    for (const f of FIBER_FOODS) {
      expect(f.name).not.toMatch(/psyllium|isabgol|metamucil|supplement|powder/i);
      expect(f.serving).toMatch(/\d/);
    }
  });
});
