const { suggestNext, missedSessionNote, PROGRESSION_VERSION } = require('../src/services/workoutProgression');

const S = (reps, weightLbs, extra = {}) => ({ sets: reps.map(r => ({ reps: r, weightLbs })), ...extra });

describe('suggestNext', () => {
  it('maintains with no history', () => {
    expect(suggestNext('squat', []).direction).toBe('maintain');
  });
  it('never increases after a single session', () => {
    const r = suggestNext('squat', [S([10, 10], 100, { rir: 5 })]);
    expect(r.direction).toBe('maintain');
    expect(r.reason).toMatch(/at least 2/);
  });
  it('suggests a small increase with consistent comfortable history', () => {
    const h = [S([10, 10], 100), S([10, 10], 100, { rir: 3 })];
    const r = suggestNext('squat', h);
    expect(r.direction).toBe('increase');
    expect(r.suggested.weightLbs).toBeLessThanOrEqual(110); // ≤10% ceiling
    expect(r.suggested.weightLbs).toBeGreaterThan(100);
  });
  it('suggests +1 rep when no load is used', () => {
    const r = suggestNext('push-up', [S([10, 8], 0), S([12, 10], 0, { rir: 4 })]);
    expect(r.direction).toBe('increase');
    expect(r.suggested.addReps).toBe(1);
  });
  it('reduces on discomfort — always', () => {
    const h = [S([10, 10], 100), S([10, 10], 100, { rir: 5, discomfort: true })];
    const r = suggestNext('squat', h);
    expect(r.direction).toBe('reduce');
    expect(r.suggested.weightLbs).toBeLessThan(100);
  });
  it('reduces when volume drops sharply', () => {
    const h = [S([10, 10], 100), S([4, 3], 100)];
    expect(suggestNext('squat', h).direction).toBe('reduce');
  });
  it('gentle-intensity users never get increases', () => {
    const h = [S([10, 10], 100), S([12, 12], 100, { rir: 5 })];
    expect(suggestNext('squat', h, { intensity: 'gentle' }).direction).toBe('maintain');
  });
  it('tight RIR does not trigger increase', () => {
    const h = [S([10, 10], 100), S([10, 10], 100, { rir: 0 })];
    expect(suggestNext('squat', h).direction).toBe('maintain');
  });
  it('is versioned and deterministic', () => {
    const h = [S([10, 10], 100), S([10, 10], 100, { rir: 3 })];
    expect(suggestNext('squat', h)).toEqual(suggestNext('squat', h));
    expect(PROGRESSION_VERSION).toMatch(/^progression\.v\d+$/);
  });
});

describe('missedSessionNote', () => {
  it('no note with zero misses', () => expect(missedSessionNote(0)).toBeNull());
  it('gentle note for one miss', () => expect(missedSessionNote(1)).toMatch(/continue as planned/));
  it('no catch-up pressure after multiple misses', () => expect(missedSessionNote(3)).toMatch(/no need to catch up/i));
});
