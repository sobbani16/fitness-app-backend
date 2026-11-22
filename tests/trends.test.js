// Sprint A trend service — coverage honesty, missing≠zero, smoothing, goals.
const mockPrisma = {
  foodLog: { findMany: jest.fn() },
  weightEntry: { findMany: jest.fn() },
  workoutSession: { findMany: jest.fn() },
  dailySteps: { findMany: jest.fn() },
  macroGoal: { findUnique: jest.fn() },
  goalHistory: { findMany: jest.fn() },
  user: { findUnique: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
const { getTrends } = require('../src/services/trends');

const day = (n) => new Date(Date.now() - n * 86400000);

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of ['foodLog', 'weightEntry', 'workoutSession', 'dailySteps']) mockPrisma[k].findMany.mockResolvedValue([]);
  mockPrisma.macroGoal.findUnique.mockResolvedValue(null);
  mockPrisma.goalHistory.findMany.mockResolvedValue([]);
  mockPrisma.user.findUnique.mockResolvedValue({ goalType: 'weight_loss' });
});

test('insufficient state when window has no records — never zero-filled', async () => {
  const t = await getTrends('u1', { days: 14 });
  expect(t.state).toBe('insufficient');
  expect(t.energy.state).toBe('insufficient');
  expect(t.energy.avgDailyKcal).toBeUndefined();
  expect(t.weight.state).toBe('insufficient');
});

test('missing days are unknown, not zero — averages only over logged days', async () => {
  mockPrisma.foodLog.findMany.mockResolvedValue([
    { loggedAt: day(1), calories: 2000, proteinG: 100, carbsG: 200, fatG: 70, fiberG: 25 },
    { loggedAt: day(1), calories: 400, proteinG: 20, carbsG: 40, fatG: 15, fiberG: 5 },
    { loggedAt: day(3), calories: 1800, proteinG: null, carbsG: 190, fatG: 60, fiberG: 20 },
  ]);
  mockPrisma.macroGoal.findUnique.mockResolvedValue({ caloriesTarget: 2100, proteinTarget: 100, carbsTarget: 220, fatTarget: 70, fiberTarget: 30 });
  const t = await getTrends('u1', { days: 7 });
  expect(t.energy.avgDailyKcal).toBe(2100);          // (2400+1800)/2 logged days
  expect(t.energy.loggedDays).toBe(2);
  expect(t.energy.adherencePct).toBe(100);
  expect(t.energy.incompleteLogDays).toBe(1);          // fiberG null day
  expect(t.coverage.foodLoggedDays).toBe(2);
});

test('weight trend uses 3-pt smoothing and is honest about scope', async () => {
  mockPrisma.weightEntry.findMany.mockResolvedValue([
    { recordedAt: day(20), weightKg: 80 }, { recordedAt: day(13), weightKg: 79.5 },
    { recordedAt: day(6), weightKg: 79 }, { recordedAt: day(1), weightKg: 78.6 },
  ]);
  const t = await getTrends('u1', { days: 30 });
  expect(t.weight.state).toBe('ok');
  expect(t.weight.deltaKg).toBeCloseTo(-1.0, 1);
  expect(t.weight.note).toMatch(/not a measure of fat loss/i);
  expect(t.progress.goalProgress).toBe('progressing'); // weight_loss + down
});

test('goal changes in window are reported with preserved history flag', async () => {
  mockPrisma.weightEntry.findMany.mockResolvedValue([{ recordedAt: day(5), weightKg: 80 }, { recordedAt: day(2), weightKg: 80 }, { recordedAt: new Date(), weightKg: 80 }]);
  mockPrisma.goalHistory.findMany.mockResolvedValue([
    { goal: 'weight_loss', startedAt: day(40), endedAt: day(5), targetsSnapshot: { caloriesTarget: 1800 } },
    { goal: 'maintenance', startedAt: day(5), endedAt: null, targetsSnapshot: { caloriesTarget: 2200 } },
  ]);
  mockPrisma.user.findUnique.mockResolvedValue({ goalType: 'maintenance' });
  const t = await getTrends('u1', { days: 14 });
  expect(t.goal.current).toBe('maintenance');
  expect(t.goal.changesInWindow.length).toBe(1);
  expect(t.goal.changesInWindow[0].goal).toBe('maintenance');
  expect(t.progress.goalProgress).toBe('progressing'); // stable vs stable
});

test('activity summarizes counts only — no invented calorie credit', async () => {
  mockPrisma.workoutSession.findMany.mockResolvedValue([
    { startedAt: day(1), workoutType: 'strength', durationMinutes: 45 },
    { startedAt: day(3), workoutType: 'run', durationMinutes: 30 },
  ]);
  mockPrisma.dailySteps.findMany.mockResolvedValue([{ date: day(1), steps: 8000 }, { date: day(2), steps: 6000 }]);
  const t = await getTrends('u1', { days: 7 });
  expect(t.activity.workoutsPerWeek).toBe(2);
  expect(t.activity.avgDailySteps).toBe(7000);
  expect(t.activeKcalNotes[0]).toMatch(/session_count_only/);
});

test('provenance + timezone labels are always present', async () => {
  const t = await getTrends('u1', { days: 7, tz: 'Asia/Kolkata' });
  expect(t.timezone).toBe('Asia/Kolkata');
  expect(t.provenance.meals).toMatch(/FoodLog/);
});
