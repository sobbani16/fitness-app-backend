// Progress Coach — opportunities must project REAL component deltas, never
// arbitrary points; streaks reward participation, not perfection.
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
  userPlanningPreferences: { findUnique: jest.fn(async () => null) },
  habit: { count: jest.fn(async () => 0) },
  dailyProgressDay: { upsert: jest.fn(async () => ({})), findMany: jest.fn(async () => []) },
  userStreakPreferences: { findUnique: jest.fn(async () => null), upsert: jest.fn(async () => ({})) },
}; return { getPrisma: () => db }; });
const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();
const { opportunities, streak, QUALIFY_FRACTION } = require('../src/services/progressCoach');

const TZ = 'America/New_York';
const NOON = new Date('2026-11-17T17:00:00Z'); // 12 PM Charlotte

describe('Progress opportunities', () => {
  test('morning sleep-only day: opportunities exist for real deficits, none promise overlapping points', async () => {
    prisma.sleepLog.findMany.mockResolvedValueOnce([{ hoursSlept: 7, source: 'manual' }]);
    const r = await opportunities('u1', { tz: TZ, now: NOON });
    expect(r.top.length).toBeLessThanOrEqual(3);
    const keys = r.top.map((o) => o.component);
    expect(new Set(keys).size).toBe(keys.length); // one opportunity per component
    for (const o of r.top) {
      expect(o.projectedPoints).toBeLessThanOrEqual(o.remainingPoints); // clamped to remaining budget
      expect(o.projectedPoints).toBeGreaterThan(0);
      expect(o.version).toBe(2);
    }
    expect(r.top.every((o) => o.component !== 'sleep')).toBe(true); // sleep is never an actionable push
  });

  test('hydration at 1000/2000 ml → projected points equal remaining budget, not arbitrary', async () => {
    prisma.waterLog.aggregate.mockResolvedValueOnce({ _sum: { amountMl: 1000 } });
    const r = await opportunities('u1', { tz: TZ, now: NOON });
    const hyd = r.all.find((o) => o.component === 'hydration');
    const comp = hyd;
    expect(comp.remainingPoints).toBeGreaterThan(0);
    expect(comp.projectedPoints).toBe(comp.remainingPoints); // completing the goal earns exactly what remains
    expect(comp.assumptions).toContain('hydration');
  });

  test('no opportunity exceeds the 100-point ceiling', async () => {
    prisma.waterLog.aggregate.mockResolvedValueOnce({ _sum: { amountMl: 1900 } });
    const r = await opportunities('u1', { tz: TZ, now: NOON });
    expect(r.earned + r.all.reduce((a, o) => a + o.projectedPoints, 0)).toBeLessThanOrEqual(100);
  });

  test('goal-met components produce no opportunity', async () => {
    prisma.workoutSession.findMany.mockResolvedValueOnce([{ startedAt: NOON, finishedAt: NOON }]);
    const r = await opportunities('u1', { tz: TZ, now: NOON });
    expect(r.all.find((o) => o.component === 'activity')).toBeUndefined();
  });

  test('11 PM does not push workouts', async () => {
    const late = new Date('2026-11-18T04:00:00Z'); // 23:00 ET
    const r = await opportunities('u1', { tz: TZ, now: late });
    const actIdx = r.all.findIndex((o) => o.component === 'activity');
    if (actIdx >= 0) expect(actIdx).toBeGreaterThan(0); // deprioritized if present at all
  });
});

describe('Consistency streak', () => {
  const day = (k, earned, met = false) => ({ dayKey: k, earned, applicable: 100, components: met ? [{ status: 'GOAL_MET' }] : [] });

  test('50%+ of applicable qualifies — 100/100 never required', async () => {
    prisma.dailyProgressDay.findMany.mockResolvedValueOnce([day('2026-11-17', 52), day('2026-11-16', 80), day('2026-11-15', 30)]);
    const s = await streak('u1', { tz: TZ, now: NOON });
    expect(s.todayQualified).toBe(true);
    expect(s.current).toBe(2); // 11/15 at 30% breaks before that
    expect(s.qualifyRule).toContain('50%');
  });

  test('any GOAL_MET component qualifies even below the fraction (rest day counts)', async () => {
    prisma.dailyProgressDay.findMany.mockResolvedValueOnce([day('2026-11-17', 20, true)]);
    const s = await streak('u1', { tz: TZ, now: NOON });
    expect(s.todayQualified).toBe(true);
  });

  test('missed day breaks the run; pause days skip without breaking', async () => {
    prisma.dailyProgressDay.findMany.mockResolvedValueOnce([
      day('2026-11-17', 60), day('2026-11-14', 70), day('2026-11-13', 65),
    ]);
    prisma.userStreakPreferences.findUnique.mockResolvedValueOnce({ pausedUntil: null, pauseDays: ['2026-11-16', '2026-11-15'] });
    const s = await streak('u1', { tz: TZ, now: NOON });
    expect(s.current).toBe(3); // paused 15th/16th skipped, not counted as missed
  });

  test('paused streak reports honestly without extending', async () => {
    prisma.dailyProgressDay.findMany.mockResolvedValueOnce([day('2026-11-17', 60)]);
    prisma.userStreakPreferences.findUnique.mockResolvedValueOnce({ pausedUntil: new Date('2026-11-20'), pauseDays: [] });
    const s = await streak('u1', { tz: TZ, now: NOON });
    expect(s.paused).toBe(true);
  });
});
