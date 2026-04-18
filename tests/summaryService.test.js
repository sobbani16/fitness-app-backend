const { buildDailySummary } = require('../src/services/summaryService');

const profile = {
  sex: 'male', weightKg: 80, heightCm: 180, age: 30,
  activityLevel: 'sedentary', goal: 'maintain',
};

describe('buildDailySummary', () => {
  it('aggregates meals and returns balance + recommendation + insight', () => {
    const s = buildDailySummary({
      profile,
      meals: [
        { name: 'Oatmeal', calories: 300 },
        { name: 'Chicken', calories: 520 },
        { name: 'Apple', calories: 95 },
      ],
    });
    expect(s.bmr).toBeGreaterThan(1500);
    expect(s.tdee).toBeGreaterThan(1800);
    expect(s.balance.caloriesIn).toBe(915);
    expect(s.recommendation).toBeDefined();
    expect(typeof s.insight).toBe('string');
    expect(s.insight.length).toBeGreaterThan(0);
    expect(s.mealCount).toBe(3);
  });

  it('handles no meals', () => {
    const s = buildDailySummary({ profile, meals: [] });
    expect(s.balance.caloriesIn).toBe(0);
    expect(s.insight).toMatch(/No meals/i);
  });

  it('mentions weather in insight when provided', () => {
    const s = buildDailySummary({ profile, meals: [], weather: { condition: 'rainy' } });
    expect(s.insight).toMatch(/rainy/);
  });

  it('throws without profile', () => {
    expect(() => buildDailySummary({})).toThrow();
  });
});
