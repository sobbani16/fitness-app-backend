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

  test('water logged but no meals: hydration earns, nutrition stays honest', async () => {
    prisma.waterLog.aggregate.mockResolvedValueOnce({ _sum: { amountMl: 1500 } });
    const r = await computeDay('u1', { tz: TZ, now: MORNING, persist: false });
    const hyd = r.components.find((c) => c.key === 'hydration');
    expect(hyd.earned).toBeGreaterThan(0);
    expect(r.earned).toBeLessThan(50); // water alone can't dominate the day
  });

  test('finished workout before lunch fulfills activity without gaming nutrition', async () => {
    prisma.workoutSession.findMany.mockResolvedValueOnce([{ startedAt: MORNING, finishedAt: MORNING }]);
    const r = await computeDay('u1', { tz: TZ, now: MORNING, persist: false });
    expect(r.components.find((c) => c.key === 'activity').status).toBe('GOAL_MET');
    expect(['INSUFFICIENT_DATA', 'NOT_STARTED']).toContain(r.components.find((c) => c.key === 'nutrition').status);
  });

  test('planned rest day fulfills activity — no workout required (A6)', async () => {
    // 2026-11-17 is a Tuesday (weekday 2)
    prisma.userPlanningPreferences.findUnique.mockResolvedValueOnce({ restDays: [2] });
    const r = await computeDay('u1', { tz: TZ, now: MORNING, persist: false });
    const act = r.components.find((c) => c.key === 'activity');
    expect(act.status).toBe('GOAL_MET');
    expect(act.restDay).toBe(true);
  });

  test('excess water and steps are capped at goal — no over-reward (A5)', async () => {
    prisma.waterLog.aggregate.mockResolvedValueOnce({ _sum: { amountMl: 9999 } });
    prisma.dailySteps.findFirst.mockResolvedValueOnce({ steps: 50000 });
    const r = await computeDay('u1', { tz: TZ, now: MORNING, persist: false });
    const hyd = r.components.find((c) => c.key === 'hydration');
    const act = r.components.find((c) => c.key === 'activity');
    expect(hyd.progress).toBe(1);
    expect(act.progress).toBe(1);
    expect(r.earned).toBeLessThanOrEqual(100);
  });

  test('late-imported sleep still attributes to the same local day', async () => {
    prisma.sleepLog.findMany.mockResolvedValueOnce([{ hoursSlept: 6.5, source: 'imported_late' }]);
    const r = await computeDay('u1', { tz: TZ, now: new Date('2026-11-17T20:00:00Z'), persist: false });
    expect(r.components.find((c) => c.key === 'sleep').earned).toBeGreaterThan(0);
    expect(r.dayKey).toBe('2026-11-17');
  });

  test('overnight workout counts on the local day it finished', async () => {
    // workout 23:00→00:30 local lands inside today's bounds via startedAt
    prisma.workoutSession.findMany.mockResolvedValueOnce([{ startedAt: new Date('2026-11-17T04:00:00Z'), finishedAt: new Date('2026-11-17T05:30:00Z') }]);
    const r = await computeDay('u1', { tz: TZ, now: MORNING, persist: false });
    expect(r.components.find((c) => c.key === 'activity').status).toBe('GOAL_MET');
  });

  test('food logged but no sleep: nutrition earns, sleep is INSUFFICIENT_DATA', async () => {
    prisma.foodLog.findMany.mockResolvedValueOnce([{ calories: 500, mealType: 'breakfast', loggedAt: MORNING }]);
    const r = await computeDay('u1', { tz: TZ, now: MORNING, persist: false });
    expect(r.components.find((c) => c.key === 'nutrition').earned).toBeGreaterThan(0);
    expect(r.components.find((c) => c.key === 'sleep').status).toBe('INSUFFICIENT_DATA');
  });
});

