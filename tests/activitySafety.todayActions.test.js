// todayActions safety gate — workout nudges must not bypass the engine.
const mockPrisma = {
  user: { findUnique: jest.fn(async () => ({ id: 'u1', goalType: 'fitness', timeZone: 'UTC', activityLevel: 'moderate' })) },
  trainerClient: { findFirst: jest.fn(async () => null) },
  foodLog: { findMany: jest.fn(async () => []) },
  waterLog: { aggregate: jest.fn(async () => ({ _sum: { amountMl: 0 } })) },
  healthEnergyRecord: { findFirst: jest.fn(async () => null) },
  userWorkoutPlan: { findFirst: jest.fn(async () => ({ version: 3 })) },
  actionFeedback: { findMany: jest.fn(async () => []), create: jest.fn(async () => ({})) },
  userActivityProfile: { findUnique: jest.fn(async () => null) },
  userInjury: { findMany: jest.fn(async () => []) },
  userSurgery: { findMany: jest.fn(async () => []) },
  userActivityRestriction: { findMany: jest.fn(async () => []) },
  userSymptomReport: { findMany: jest.fn(async () => []) },
  userHealthCondition: { findMany: jest.fn(async () => []) },
  activitySafetyRule: { findMany: jest.fn(async () => []) },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../src/services/sleepRecovery', () => ({ getSleepRecoverySummary: jest.fn(async () => null) }));
jest.mock('../src/services/gutHealth', () => ({ getGutHealthSummary: jest.fn(async () => null) }));
jest.mock('../src/services/habits', () => ({ listHabits: jest.fn(async () => ({ habits: [] })) }));

const { getTodayActions } = require('../src/services/todayActions');

describe('todayActions × activity safety gate', () => {
  test('urgent symptom → start_workout suppressed, safety_check surfaces first', async () => {
    mockPrisma.userSymptomReport.findMany.mockResolvedValueOnce([{
      id: 's1', symptoms: ['chest_pain'], status: 'active', reportedAt: new Date(),
    }]);
    const out = await getTodayActions('u1', 'UTC');
    expect(out.actions.some(a => a.actionKey === 'start_workout')).toBe(false);
    expect(out.actions[0].actionKey).toBe('safety_check');
    expect(out.actions[0].title).toMatch(/symptom/i);
  });

  test('documented restriction → workout nudges suppressed', async () => {
    mockPrisma.userActivityRestriction.findMany.mockResolvedValueOnce([{
      id: 'r1', categories: ['weight_bearing_lower', 'lower_limb_load', 'upper_limb_load', 'trunk_load'],
      severity: 'prohibited', status: 'active', source: 'clinician_documented', updatedAt: new Date(),
    }]);
    const out = await getTodayActions('u1', 'UTC');
    expect(out.actions.some(a => a.actionKey === 'start_workout')).toBe(false);
    expect(out.actions.some(a => a.actionKey === 'safety_check')).toBe(true);
  });

  test('clean context → start_workout still surfaces', async () => {
    const out = await getTodayActions('u1', 'UTC');
    expect(out.actions.some(a => a.actionKey === 'start_workout')).toBe(true);
    expect(out.actions.some(a => a.actionKey === 'safety_check')).toBe(false);
  });
});
