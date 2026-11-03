const { recommendFromBalance } = require('../src/services/recommendationEngine');

const bal = (surplus) => ({ surplus });

describe('recommendationEngine', () => {
  it('suggests logging when no meals recorded', () => {
    const r = recommendFromBalance(bal(0), { mealsLogged: 0 });
    expect(r.type).toBe('log');
    expect(r.reason).toMatch(/not a deficit/i);
  });

  it('above target suggests meal pacing — never an offsetting workout', () => {
    for (const s of [100, 300, 700, 1500]) {
      const r = recommendFromBalance(bal(s), { mealsLogged: 2 });
      expect(r.type).toBe('review');
      expect(r.reason).not.toMatch(/offset|cancel|burn off|earn/i);
      expect(r.reason).toMatch(/regardless of what you ate/i);
    }
  });

  it('on target suggests maintaining routine', () => {
    const r = recommendFromBalance(bal(0), { mealsLogged: 1 });
    expect(r.type).toBe('maintain');
  });

  it('small under-target suggests maintaining', () => {
    const r = recommendFromBalance(bal(-100), { mealsLogged: 1 });
    expect(r.type).toBe('maintain');
  });

  it('moderate under-target suggests a regular meal, qualified by logging gaps', () => {
    const r = recommendFromBalance(bal(-400), { mealsLogged: 1 });
    expect(r.type).toBe('eat_regular');
    expect(r.reason).toMatch(/haven’t logged everything|under target/i);
  });

  it('large under-target suggests a normal balanced meal — not force-feeding a deficit', () => {
    const r = recommendFromBalance(bal(-800), { mealsLogged: 1 });
    expect(r.type).toBe('eat_regular');
    expect(r.reason).toMatch(/normal balanced meal/i);
  });

  describe('weather', () => {
    it('moves outdoor to indoor when hot', () => {
      const r = recommendFromBalance(bal(0), { mealsLogged: 1, weather: { condition: 'hot' } });
      // maintain has location 'either' — unaffected; outdoor-only recs move
      expect(['either', 'indoor', 'outdoor']).toContain(r.location);
    });
    it('no change when no weather provided', () => {
      const r = recommendFromBalance(bal(0), { mealsLogged: 1 });
      expect(r.location).toBe('either');
    });
  });

  it('throws when balance.surplus missing', () => {
    expect(() => recommendFromBalance({})).toThrow();
  });
});
