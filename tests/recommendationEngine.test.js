const { recommendFromBalance } = require('../src/services/recommendationEngine');

const bal = (surplus) => ({ surplus });

describe('recommendationEngine', () => {
  it('suggests 15 min walk for small surplus (+100)', () => {
    const r = recommendFromBalance(bal(100));
    expect(r.type).toBe('workout');
    expect(r.durationMin).toBe(15);
    expect(r.intensity).toBe('low');
  });

  it('suggests 25 min workout for moderate surplus (+300)', () => {
    const r = recommendFromBalance(bal(300));
    expect(r.type).toBe('workout');
    expect(r.durationMin).toBe(25);
    expect(r.intensity).toBe('moderate');
  });

  it('suggests HIIT for large surplus (+500)', () => {
    const r = recommendFromBalance(bal(500));
    expect(r.type).toBe('workout');
    expect(r.intensity).toBe('high');
    expect(r.durationMin).toBe(20);
  });

  it('suggests split workout for very large surplus (+700)', () => {
    const r = recommendFromBalance(bal(700));
    expect(r.type).toBe('workout');
    expect(r.intensity).toBe('high');
    expect(r.durationMin).toBe(45);
  });

  it('suggests maintenance on target (0)', () => {
    const r = recommendFromBalance(bal(0));
    expect(r.type).toBe('maintain');
  });

  it('suggests light mobility for small deficit (-100)', () => {
    const r = recommendFromBalance(bal(-100));
    expect(r.type).toBe('rest');
    expect(r.intensity).toBe('low');
  });

  it('suggests rest/easy for moderate deficit (-400)', () => {
    const r = recommendFromBalance(bal(-400));
    expect(r.type).toBe('rest');
  });

  it('suggests eating more for severe deficit (-800)', () => {
    const r = recommendFromBalance(bal(-800));
    expect(r.type).toBe('eat_more');
  });

  describe('weather', () => {
    it('moves outdoor to indoor when hot', () => {
      const r = recommendFromBalance(bal(100), { weather: { condition: 'hot' } });
      expect(r.location).toBe('indoor');
    });
    it('moves outdoor to indoor when rainy', () => {
      const r = recommendFromBalance(bal(100), { weather: { condition: 'rainy' } });
      expect(r.location).toBe('indoor');
    });
    it('prefers outdoor when pleasant and workout is either', () => {
      const r = recommendFromBalance(bal(300), { weather: { condition: 'pleasant' } });
      expect(r.location).toBe('outdoor');
    });
    it('no change when no weather provided', () => {
      const r = recommendFromBalance(bal(300));
      expect(r.location).toBe('either');
    });
  });

  it('throws when balance.surplus missing', () => {
    expect(() => recommendFromBalance({})).toThrow();
  });
});
