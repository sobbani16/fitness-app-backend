// Trainer partnership mode (M17) — coaching preference + trainer-plan
// precedence in daily actions. Trainer plans surface with attribution and
// are never silently replaced by AI/self plans.
jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const { getTodayActions } = require('../src/services/todayActions');
const partnership = require('../src/services/partnership');

const TRAINER_REL = { id: 'rel1', trainerId: 't1' };
const TRAINER_PLAN = {
  id: 'asg1',
  plan: { title: 'Coach Strength Block', version: 4, trainer: { displayName: 'Coach Kim' } },
};

function fakeDb({ pref = null, assignment = null, selfPlan = null, hasTrainer = true } = {}) {
  const prefStore = pref ? [pref] : [];
  getPrisma.mockReturnValue({
    user: { findUnique: jest.fn(async () => ({ id: 'u1', goalType: 'muscle', timeZone: 'UTC' })) },
    trainerClient: { findFirst: jest.fn(async () => (hasTrainer ? TRAINER_REL : null)) },
    foodLog: { findMany: jest.fn(async () => []) },
    waterLog: { aggregate: jest.fn(async () => ({ _sum: { amountMl: 0 } })) },
    healthEnergyRecord: { findFirst: jest.fn(async () => null) },
    userWorkoutPlan: { findFirst: jest.fn(async () => selfPlan) },
    checkIn: { findUnique: jest.fn(async () => ({ id: 'c1' })) },
    actionFeedback: { findMany: jest.fn(async () => []), create: jest.fn(async () => ({})) },
    coachingPreference: {
      findUnique: jest.fn(async () => pref),
      upsert: jest.fn(async ({ create, update }) => {
        const row = { userId: 'u1', model: 'self_guided', planPrecedence: 'trainer_first', shareInsightsWithTrainer: false, ...create, ...update };
        prefStore[0] = row;
        return row;
      }),
    },
    trainerWorkoutAssignment: { findFirst: jest.fn(async () => assignment) },
  });
  return prefStore;
}

describe('partnership mode in today actions', () => {
  test('trainer_led + assigned trainer plan → trainer action with attribution', async () => {
    fakeDb({ pref: { model: 'trainer_led', planPrecedence: 'trainer_first' }, assignment: TRAINER_PLAN, selfPlan: { version: 2 } });
    const res = await getTodayActions('u1', 'UTC');
    const a = res.actions.find(x => x.actionKey === 'start_workout');
    expect(a.title).toMatch(/Coach Strength Block/);
    expect(a.attribution).toBe('trainer');
    expect(a.action.route).toBe('MyWorkoutPlans');
    expect(res.coachingModel).toBe('trainer_led');
  });

  test('trainer_led + no trainer plan → workout action suppressed, never substituted', async () => {
    fakeDb({ pref: { model: 'trainer_led', planPrecedence: 'trainer_first' }, assignment: null, selfPlan: { version: 2 } });
    const res = await getTodayActions('u1', 'UTC');
    expect(res.actions.find(x => x.actionKey === 'start_workout')).toBeUndefined();
  });

  test('hybrid + trainer_first → trainer plan leads', async () => {
    fakeDb({ pref: { model: 'hybrid', planPrecedence: 'trainer_first' }, assignment: TRAINER_PLAN, selfPlan: { version: 2 } });
    const res = await getTodayActions('u1', 'UTC');
    expect(res.actions.find(x => x.actionKey === 'start_workout')?.attribution).toBe('trainer');
  });

  test('hybrid + humai_first → own plan leads, trainer plan is not injected', async () => {
    fakeDb({ pref: { model: 'hybrid', planPrecedence: 'humai_first' }, assignment: TRAINER_PLAN, selfPlan: { version: 2 } });
    const res = await getTodayActions('u1', 'UTC');
    const a = res.actions.find(x => x.actionKey === 'start_workout');
    expect(a.attribution).toBe('humai');
    expect(a.evidence[0]).toMatch(/v2/);
  });

  test('self_guided → unchanged behavior even with a trainer assignment', async () => {
    fakeDb({ pref: { model: 'self_guided' }, assignment: TRAINER_PLAN, selfPlan: { version: 2 } });
    const res = await getTodayActions('u1', 'UTC');
    expect(res.actions.find(x => x.actionKey === 'start_workout')?.attribution).toBe('humai');
  });
});

describe('coaching preference service', () => {
  test('defaults to self_guided when no row exists', async () => {
    fakeDb({ pref: null, hasTrainer: false });
    const r = await partnership.getPreference('u1');
    expect(r.model).toBe('self_guided');
    expect(r.trainerPlanFirst).toBe(false);
    expect(r.hasActiveTrainer).toBe(false);
  });

  test('trainer_led without an active relation reports but cannot apply precedence', async () => {
    fakeDb({ pref: { model: 'trainer_led' }, hasTrainer: false });
    const r = await partnership.getPreference('u1');
    expect(r.model).toBe('trainer_led');
    expect(r.trainerPlanFirst).toBe(false);
  });

  test('update validates model and precedence', async () => {
    fakeDb({ pref: null });
    await expect(partnership.updatePreference('u1', { model: 'boss_mode' })).rejects.toMatchObject({ status: 400 });
    const r = await partnership.updatePreference('u1', { model: 'hybrid', planPrecedence: 'trainer_first' });
    expect(r.saved.model).toBe('hybrid');
  });
});
