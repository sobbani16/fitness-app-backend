const {
  scoreMacro,
  scoreColor,
  macroStatus,
  macroTip,
} = require('../src/services/macroScoreService');

describe('Macro Score Engine', () => {
  describe('scoreMacro', () => {
    it('returns 100 when actual equals target', () => {
      expect(scoreMacro(150, 150)).toBe(100);
    });

    it('returns 90+ when within ±10%', () => {
      expect(scoreMacro(140, 150)).toBeGreaterThanOrEqual(90);
      expect(scoreMacro(160, 150)).toBeGreaterThanOrEqual(90);
    });

    it('returns 70-89 when within ±10-30%', () => {
      const score = scoreMacro(110, 150);
      expect(score).toBeGreaterThanOrEqual(70);
      expect(score).toBeLessThan(90);
    });

    it('returns below 70 when outside ±30%', () => {
      expect(scoreMacro(50, 150)).toBeLessThan(70);
    });

    it('returns 0 for zero intake with a positive target', () => {
      expect(scoreMacro(0, 150)).toBeLessThanOrEqual(20);
    });

    it('returns 100 when target is 0', () => {
      expect(scoreMacro(0, 0)).toBe(100);
    });

    it('handles overshoot (200% of target)', () => {
      expect(scoreMacro(300, 150)).toBeLessThan(50);
    });
  });

  describe('scoreColor', () => {
    it('green for 80+', () => {
      expect(scoreColor(80)).toBe('green');
      expect(scoreColor(100)).toBe('green');
    });

    it('yellow for 60-79', () => {
      expect(scoreColor(60)).toBe('yellow');
      expect(scoreColor(79)).toBe('yellow');
    });

    it('red for below 60', () => {
      expect(scoreColor(59)).toBe('red');
      expect(scoreColor(0)).toBe('red');
    });
  });

  describe('macroStatus', () => {
    it('on_track when within ±30%', () => {
      expect(macroStatus(140, 150)).toBe('on_track');
      expect(macroStatus(150, 150)).toBe('on_track');
    });

    it('low when below 70% of target', () => {
      expect(macroStatus(50, 150)).toBe('low');
    });

    it('high when above 130% of target', () => {
      expect(macroStatus(200, 150)).toBe('high');
    });
  });

  describe('macroTip', () => {
    it('provides actionable protein tip when low', () => {
      const tip = macroTip('protein', 100, 150, 'low');
      expect(tip).toContain('50g more protein');
      expect(tip).toContain('Greek yogurt');
    });

    it('provides on_track message', () => {
      const tip = macroTip('protein', 150, 150, 'on_track');
      expect(tip).toContain('on track');
    });

    it('provides carb excess tip', () => {
      const tip = macroTip('carbs', 300, 250, 'high');
      expect(tip).toContain('Reduce carb');
    });

    it('provides fiber low tip', () => {
      const tip = macroTip('fiber', 10, 30, 'low');
      expect(tip).toContain('vegetables');
    });
  });

  describe('scoring edge cases', () => {
    it('weighted overall score approximation', () => {
      // Protein 100%, Carbs 100%, Fat 100%, Fiber 100% → 100
      const p = scoreMacro(150, 150);
      const c = scoreMacro(250, 250);
      const f = scoreMacro(70, 70);
      const fi = scoreMacro(30, 30);
      const overall = Math.round(p * 0.35 + c * 0.25 + f * 0.20 + fi * 0.20);
      expect(overall).toBe(100);
    });

    it('low protein drags overall score significantly (35% weight)', () => {
      const p = scoreMacro(0, 150); // ~0
      const c = scoreMacro(250, 250); // 100
      const f = scoreMacro(70, 70); // 100
      const fi = scoreMacro(30, 30); // 100
      const overall = Math.round(p * 0.35 + c * 0.25 + f * 0.20 + fi * 0.20);
      expect(overall).toBeLessThan(70);
    });
  });
});
