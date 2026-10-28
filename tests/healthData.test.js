const { dedupe, freshStatus, SOURCE_PRIORITY } = require('../src/services/healthData');
const day = iso => new Date(iso);

describe('health data normalization', () => {
  it('dedupes same-day metrics by source priority', () => {
    const rows = [
      { date: day('2026-10-26'), steps: 100, source: 'app' },
      { date: day('2026-10-26'), steps: 9000, source: 'fitbit' },
      { date: day('2026-10-25'), steps: 5000, source: 'app' },
    ];
    const out = dedupe(rows, r => r.date.toISOString().slice(0, 10), r => r.source);
    expect(out).toHaveLength(2);
    expect(out.find(r => r.date.toISOString().startsWith('2026-10-26')).steps).toBe(9000); // fitbit wins, not summed
  });
  it('never sums overlapping sources', () => {
    const rows = [{ date: '2026-10-26', source: 'fitbit', steps: 5000 }, { date: '2026-10-26', source: 'apple-health', steps: 5100 }];
    const out = dedupe(rows, r => r.date, r => r.source);
    expect(out).toHaveLength(1); // equal priority -> last wins, never 10100
  });
  it('flags freshness correctly', () => {
    const now = day('2026-10-27T20:00:00Z');
    expect(freshStatus(null, 24, now)).toBe('no_data');
    expect(freshStatus(day('2026-10-27T10:00:00Z'), 24, now)).toBe('fresh');
    expect(freshStatus(day('2026-10-25T10:00:00Z'), 24, now)).toBe('stale');
    // zero is a real measurement, distinct from missing
    expect(freshStatus(day('2026-10-27T19:00:00Z'), 24, now)).toBe('fresh');
  });
  it('source priority order is documented and wearable-first', () => {
    expect(SOURCE_PRIORITY.fitbit).toBeGreaterThan(SOURCE_PRIORITY.app);
    expect(SOURCE_PRIORITY['apple-health']).toBeGreaterThan(SOURCE_PRIORITY.app);
  });
});
