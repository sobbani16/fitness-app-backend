// Engine-defect tests for published-rule trigger evaluation.
// Prior behavior: CONDITION matched on triggerValue.split('_')[0] substring
// (false positives: 'HIGH_BLOOD_PRESSURE' → 'HIGH' matched 'high cholesterol'),
// and every non-CONDITION/non-LIFE_STAGE trigger silently never fired —
// a published MEDICATION rule produced a silent "no interaction" result.
const { evalRuleTrigger } = require('../src/services/supplements/safetyEngine');

const ctx = (conditions = [], allergies = []) => ({
  conditionNames: conditions,
  allergyNames: allergies.map(a => a.toLowerCase()),
});
const rule = (triggerType, triggerValue) => ({ triggerType, triggerValue });

describe('evalRuleTrigger — CONDITION', () => {
  it('matches OR-alternatives (HEMOCHROMATOSIS_OR_IRON_OVERLOAD)', () => {
    const r = rule('CONDITION', 'HEMOCHROMATOSIS_OR_IRON_OVERLOAD');
    expect(evalRuleTrigger(r, ctx(['hemochromatosis']))).toBe(true);
    expect(evalRuleTrigger(r, ctx(['diagnosed iron overload']))).toBe(true);
    expect(evalRuleTrigger(r, ctx(['asthma']))).toBe(false);
  });
  it('strips leading qualifiers (SIGNIFICANT_KIDNEY_DISEASE matches "kidney disease")', () => {
    expect(evalRuleTrigger(rule('CONDITION', 'SIGNIFICANT_KIDNEY_DISEASE'), ctx(['kidney disease']))).toBe(true);
  });
  it('no false positive on generic tail tokens (LIVER_DISEASE ≠ heart disease)', () => {
    expect(evalRuleTrigger(rule('CONDITION', 'LIVER_DISEASE'), ctx(['heart disease']))).toBe(false);
    expect(evalRuleTrigger(rule('CONDITION', 'LIVER_DISEASE'), ctx(['fatty liver disease']))).toBe(true);
  });
  it('flat term lists match any term (PREGNANCY_THYROID_LIVER)', () => {
    const r = rule('CONDITION', 'PREGNANCY_THYROID_LIVER');
    expect(evalRuleTrigger(r, ctx(['hypothyroidism']))).toBe(true); // substring: hypothyroidism contains 'thyroid'
    expect(evalRuleTrigger(r, ctx(['thyroid nodule']))).toBe(true);
    expect(evalRuleTrigger(r, ctx(['pregnancy']))).toBe(true);
  });
});

describe('evalRuleTrigger — LIFE_STAGE / ALLERGY', () => {
  it('fires on pregnancy-adjacent conditions for all draft pregnancy values', () => {
    const c = ctx(['pregnancy (first trimester)']);
    for (const v of ['PREGNANCY', 'PREGNANCY_OR_BREASTFEEDING', 'PREGNANT_OR_TRYING']) {
      expect(evalRuleTrigger(rule('LIFE_STAGE', v), c)).toBe(true);
    }
    expect(evalRuleTrigger(rule('LIFE_STAGE', 'PREGNANCY'), ctx(['hypertension']))).toBe(false);
  });
  it('breastfeeding matches PREGNANCY_OR_BREASTFEEDING', () => {
    expect(evalRuleTrigger(rule('LIFE_STAGE', 'PREGNANCY_OR_BREASTFEEDING'), ctx(['breastfeeding']))).toBe(true);
  });
  it('unsupported LIFE_STAGE value is unevaluatable, not silently false', () => {
    expect(evalRuleTrigger(rule('LIFE_STAGE', 'ELDERLY'), ctx(['frailty']))).toBeNull();
  });
  it('ALLERGY fires on recorded allergen terms', () => {
    expect(evalRuleTrigger(rule('ALLERGY', 'FISH_SHELLFISH'), ctx([], ['shellfish']))).toBe(true);
    expect(evalRuleTrigger(rule('ALLERGY', 'FISH_SHELLFISH'), ctx([], ['peanut']))).toBe(false);
  });
});

describe('evalRuleTrigger — unsupported trigger types never silently pass', () => {
  it.each([
    'MEDICATION', 'DOSE_TOTAL', 'OTHER_SUPPLEMENT', 'LIFESTYLE', 'FOOD',
    'LAB_TEST', 'ADMINISTRATION', 'PRODUCT_QUALITY', 'PRODUCT_COMPOSITION', 'AGE_GROUP',
  ])('%s → unevaluatable (null), not a false "no interaction"', (t) => {
    expect(evalRuleTrigger(rule(t, 'ANY_VALUE'), ctx(['everything']))).toBeNull();
  });
});
