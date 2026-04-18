const {
  calculateBMR,
  calculateTDEE,
  targetCalories,
  computeDailyBalance,
} = require('../src/services/calorieEngine');

describe('calorieEngine', () => {
  describe('calculateBMR', () => {
    it('computes Mifflin-St Jeor for male', () => {
      // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
      expect(calculateBMR({ sex: 'male', weightKg: 80, heightCm: 180, age: 30 })).toBe(1780);
    });
    it('computes Mifflin-St Jeor for female', () => {
      // 10*60 + 6.25*165 - 5*25 - 161 = 600 + 1031.25 - 125 - 161 = 1345.25
      expect(calculateBMR({ sex: 'female', weightKg: 60, heightCm: 165, age: 25 })).toBeCloseTo(1345.25, 2);
    });
    it('throws on non-positive inputs', () => {
      expect(() => calculateBMR({ sex: 'male', weightKg: 0, heightCm: 170, age: 30 })).toThrow();
      expect(() => calculateBMR({ sex: 'male', weightKg: 70, heightCm: -1, age: 30 })).toThrow();
    });
  });

  describe('calculateTDEE', () => {
    it('multiplies by activity factor', () => {
      expect(calculateTDEE(2000, 'sedentary')).toBeCloseTo(2400, 5);
      expect(calculateTDEE(2000, 'moderate')).toBeCloseTo(3100, 5);
    });
    it('defaults to sedentary', () => {
      expect(calculateTDEE(2000)).toBeCloseTo(2400, 5);
    });
    it('throws on unknown activity', () => {
      expect(() => calculateTDEE(2000, 'bogus')).toThrow();
    });
  });

  describe('targetCalories', () => {
    it('applies goal adjustment', () => {
      expect(targetCalories(2500, 'lose')).toBe(2000);
      expect(targetCalories(2500, 'maintain')).toBe(2500);
      expect(targetCalories(2500, 'gain')).toBe(3000);
    });
    it('throws on unknown goal', () => {
      expect(() => targetCalories(2500, 'bulk')).toThrow();
    });
  });

  describe('computeDailyBalance', () => {
    it('reports surplus when intake > target', () => {
      const b = computeDailyBalance({ caloriesIn: 2700, caloriesBurnedExercise: 0, tdee: 2400, goal: 'maintain' });
      expect(b.target).toBe(2400);
      expect(b.net).toBe(2700);
      expect(b.surplus).toBe(300);
      expect(b.status).toBe('surplus');
    });
    it('reports deficit when intake < target', () => {
      const b = computeDailyBalance({ caloriesIn: 1800, caloriesBurnedExercise: 100, tdee: 2400, goal: 'maintain' });
      expect(b.surplus).toBe(-700);
      expect(b.status).toBe('deficit');
    });
    it('reports on_target exactly', () => {
      const b = computeDailyBalance({ caloriesIn: 2400, caloriesBurnedExercise: 0, tdee: 2400, goal: 'maintain' });
      expect(b.surplus).toBe(0);
      expect(b.status).toBe('on_target');
    });
    it('uses adjusted target for lose goal', () => {
      const b = computeDailyBalance({ caloriesIn: 2000, caloriesBurnedExercise: 0, tdee: 2400, goal: 'lose' });
      // target 1900, net 2000 -> surplus 100
      expect(b.target).toBe(1900);
      expect(b.surplus).toBe(100);
    });
    it('throws on invalid inputs', () => {
      expect(() => computeDailyBalance({ caloriesIn: -1, tdee: 2000, goal: 'maintain' })).toThrow();
      expect(() => computeDailyBalance({ caloriesIn: 2000, tdee: 0, goal: 'maintain' })).toThrow();
    });
  });
});
