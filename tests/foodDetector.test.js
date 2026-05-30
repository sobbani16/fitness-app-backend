const { detectFood } = require('../src/services/foodDetector');

describe('foodDetector.detectFood', () => {
  it('matches known food from description', () => {
    const r = detectFood({ description: 'grilled chicken with rice' });
    expect(r.foodName).toMatch(/chicken/i);
    expect(r.caloriesPer100g).toBeGreaterThan(0);
    expect(r.suggestedPortionGrams).toBeGreaterThan(0);
    expect(r.estimatedCalories).toBeGreaterThan(0);
    expect(r.source).toBe('matched from description');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('computes calories consistent with caloriesPer100g and portion', () => {
    const r = detectFood({ description: 'pizza' });
    const expected = Math.round((r.caloriesPer100g * r.suggestedPortionGrams) / 100);
    expect(r.estimatedCalories).toBe(expected);
  });

  it('falls back to meal type when description missing', () => {
    const r = detectFood({ mealType: 'snack' });
    expect(r.foodName).toMatch(/snack/i);
    expect(r.source).toBe('estimated from meal type (snack)');
    expect(r.confidence).toBeLessThan(0.5);
  });

  it('returns macrosPer100g structure', () => {
    const r = detectFood({ description: 'steak' });
    expect(r.macrosPer100g).toEqual(expect.objectContaining({
      protein_g: expect.any(Number),
      carbs_g: expect.any(Number),
      fat_g: expect.any(Number),
    }));
  });

  it('accepts empty input', () => {
    const r = detectFood({});
    expect(r.estimatedCalories).toBeGreaterThan(0);
    expect(r.foodName).toBeTruthy();
  });

  it('surfaces hasPhoto flag', () => {
    expect(detectFood({ hasPhoto: true }).hasPhoto).toBe(true);
    expect(detectFood({ hasPhoto: false }).hasPhoto).toBe(false);
  });
});
