// Health priorities engine — deterministic rules, suppression, feedback.
jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const { getTodayActions, recordFeedback, VALID_VERDICTS } = require('../src/services/todayActions');

function fakeDb(overrides = {}) {
  const db = {
    user: { findUnique: jest.fn(async () => ({ id: 'u1', goalType: 'muscle', timeZone: 'UTC' })) },
    trainerClient: { findFirst: jest.fn(async () => null) },
    foodLog: { findMany: jest.fn(async () => []) },
    waterLog: { aggregate: jest.fn(async () => ({ _sum: { amountMl: 300 } })) },
    healthEnergyRecord: { findFirst: jest.fn(async () => null) },
    userWorkoutPlan: { findFirst: jest.fn(async () => null) },
    checkIn: { findUnique: jest.fn(async () => null) },
    actionFeedback: { findMany: jest.fn(async () => []), create: jest.fn(async () => ({})) },
  };
  Object.assign(db, overrides);
  getPrisma.mockReturnValue(db);
  return db;
}

describe('health priorities engine', () => {
  test('returns versioned contract, ≤3 actions, honest shape', async () => {
    fakeDb();
    const res = await getTodayActions('u1', 'UTC');
    expect(res.version).toBe('today-actions-v1');
    expect(res.actions.length).toBeLessThanOrEqual(3);
    for (const a of res.actions) {
      expect(a.title).toBeTruthy();
      expect(a.action).toBeTruthy();
      expect(['high', 'partial', 'low']).toContain(a.confidence);
      expect(Array.isArray(a.evidence)).toBe(true);
    }
  });

  test('confirmed plan surfaces "continue workout" action', async () => {
    fakeDb({ userWorkoutPlan: { findFirst: jest.fn(async () => ({ version: 3 })) } });
    const res = await getTodayActions('u1', 'UTC');
    const w = res.actions.find(a => a.actionKey === 'start_workout');
    expect(w).toBeTruthy();
    expect(w.evidence[0]).toMatch(/v3/);
  });

  test('active trainer + missing weekly check-in surfaces check-in action', async () => {
    fakeDb({ trainerClient: { findFirst: jest.fn(async () => ({ id: 'rel1' })) } });
    const res = await getTodayActions('u1', 'UTC');
    expect(res.actions.find(a => a.actionKey === 'weekly_checkin')).toBeTruthy();
  });

  test('check-in already submitted → no check-in action', async () => {
    fakeDb({
      trainerClient: { findFirst: jest.fn(async () => ({ id: 'rel1' })) },
      checkIn: { findUnique: jest.fn(async () => ({ id: 'c1' })) },
    });
    const res = await getTodayActions('u1', 'UTC');
    expect(res.actions.find(a => a.actionKey === 'weekly_checkin')).toBeUndefined();
  });

  test('3 dismissals in 14d suppress the action kind', async () => {
    const db = fakeDb({
      trainerClient: { findFirst: jest.fn(async () => ({ id: 'rel1' })) },
      actionFeedback: {
        findMany: jest.fn(async () => [{ actionKey: 'weekly_checkin' }, { actionKey: 'weekly_checkin' }, { actionKey: 'weekly_checkin' }]),
        create: jest.fn(async () => ({})),
      },
    });
    const res = await getTodayActions('u1', 'UTC');
    expect(res.actions.find(a => a.actionKey === 'weekly_checkin')).toBeUndefined();
    expect(db.actionFeedback.findMany).toHaveBeenCalled();
  });

  test('missing data yields empty/partial, never fabricated actions', async () => {
    fakeDb();
    const res = await getTodayActions('u1', 'UTC');
    // No trainer, no plan, no wearable → no trainer/plan/wearable actions regardless of time of day.
    for (const k of ['start_workout', 'weekly_checkin', 'sync_wearable']) {
      expect(res.actions.find(a => a.actionKey === k)).toBeUndefined();
    }
  });

  test('feedback validates verdict and records', async () => {
    const db = fakeDb();
    await expect(recordFeedback('u1', 'choose_meal', 'bogus')).rejects.toMatchObject({ status: 400 });
    await recordFeedback('u1', 'choose_meal', 'helpful');
    expect(db.actionFeedback.create).toHaveBeenCalledWith({ data: { userId: 'u1', actionKey: 'choose_meal', verdict: 'helpful' } });
    expect(VALID_VERDICTS.has('discuss_trainer')).toBe(true);
  });
});