describe('Workstream H — calorie coverage accuracy', () => {
  const AFTER_END = new Date('2026-11-19T02:00:00Z'); // 9pm next day — day 11/17 over, all meals due
  const withLogs = (logs) => {
    prisma.foodLog.findMany.mockResolvedValueOnce(logs.map((l, i) => ({ mealType: ['breakfast','lunch','dinner'][i % 3], loggedAt: MORNING, ...l })));
    prisma.macroGoal.findUnique.mockResolvedValueOnce({ caloriesTarget: 2000, proteinTarget: null, fiberTarget: null, waterMlTarget: null });
  };
  const nutOf = (r) => r.components.find((c) => c.key === 'nutrition');
  const snap = (unknowns, calculated) => ({ nutrientUnknowns: unknowns, calculated: calculated || null });

  test('mixed intake — measured subtotal is labeled as such, never as the full total', async () => {
    withLogs([
      { calories: 600, nutritionSnapshot: null }, // legacy snapshot-less — measured
      { calories: 0, nutritionSnapshot: snap(['calories']) }, // unknown calories stored as 0
    ]);
    const r = await computeDay('u1', { tz: TZ, now: MORNING, persist: false });
    const n = nutOf(r);
    expect(n.calorieCoverage.state).toBe('partial');
    expect(n.calorieCoverage.measuredKcal).toBe(600);
    expect(n.calorieCoverage.unknownLogs).toBe(1);
    expect(n.note).toMatch(/subtotal/);
    expect(n.note).not.toMatch(/^2 logged · 600 kcal$/);
  });

  test('all-unknown intake — calorie intake reported as unknown', async () => {
    withLogs([
      { calories: 0, nutritionSnapshot: snap(['calories']) },
      { calories: 0, nutritionSnapshot: snap(['calories']) },
    ]);
    const r = await computeDay('u1', { tz: TZ, now: MORNING, persist: false });
    const n = nutOf(r);
    expect(n.calorieCoverage.state).toBe('unknown');
    expect(n.note).toMatch(/calorie intake unknown/);
  });

  test('incomplete intake CANNOT earn the end-of-day calorie adjustment', async () => {
    // measured 1900 of 2000 goal would earn the adjustment if complete — but
    // one log's calories are unknown, so coverage is partial and no adjustment.
    withLogs([
      { calories: 1900, nutritionSnapshot: null },
      { calories: 0, nutritionSnapshot: snap(['calories']) },
    ]);
    const complete = await computeDay('u1', { tz: TZ, dayKeyStr: '2026-11-17', now: AFTER_END, persist: false });
    const nutPartial = nutOf(complete);
    expect(nutPartial.calorieCoverage.state).toBe('partial');
    expect(nutPartial.progress).toBeLessThan(1); // no GOAL_MET through the back door
  });

  test('complete intake — end-of-day adjustment unchanged (regression)', async () => {
    withLogs([
      { calories: 1000, nutritionSnapshot: null },
      { calories: 900, nutritionSnapshot: snap([]) }, // explicit zero unknowns
    ]);
    const r = await computeDay('u1', { tz: TZ, dayKeyStr: '2026-11-17', now: AFTER_END, persist: false });
    const n = nutOf(r);
    expect(n.calorieCoverage.state).toBe('complete');
    expect(n.progress).toBe(1); // 1900 within ±20% of 2000 — adjustment applies
    expect(n.status).toBe('GOAL_MET');
  });

  test('measured zero is preserved as measured — not reclassified unknown', async () => {
    withLogs([{ calories: 0, nutritionSnapshot: snap([]) }]); // explicit no-unknowns: the 0 is measured
    const r = await computeDay('u1', { tz: TZ, now: MORNING, persist: false });
    const n = nutOf(r);
    expect(n.calorieCoverage.state).toBe('complete');
    expect(n.calorieCoverage.measuredKcal).toBe(0);
  });

  test('snapshot-less legacy gram logs count as measured (behavior preserved)', async () => {
    withLogs([{ calories: 450, nutritionSnapshot: undefined }]);
    const r = await computeDay('u1', { tz: TZ, now: MORNING, persist: false });
    expect(nutOf(r).calorieCoverage.state).toBe('complete');
  });
});
