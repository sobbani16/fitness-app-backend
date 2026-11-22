// Sprint A capability-integration tests — verifies the capability functions
// are actually consumed by production paths (not just unit-tested in a vacuum).
const express = require('express');
const request = require('supertest');

const mockPrisma = {
  $transaction: jest.fn(async fn => fn(mockPrisma)),
  $queryRaw: jest.fn(),
  user: { findUnique: jest.fn(), update: jest.fn() },
  weightEntry: { create: jest.fn() },
  macroGoal: { findUnique: jest.fn(), upsert: jest.fn() },
  goalHistory: { updateMany: jest.fn(), create: jest.fn(), findMany: jest.fn() },
  foodLog: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../src/services/nutrients/foodIntelligence', () => ({ safe: async (fn) => { try { return await fn(); } catch { return null; } }, ingredient: async () => ({ ok: true }), profilesForIngredient: async () => [] }));

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.userId = 'u-1'; next(); });
app.use('/me/profile', require('../src/routes/profile'));
app.use('/food-logs', require('../src/routes/foodLogs'));
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

const baseProfile = { name: 'Alex', sex: 'other', age: 30, heightCm: 175, weightKg: 70, activityLevel: 'moderate', goal: 'maintenance', units: 'metric' };

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue({ profileData: baseProfile, goalType: 'maintenance', currentWeightKg: 70 });
  mockPrisma.macroGoal.findUnique.mockResolvedValue({ source: 'default', caloriesTarget: 2200 });
  mockPrisma.foodLog.findUnique.mockResolvedValue(null);
  mockPrisma.foodLog.findFirst.mockResolvedValue(null);
  mockPrisma.foodLog.create.mockImplementation(async ({ data }) => ({ id: data.id, userId: data.userId, ...data }));
});

describe('A10 — planGoalSwitch wired into PUT /me/profile', () => {
  it('records GoalHistory on a real goal change and reports it', async () => {
    const res = await request(app).put('/me/profile').send({ ...baseProfile, goal: 'muscle_gain' });
    expect(res.status).toBe(200);
    expect(res.body.goalChange).toEqual({ previousGoal: 'maintenance', activeGoal: 'muscle_gain', historyPreserved: true });
    expect(mockPrisma.goalHistory.updateMany).toHaveBeenCalledWith({ where: { userId: 'u-1', endedAt: null }, data: { endedAt: expect.any(Date) } });
    expect(mockPrisma.goalHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'u-1', goal: 'muscle_gain', targetsSnapshot: expect.objectContaining({ previousGoal: 'maintenance' }) }) });
  });

  it('unchanged goal writes no history row', async () => {
    const res = await request(app).put('/me/profile').send(baseProfile);
    expect(res.status).toBe(200);
    expect(res.body.goalChange).toBeNull();
    expect(mockPrisma.goalHistory.create).not.toHaveBeenCalled();
  });

  it('legacy alias maps canonical before switch (maintain → maintenance → no change)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ profileData: baseProfile, goalType: 'maintenance' });
    const res = await request(app).put('/me/profile').send({ ...baseProfile, goal: 'maintain' });
    expect(res.status).toBe(200);
    expect(res.body.goalChange).toBeNull();
  });
});

describe('K08 — detectDuplicateLog wired into POST /food-logs', () => {
  const logBody = { id: 'meal-1', foodName: 'Chicken rice bowl', quantityG: 300, calories: 500, proteinG: 30, carbsG: 60, fatG: 15, loggedAt: new Date().toISOString() };

  it('same-name log inside 30min → advisory duplicateWarning, both kept', async () => {
    mockPrisma.foodLog.findFirst.mockResolvedValue({ id: 'prior-1', foodName: 'Chicken rice bowl', loggedAt: new Date(), nutritionSnapshot: {} });
    const res = await request(app).post('/food-logs').send(logBody);
    expect(res.status).toBe(201);
    expect(res.body.duplicateWarning).toEqual(expect.objectContaining({ possibleDuplicate: true, basis: 'same_name', existingId: 'prior-1' }));
    expect(mockPrisma.foodLog.create).toHaveBeenCalled(); // never deleted/blocked
    expect(mockPrisma.foodLog.create.mock.calls[0][0].data.nutritionSnapshot.possibleDuplicateOf.foodLogId).toBe('prior-1');
  });

  it('different-name log → no warning', async () => {
    mockPrisma.foodLog.findFirst.mockResolvedValue({ id: 'prior-1', foodName: 'Oatmeal', loggedAt: new Date(), nutritionSnapshot: {} });
    const res = await request(app).post('/food-logs').send(logBody);
    expect(res.status).toBe(201);
    expect(res.body.duplicateWarning).toBeNull();
  });
});
