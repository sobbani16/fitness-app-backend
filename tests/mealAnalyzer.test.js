const { analyzeMeal } = require('../src/services/mealAnalyzer');

describe('mealAnalyzer', () => {
  it('matches known food from description', () => {
    const r = analyzeMeal({ description: 'I had a cheeseburger' });
    expect(r.name).toBe('Cheeseburger');
    expect(r.calories).toBe(720);
    expect(r.macros).toEqual({ protein_g: 35, carbs_g: 50, fat_g: 40 });
    expect(r.source).toMatch(/matched/);
  });

  it('is case-insensitive', () => {
    const r = analyzeMeal({ description: 'PIZZA night' });
    expect(r.name).toBe('Pizza (2 slices)');
  });

  it('falls back to meal type when no match', () => {
    const r = analyzeMeal({ description: 'weird thing', mealType: 'breakfast' });
    expect(r.calories).toBe(400);
    expect(r.source).toMatch(/breakfast/);
  });

  it('falls back to lunch when no description and no type', () => {
    const r = analyzeMeal({});
    expect(r.calories).toBe(650);
  });

  it('includes feedback string', () => {
    const r = analyzeMeal({ description: 'apple' });
    expect(typeof r.feedback).toBe('string');
    expect(r.feedback.length).toBeGreaterThan(0);
  });

  it('returns different feedback bands by calories', () => {
    const big = analyzeMeal({ description: 'steak' }).feedback;
    const small = analyzeMeal({ description: 'apple' }).feedback;
    expect(big).not.toBe(small);
  });

  it('preserves hasPhoto flag', () => {
    const r = analyzeMeal({ description: 'salad', hasPhoto: true });
    expect(r.hasPhoto).toBe(true);
  });
});
