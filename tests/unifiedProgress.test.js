// Unified progress + Leo moments (M19) — deterministic, evidence-only.
jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
jest.mock('../src/services/sleepRecovery', () => ({ getSleepRecoverySummary: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const { getSleepRecoverySummary } = require('../src/services/sleepRecovery');
const { getProgress } = require('../src/services/unifiedProgress');

function fakeDb(over = {}) {
  getPrisma.mockReturnValue({
    weightEntry: { findMany: jest.fn(async () => over.weights || []) },
    workoutSession: {
      findMany: jest.fn(async () => over.sessions || []),
      findFirst: jest.fn(async () => over.firstSession ?? null),
    },
    foodLog: { groupBy: jest.fn(async () => over.foodDays || []) },
    habitCompletion: { findMany: jest.fn(async () => over.habits || []) },
    sleepLog: { findMany: jest.fn(async () => over.sleepLogs || []) },
    trainerClient: { findFirst: jest.fn(async () => over.relation ?? null) },
    checkIn: {
      findMany: jest.fn(async () => over.checkIns || []),
      findFirst: jest.fn(async () => over.firstCheckIn ?? null),
    },
    outcomePlan: { findFirst: jest.fn(async () => over.plan ?? null) },
  });
}

const daysAgo = (n, h = 10) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); d.setUTCHours(h, 0, 0, 0); return d; };
const dayStr = (n) => daysAgo(n).toISOString().slice(0, 10);

describe('unified progress', () => {
  beforeEach(() => { getSleepRecoverySummary.mockResolvedValue({ nights: 3, avgHours: 7, signals: [] }); });

  test('weekly rollup + weight trend', async () => {
    fakeDb({
      weights: [
        { weightKg: 80, recordedAt: daysAgo(30) },
        { weightKg: 78.5, recordedAt: daysAgo(2) },
      ],
      sessions: [{ startedAt: daysAgo(1), finishedAt: daysAgo(1) }, { startedAt: daysAgo(3), finishedAt: daysAgo(3) }],
      foodDays: [{ date: dayStr(0) }, { date: dayStr(1) }, { date: dayStr(2) }],
      habits: [{ day: dayStr(1), outcome: 'done' }],
    });
    const r = await getProgress('u1', { tz: 'UTC', weeks: 8 });
    expect(r.weekly).toHaveLength(8);
    const sum = (k) => r.weekly.reduce((s, w) => s + (w[k] || 0), 0);
    expect(sum('workouts')).toBe(2);
    expect(sum('loggedDays')).toBe(3);
    expect(sum('habitsDone')).toBe(1);
    expect(r.weight.deltaKg).toBe(-1.5);
    expect(r.weight.entries).toBe(2);
    expect(r.loggingStreakDays).toBe(3);
  });

  test('moments: workout PR + streak celebrate; goal_met from plan', async () => {
    fakeDb({
      sessions: [{ startedAt: daysAgo(1), finishedAt: daysAgo(1) }, { startedAt: daysAgo(2), finishedAt: daysAgo(2) }, { startedAt: daysAgo(8), finishedAt: daysAgo(8) }],
      firstSession: { startedAt: daysAgo(8) },
      foodDays: Array.from({ length: 8 }, (_, i) => ({ date: dayStr(i) })),
      relation: { id: 'rel1' },
      plan: { title: 'Q1 strength', targetDate: null, goals: [{ status: 'open' }, { status: 'met', title: 'Squat bodyweight' }] },
    });
    const r = await getProgress('u1', { tz: 'UTC', weeks: 8 });
    const keys = r.moments.map((m) => m.key);
    expect(keys).toContain('logging_streak');
    expect(keys).toContain('goal_met');
    expect(keys).toContain('first_workout');
    expect(r.leo.state).toBe('celebrate');
    expect(r.goals.met).toBe(1);
  });

  test('empty member: no moments, honest nulls, steady/encourage cue', async () => {
    getSleepRecoverySummary.mockResolvedValue({ nights: 0, avgHours: null, signals: [] });
    fakeDb({});
    const r = await getProgress('u1', { tz: 'UTC', weeks: 8 });
    expect(r.moments).toHaveLength(0);
    expect(r.weight.entries).toBe(0);
    expect(r.weight.deltaKg).toBeNull();
    expect(r.goals).toBeNull();
    expect(r.weekly.every((w) => w.workouts === 0 && w.avgSleepHours === null)).toBe(true);
    expect(r.leo.state).toBe('steady');
  });

  test('recovery signals produce encourage cue', async () => {
    getSleepRecoverySummary.mockResolvedValue({ nights: 4, avgHours: 5.2, signals: [{ key: 'short_sleep', detail: 'x' }] });
    fakeDb({});
    const r = await getProgress('u1', { tz: 'UTC', weeks: 4 });
    expect(r.leo.state).toBe('encourage');
    expect(r.leo.message).toMatch(/lighter days/i);
  });

  test('sleep_improving only when both weeks have >=3 nights', async () => {
    const mk = (n, hours) => ({ sleepStart: daysAgo(n * 24 ? n : n), sleepEnd: daysAgo(n), hoursSlept: hours });
    // this week: 3 nights @7.5h; last week: 2 nights @6h → insufficient prior data
    fakeDb({
      sleepLogs: [
        { sleepStart: daysAgo(0), sleepEnd: daysAgo(0), hoursSlept: 7.5 },
        { sleepStart: daysAgo(1), sleepEnd: daysAgo(1), hoursSlept: 7.5 },
        { sleepStart: daysAgo(2), sleepEnd: daysAgo(2), hoursSlept: 7.5 },
        { sleepStart: daysAgo(8), sleepEnd: daysAgo(8), hoursSlept: 6 },
      ],
    });
    const r = await getProgress('u1', { tz: 'UTC', weeks: 4 });
    expect(r.moments.map((m) => m.key)).not.toContain('sleep_improving');
  });
});
