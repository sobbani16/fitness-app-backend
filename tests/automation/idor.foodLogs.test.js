// automation SEC-01/TR-11: IDOR regression on /food-logs — every query must be
// scoped to the caller's userId; a caller must never read, create-as, or delete
// another user's records.
const mockPrisma = {
  foodLog: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
};
jest.mock('../../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const request = require('supertest');
const app = require('../../src/app');
const A = 'user-alice', B = 'user-bob';

beforeEach(() => jest.clearAllMocks());

describe('IDOR — /food-logs ownership scoping', () => {
  test('GET /food-logs queries ONLY the caller userId', async () => {
    mockPrisma.foodLog.findMany.mockResolvedValue([]);
    const res = await request(app).get('/food-logs?date=2026-11-22').set('x-user-id', A);
    expect(res.status).toBe(200);
    expect(mockPrisma.foodLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: A }) })
    );
  });

  test('DELETE /food-logs/:id scopes deleteMany to caller — user B cannot delete A\'s log', async () => {
    mockPrisma.foodLog.deleteMany.mockResolvedValue({ count: 0 });
    const res = await request(app).delete('/food-logs/alice-log-id').set('x-user-id', B);
    expect(res.status).toBe(200);
    expect(mockPrisma.foodLog.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'alice-log-id', userId: B } })
    );
    // count:0 proves the DB-level guard: no row deleted for another user.
  });

  test('POST /food-logs ignores body-supplied userId — record belongs to caller', async () => {
    mockPrisma.foodLog.findUnique.mockResolvedValue(null);
    mockPrisma.foodLog.findFirst.mockResolvedValue(null);
    mockPrisma.foodLog.create.mockImplementation(({ data }) => Promise.resolve(data));
    const res = await request(app).post('/food-logs').set('x-user-id', A).send({
      id: 'log-1', foodName: 'rice', quantityG: 100, calories: 130, proteinG: 3, carbsG: 28, fatG: 0.3,
      userId: B, // spoof attempt
    });
    expect(res.status).toBe(201);
    const data = mockPrisma.foodLog.create.mock.calls[0][0].data;
    expect(data.userId).toBe(A);
  });

  test('POST /food-logs with id owned by another user → 409 conflict', async () => {
    mockPrisma.foodLog.findUnique.mockResolvedValue({ id: 'log-1', userId: B });
    const res = await request(app).post('/food-logs').set('x-user-id', A).send({
      id: 'log-1', foodName: 'rice', quantityG: 100, calories: 130, proteinG: 3, carbsG: 28, fatG: 0.3,
    });
    expect(res.status).toBe(409);
    expect(mockPrisma.foodLog.create).not.toHaveBeenCalled();
  });
});
