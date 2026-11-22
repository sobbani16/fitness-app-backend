jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const { getSleepRecoverySummary } = require('../src/services/sleepRecovery');

const mkLog = (h, wakeH = 7) => {
  const end = new Date(Date.now() - wakeH * 3600000 * Math.random() * 0.1);
  return { sleepStart: new Date(end.getTime() - h * 3600000), sleepEnd: end, hoursSlept: h, source: 'app' };
};

function fakeDb({ logs = [], energyLevel = null, goal = 8 } = {}) {
  getPrisma.mockReturnValue({
    sleepLog: { findMany: jest.fn(async () => logs) },
    checkIn: { findFirst: jest.fn(async () => (energyLevel == null ? null : { energyLevel, createdAt: new Date() })) },
    user: { findUnique: jest.fn(async () => ({ sleepGoalHours: goal })) },
  });
}

describe('sleep/recovery intelligence', () => {
  test('no data → completeness none, no signals, honest note', async () => {
    fakeDb({});
    const r = await getSleepRecoverySummary('u1');
    expect(r.completeness).toBe('none');
    expect(r.signals).toEqual([]);
    expect(r.suggestion).toBeNull();
    expect(r.note).toMatch(/not clinical/i);
  });

  test('3+ short nights → lighter_intensity with evidence', async () => {
    fakeDb({ logs: [mkLog(5), mkLog(5.5), mkLog(5.2), mkLog(5.8)] });
    const r = await getSleepRecoverySummary('u1');
    expect(r.avgHours).toBeLessThan(6);
    expect(r.signals.find(s => s.key === 'short_sleep')).toBeTruthy();
    expect(r.suggestion).toBe('lighter_intensity');
    expect(r.completeness).toBe('partial');
  });

  test('adequate sleep, no check-in → no suggestion', async () => {
    fakeDb({ logs: [mkLog(7.5), mkLog(8), mkLog(7.8)] });
    const r = await getSleepRecoverySummary('u1');
    expect(r.suggestion).toBeNull();
  });

  test('low check-in energy alone triggers lighter_intensity', async () => {
    fakeDb({ energyLevel: 2 });
    const r = await getSleepRecoverySummary('u1');
    expect(r.signals.find(s => s.key === 'low_energy')).toBeTruthy();
    expect(r.suggestion).toBe('lighter_intensity');
    expect(r.completeness).toBe('none'); // energy flag works without sleep data
  });
});
