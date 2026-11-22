// Sprint C ingredient-impact — portion budget + substitution policy.
const { evaluatePortion, suggestSubstitutions, CATEGORIES } = require('../src/services/ingredientImpact');

const targets = { caloriesTarget: 2000, proteinTarget: 100 };
const almonds = { foodName: 'Almonds', quantityG: 80, calories: 463, proteinG: 17, carbsG: 16, fatG: 40, fiberG: 10 };

test('large nut portion vs fat-loss target → portion dimension, never "bad food"', () => {
  const r = evaluatePortion({ meal: almonds, goal: 'fat_loss', targets, categoryId: 'nuts_seeds' });
  expect(r.portion.shareOfDailyTargetPct).toBeCloseTo(23.2, 1);
  expect(r.verdict).toBe('moderate_portion');
  expect(r.dimensions.find((d) => d.dimension === 'portion')).toBeUndefined(); // <30%
  expect(r.education.note).toMatch(/not the food/i);
  expect(r.disclaimer).toMatch(/not a food judgment/i);
});

test('40%+ share → portion dimension fires', () => {
  const r = evaluatePortion({ meal: { ...almonds, calories: 900 }, goal: 'fat_loss', targets, categoryId: 'nuts_seeds' });
  expect(r.verdict).toBe('large_portion');
  expect(r.dimensions.find((d) => d.dimension === 'portion').sharePct).toBe(45);
});

test('unknown nutrients are unverified, never zero', () => {
  const r = evaluatePortion({ meal: almonds, goal: 'maintenance', targets });
  expect(r.nutrients.addedSugarG).toBe('unverified');
  expect(r.nutrients.sodiumMg).toBe('unverified');
});

test('allergen terms block matching substitutions', () => {
  const r = suggestSubstitutions({ meal: almonds, goal: 'fat_loss', categoryId: 'nuts_seeds', allergenTerms: new Set(['peanut', 'tree nut']) });
  expect(r.substitutions.find((s) => s.item.includes('smaller'))).toBeTruthy(); // same-food portion still ok
  const r2 = suggestSubstitutions({ meal: { foodName: 'peanut butter toast', quantityG: 60 }, goal: 'muscle_gain', categoryId: null, allergenTerms: new Set(['egg']) });
  expect(r2.substitutions.find((s) => s.item.includes('eggs'))).toBeUndefined(); // egg allergy blocks egg suggestion
});

test('protein-goal shortfall → addition suggestions, screened', () => {
  const r = suggestSubstitutions({ meal: { foodName: 'toast', proteinG: 6, quantityG: 80 }, goal: 'muscle_gain', allergenTerms: new Set() });
  expect(r.substitutions.length).toBeGreaterThan(0);
  expect(r.safety.medicalConditionSwaps).toBe('not_provided_unreviewed');
});

test('taxonomy: categories carry evidence + sensitivity flags', () => {
  for (const [id, c] of Object.entries(CATEGORIES)) {
    expect(c.evidence).toBeTruthy();
    expect(typeof c.portion).toBe('boolean');
    expect(id).toMatch(/^[a-z_]+$/);
  }
});

const { classifyFood } = require('../src/services/ingredientImpact');

test('classifyFood: almonds → nuts_seeds + calorie_dense, NOT cooking_fat', () => {
  const c = classifyFood({ name: 'Almonds, dry roasted', per100: { calories: 598, proteinG: 21, fatG: 52, fiberG: 12 } });
  expect(c.categories).toContain('nuts_seeds');
  expect(c.categories).toContain('calorie_dense');
  expect(c.categories).not.toContain('cooking_fat');
  expect(c.categories).not.toContain('legumes_soy');
  expect(c.state).toBe('DERIVED_FROM_VERIFIED_DATA');
});

test('classifyFood: ghee → cooking_fat via pure-fat band', () => {
  const c = classifyFood({ name: 'Ghee', per100: { calories: 900, proteinG: 0, fatG: 100, fiberG: 0 } });
  expect(c.categories).toContain('cooking_fat');
});

test('classifyFood: gulab jamun → ESTIMATED (name hint only, composition unverified)', () => {
  const c = classifyFood({ name: 'Gulab jamun', per100: { calories: 350, proteinG: 5, fatG: 12 } });
  expect(c.categories).toEqual(['indian_sweets_fried']);
  expect(c.state).toBe('ESTIMATED');
});

test('classifyFood: empty data → UNKNOWN, never fabricated labels', () => {
  const c = classifyFood({ name: 'Mystery item', per100: {} });
  expect(c.state).toBe('UNKNOWN');
  expect(c.categories).toEqual([]);
});

test('classifyFood: white rice → refined_carb but never "unhealthy"', () => {
  const c = classifyFood({ name: 'White rice, cooked', per100: { calories: 130, proteinG: 2.7, fatG: 0.3 } });
  expect(c.categories).toContain('refined_carb');
  expect(c.note).toMatch(/never a health verdict/);
});
