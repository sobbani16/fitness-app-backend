const express = require('express');
const request = require('supertest');

const mockPrisma = {
  $transaction: jest.fn(async fn => fn(mockPrisma)),
  $queryRaw: jest.fn(),
  user: { findUnique: jest.fn(), update: jest.fn() },
  weightEntry: { create: jest.fn() },
  macroGoal: { findUnique: jest.fn(), upsert: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.userId = 'u-1'; next(); });
app.use('/me/profile', require('../src/routes/profile'));
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
const post = body => request(app).post('/me/profile/weight').send(body);

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue({ profileData: { name: 'Alex', sex: 'other', age: 30, heightCm: 175, weightKg: 70, activityLevel: 'moderate', goal: 'maintain', units: 'metric' } });
  mockPrisma.weightEntry.create.mockResolvedValue({ id: 'w-1', weightKg: 70 });
  mockPrisma.macroGoal.findUnique.mockResolvedValue({ source: 'default' });
});

describe('POST /me/profile/weight', () => {
  it('records a measurement even when the weight is unchanged', async () => {
    const res = await post({ weightKg: 70 });
    expect(res.status).toBe(201);
    expect(mockPrisma.weightEntry.create).toHaveBeenCalledWith({ data: { userId: 'u-1', weightKg: 70 } });
    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ currentWeightKg: 70 }) }));
  });

  it('preserves the stored profile while recording a new weight', async () => {
    await post({ weightKg: 75 });
    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ profileData: expect.objectContaining({ name: 'Alex', weightKg: 75 }) }),
    }));
    expect(mockPrisma.macroGoal.upsert).toHaveBeenCalled();
  });

  it('skips goal recalculation for an incomplete stored profile', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ profileData: null });
    const res = await post({ weightKg: 75 });
    expect(res.status).toBe(201);
    expect(mockPrisma.macroGoal.upsert).not.toHaveBeenCalled();
  });

  it.each([{}, { weightKg: 'abc' }, { weightKg: 5 }, { weightKg: 500 }])('rejects invalid payload %j', async body => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(mockPrisma.weightEntry.create).not.toHaveBeenCalled();
  });
});
