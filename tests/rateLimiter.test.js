const { createDailyLimiter } = require('../src/services/rateLimiter');

describe('rateLimiter', () => {
  it('allows up to limit then blocks', () => {
    const l = createDailyLimiter({ limit: 3 });
    expect(l.consume('u1').allowed).toBe(true);
    expect(l.consume('u1').allowed).toBe(true);
    expect(l.consume('u1').allowed).toBe(true);
    const blocked = l.consume('u1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('tracks users separately', () => {
    const l = createDailyLimiter({ limit: 1 });
    expect(l.consume('a').allowed).toBe(true);
    expect(l.consume('b').allowed).toBe(true);
    expect(l.consume('a').allowed).toBe(false);
  });

  it('resets on new day', () => {
    let now = new Date('2025-01-01T10:00:00Z');
    const l = createDailyLimiter({ limit: 1, clock: () => now });
    expect(l.consume('u').allowed).toBe(true);
    expect(l.consume('u').allowed).toBe(false);
    now = new Date('2025-01-02T10:00:00Z');
    expect(l.consume('u').allowed).toBe(true);
  });

  it('status reflects count', () => {
    const l = createDailyLimiter({ limit: 5 });
    l.consume('u');
    l.consume('u');
    expect(l.status('u')).toEqual({ limit: 5, used: 2, remaining: 3 });
  });
});
