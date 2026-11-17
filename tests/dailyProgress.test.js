jest.mock('../src/lib/prisma', () => { const db = {
  user: { findUnique: jest.fn(async () => ({ timeZone: 'America/New_York', waterGoalMl: null })) },
  foodLog: { findMany: jest.fn(async () => []) },
  waterLog: { aggregate: jest.fn(async () => ({ _sum: { amountMl: 0 } })) },
  dailySteps: { findFirst: jest.fn(async () => null) },
  workoutSession: { findMany: jest.fn(async () => []) },
  sleepLog: { findMany: jest.fn(async () => []) },
  habitCompletion: { findMany: jest.fn(async () => []) },
  reminderCategorySetting: { findMany: jest.fn(async () => []) },
  macroGoal: { findUnique: jest.fn(async () => null) },
  habit: { count: jest.fn(async () => 0) },
  dailyProgressDay: { upsert: jest.fn(async () => ({})) },
}; return { getPrisma: () => db }; });
const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();
const { computeDay } = require('../src/services/dailyProgress');

const TZ = 'America/New_York';
const MORNING = new Date('2026-11-17T11:30:00Z'); // 6:30 AM Charlotte

describe('Daily Progress V2', () => {
  test('morning after wake: sleep only → small score, never 91', async () => {
    prisma.sleepLog.findMany.mockResolvedValueOnce([{ hoursSlept: 7.2, source: 'apple_health' }]);
    const r = await computeDay('u1', { tz: TZ, now: MORNING, persist: false });
    expect(r.earned).toBeLessThanOrEqual(20); // sleep ≈13.5 of 15; unearned components anchor the rest
    expect(r.earned).toBeGreaterThanOrEqual(10);
    const sleep = r.components.find((c) => c.key === 'sleep');
    expect(sleep.status).toBe('IN_PROGRESS');
    const nut = r.components.find((c) => c.key === 'nutrition');
    expect(['INSUFFICIENT_DATA', 'NOT_STARTED']).toContain(nut.status); // never "failed"
    expect(r.components.find((c) => c.key === 'habits').status).toBe('NOT_APPLICABLE'); // no habits configured
  });

  test('sleep-only day can never reach a near-perfect score', async () => {
    prisma.sleepLog.findMany.mockResolvedValueOnce([{ hoursSlept: 9, source: 'manual' }]);
    const r = await computeDay('u1', { tz: TZ, now: MORNING, persist: false });
    expect(r.earned).toBeLessThanOrEqual(25);
  });

  test('earned never exceeds 100; inapplicable weight redistributes', async () => {
    prisma.foodLog.findMany.mockResolvedValueOnce([{ calories: 600, mealType: 'breakfast', loggedAt: MORNING }]);
    prisma.waterLog.aggregate.mockResolvedValueOnce({ _sum: { amountMl: 2500 } });
    prisma.dailySteps.findFirst.mockResolvedValueOnce({ steps: 9000 });
    prisma.sleepLog.findMany.mockResolvedValueOnce([{ hoursSlept: 8, source: 'manual' }]);
    const r = await computeDay('u1', { tz: TZ, now: MORNING, persist: false });
    expect(r.earned).toBeLessThanOrEqual(100);
    const total = r.components.reduce((a, c) => a + c.applicable, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  test('missing data ≠ zero/failed: no-data day shows INSUFFICIENT_DATA, earned 0', async () => {
    const r = await computeDay('u1', { tz: TZ, now: MORNING, persist: false });
    expect(r.earned).toBe(0);
    expect(r.components.every((c) => ['INSUFFICIENT_DATA', 'NOT_STARTED', 'NOT_APPLICABLE'].includes(c.status))).toBe(true);
  });

  test('meals are not marked failed before their local time', async () => {
    const r = await computeDay('u1', { tz: TZ, now: MORNING, persist: false });
    const nut = r.components.find((c) => c.key === 'nutrition');
    expect(nut.dueMeals).not.toContain('lunch'); // 6:30 AM — lunch isn't due
    expect(nut.dueMeals).not.toContain('dinner');
  });

  test('snapshot persists version + dayKey idempotently', async () => {
    await computeDay('u1', { tz: TZ, now: MORNING });
    expect(prisma.dailyProgressDay.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_dayKey: { userId: 'u1', dayKey: '2026-11-17' } },
    }));
  });

  test('Charlotte vs Dallas: same instant yields the correct local day', async () => {
    const late = new Date('2026-11-17T05:30:00Z'); // 00:30 CLT Tue / 23:30 DAL Mon
    const a = await computeDay('u1', { tz: 'America/New_York', now: late, persist: false });
    const b = await computeDay('u1', { tz: 'America/Chicago', now: late, persist: false });
    expect(a.dayKey).toBe('2026-11-17');
    expect(b.dayKey).toBe('2026-11-16');
  });
});
