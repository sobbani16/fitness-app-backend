const { buildProgress, progressRange } = require('../src/services/progressService');
const range = () => progressRange({ from: '2026-03-07', to: '2026-03-09', timeZone: 'America/New_York' });
it('preserves missing values versus explicit zero and unknown fiber', () => {
  const entries = buildProgress(range(), { meals: [
    { loggedAt: '2026-03-08T14:00:00Z', calories: 100, proteinG: 0, carbsG: 20, fatG: 1, fiberG: null },
    { loggedAt: '2026-03-08T15:00:00Z', calories: 50, proteinG: 0, carbsG: 10, fatG: 0, fiberG: 2 },
  ], water: [{ loggedAt: '2026-03-08T14:00:00Z', amountMl: 0 }] });
  expect(entries[0]).toMatchObject({ calories: null, protein: null, waterMl: null, steps: null });
  expect(entries[1]).toMatchObject({ calories: 150, protein: 0, fiber: null, waterMl: 0, mealCount: 2 });
});
it('uses local dates across DST and the latest daily weight, with no carry-forward', () => {
  const entries = buildProgress(range(), { weights: [
    { recordedAt: '2026-03-08T04:30:00Z', weightKg: 75 },
    { recordedAt: '2026-03-08T05:30:00Z', weightKg: 74 },
    { recordedAt: '2026-03-09T03:30:00Z', weightKg: 73 },
  ], workouts: [{ startedAt: '2026-03-09T03:30:00Z' }], steps: [{ date: '2026-03-08T00:00:00Z', steps: 100 }, { date: '2026-03-08T00:00:00Z', steps: 200 }] });
  expect(entries.map(e => e.weightKg)).toEqual([75, 73, null]);
  expect(entries[1]).toMatchObject({ steps: 200, workouts: 1 });
});
it('rejects invalid dates, zones, reversed and oversized ranges', () => {
  for (const query of [{ from: '2026-02-30', to: '2026-03-01' }, { from: '2026-03-09', to: '2026-03-07' }, { from: '2025-01-01', to: '2026-01-01' }, { from: '2026-01-01', to: '2026-01-02', timeZone: 'bogus' }]) expect(() => progressRange(query)).toThrow();
  expect(progressRange({ from: '2026-01-01', to: '2026-06-29' }).count).toBe(180);
});
