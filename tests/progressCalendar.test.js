jest.mock('../src/lib/prisma', () => { const prefsStore = {}; const db = {
  dailyProgressDay: { findMany: jest.fn(async () => []) },
  userPlanningPreferences: {
    findUnique: jest.fn(async ({ where }) => prefsStore[where.userId] || null),
    upsert: jest.fn(async ({ where, create, update }) => { prefsStore[where.userId] = { ...(prefsStore[where.userId] || {}), ...create, ...update }; return prefsStore[where.userId]; }),
    update: jest.fn(async ({ where, data }) => { prefsStore[where.userId] = { ...(prefsStore[where.userId] || {}), ...data }; return prefsStore[where.userId]; }),
    __store: prefsStore,
  },
}; return { getPrisma: () => db }; });
const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();
const { calendar, adaptiveTarget, colorFor } = require('../src/services/progressCalendar');

const NOW = new Date('2026-11-17T15:00:00Z'); // Tue Nov 17
const row = (k, earned, target = 70, met = true) => ({ dayKey: k, earned, applicable: 100, dailyTarget: target, version: 2, components: met ? [{ status: 'GOAL_MET' }] : [{ status: 'IN_PROGRESS' }] });

describe('Leo Score Calendar', () => {
  test('renders all 30 November days incl. future days as GRAY projected', async () => {
    const r = await calendar('u1', { month: '2026-11', tz: 'America/New_York', now: NOW });
    expect(r.days).toHaveLength(30);
    expect(r.days[0].dayKey).toBe('2026-11-01');
    expect(r.days.filter(d => d.future).every(d => d.color === 'GRAY')).toBe(true);
  });

  test('colors judge each day by ITS assigned target, not today\u2019s', async () => {
    prisma.dailyProgressDay.findMany.mockResolvedValueOnce([
      row('2026-11-10', 65, 60), // 65 >= 60 → GREEN
      row('2026-11-11', 65, 75), // 65 in [60,75) → YELLOW
      row('2026-11-12', 40, 75), // 40 < 60 → RED
    ]);
    const r = await calendar('u1', { month: '2026-11', tz: 'America/New_York', now: NOW });
    expect(r.days.find(d => d.dayKey === '2026-11-10').color).toBe('GREEN');
    expect(r.days.find(d => d.dayKey === '2026-11-11').color).toBe('YELLOW');
    expect(r.days.find(d => d.dayKey === '2026-11-12').color).toBe('RED');
  });

  test('unlogged completed days are GRAY — never misread as poor health', async () => {
    const r = await calendar('u1', { month: '2026-11', tz: 'America/New_York', now: NOW });
    expect(r.days.filter(d => d.dayKey < '2026-11-17').every(d => d.color === 'GRAY')).toBe(true);
  });

  test('today is never classified red on wake', async () => {
    prisma.dailyProgressDay.findMany.mockResolvedValueOnce([row('2026-11-17', 5, 70)]);
    const r = await calendar('u1', { month: '2026-11', tz: 'America/New_York', now: NOW });
    expect(r.days.find(d => d.dayKey === '2026-11-17').color).toBe('TODAY');
  });

  test('monthly summary: earned, target-to-date vs full target, avg, met days', async () => {
    prisma.dailyProgressDay.findMany.mockResolvedValueOnce([row('2026-11-15', 80, 70), row('2026-11-16', 60, 70)]);
    const r = await calendar('u1', { month: '2026-11', tz: 'America/New_York', now: NOW });
    expect(r.summary.earned).toBe(140);
    expect(r.summary.recorded).toBe(2);
    expect(r.summary.average).toBe(70);
    expect(r.summary.monthlyTarget).toBe(30 * 70);
    expect(r.summary.targetToDate).toBe(140);
  });
});

describe('Adaptive target', () => {
  const hist = (avg, n) => Array.from({ length: n }, (_, i) => ({ dayKey: `d${i}`, earned: avg, components: [{ status: 'GOAL_MET' }] }));
  test('coverage-gated: keeps current target without enough history', () => {
    const r = adaptiveTarget(hist(80, 3), 70);
    expect(r.target).toBe(70);
    expect(r.changed).toBe(false);
    expect(r.reason).toBe('insufficient_coverage');
  });
  test('blends 0.6·avg7 + 0.4·avg30, rounds to 5, caps ±5', () => {
    const days = [...hist(85, 7), ...hist(55, 23)]; // a7=85 a30≈55+ → blended ≈64→65? delta ≤5
    const r = adaptiveTarget(days, 60);
    expect(r.target).toBeLessThanOrEqual(65);
    expect(r.target).toBeGreaterThanOrEqual(55);
    expect(Math.abs(r.target - 60)).toBeLessThanOrEqual(5);
  });
});

describe('weekly target assignment', () => {
  const userId = 'user-target-review';
  it('idempotent: second review in same ISO week is a no-op', async () => {
    const { assignWeeklyTarget } = require('../src/services/progressCalendar');
    await prisma.userPlanningPreferences.upsert({ where: { userId }, create: { userId, dailyTarget: 60 }, update: { dailyTarget: 60, targetMode: 'adaptive', targetReviewedWeek: null } });
    const now = new Date('2026-11-17T12:00:00Z');
    const first = await assignWeeklyTarget(userId, { now });
    expect(first.week).toBe('2026-W47');
    const second = await assignWeeklyTarget(userId, { now });
    expect(second.reason).toBe('already_reviewed');
    expect(second.changed).toBe(false);
  });
  it('manual mode is never overwritten by the weekly job', async () => {
    const { assignWeeklyTarget } = require('../src/services/progressCalendar');
    await prisma.userPlanningPreferences.update({ where: { userId }, data: { dailyTarget: 80, targetMode: 'manual', targetReviewedWeek: null } });
    const r = await assignWeeklyTarget(userId, { now: new Date('2026-11-24T12:00:00Z') });
    expect(r.reason).toBe('user_controlled');
    const prefs = await prisma.userPlanningPreferences.findUnique({ where: { userId } });
    expect(prefs.dailyTarget).toBe(80);
    expect(prefs.targetMode).toBe('manual');
  });
});
