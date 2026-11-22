// automation FOOD-03 / EX-04: boundary & invalid-input enforcement.
const mockPrisma = {
  foodLog: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
  workoutSession: { findUnique: jest.fn() },
  exerciseSet: { create: jest.fn() },
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
};
jest.mock('../../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const request = require('supertest');
const app = require('../../src/app');
const UID = 'boundary-user';
const post = (p, body) => request(app).post(p).set('x-user-id', UID).send(body);
const BASE_LOG = { id: 'b-1', foodName: 'rice', quantityG: 100, calories: 130, proteinG: 3, carbsG: 28, fatG: 0.4 };

beforeEach(() => jest.clearAllMocks());

describe('FOOD-03 /food-logs quantity boundaries', () => {
  test.each([
    ['quantityG', -1], ['quantityG', -0.001], ['quantityG', 100001],
    ['quantityG', NaN], ['quantityG', 'lots'], ['quantityG', null],
    ['calories', -5], ['proteinG', -1], ['carbsG', -1], ['fatG', -1], ['fiberG', -0.5],
  ])('rejects %s=%j → 400', async (field, value) => {
    const res = await post('/food-logs', { ...BASE_LOG, [field]: value });
    expect(res.status).toBe(400);
    expect(mockPrisma.foodLog.create).not.toHaveBeenCalled();
  });

  test('missing foodName → 400; missing id → 400; bad id chars → 400', async () => {
    expect((await post('/food-logs', { ...BASE_LOG, foodName: undefined })).status).toBe(400);
    expect((await post('/food-logs', { ...BASE_LOG, id: undefined })).status).toBe(400);
    expect((await post('/food-logs', { ...BASE_LOG, id: 'bad id!' })).status).toBe(400);
  });

  test('loggedAt in future → 400; loggedAt garbage → 400', async () => {
    expect((await post('/food-logs', { ...BASE_LOG, loggedAt: new Date(Date.now() + 86400000).toISOString() })).status).toBe(400);
    expect((await post('/food-logs', { ...BASE_LOG, loggedAt: 'not-a-date' })).status).toBe(400);
  });

  test('upper-bound values within limits accepted (control)', async () => {
    mockPrisma.foodLog.findUnique.mockResolvedValue(null);
    mockPrisma.foodLog.findFirst.mockResolvedValue(null);
    mockPrisma.foodLog.create.mockImplementation(({ data }) => Promise.resolve(data));
    const res = await post('/food-logs', { ...BASE_LOG, quantityG: 100000, calories: 100000 });
    expect(res.status).toBe(201);
  });
});

describe('EX-04 /exercises set boundaries', () => {
  // Test env uses the in-memory session store — create a real session first.
  let sessionId;
  beforeEach(async () => {
    require('../../src/controllers/exerciseController').store.reset?.();
    const res = await post('/exercises', { exerciseType: 'squat', sets: [{ reps: 5, weight: 50 }] });
    expect(res.status).toBe(201);
    sessionId = res.body.id;
  });

  test.each([
    ['reps', 0], ['reps', -1], ['reps', 1.5], ['reps', 1001], ['reps', 'ten'], ['reps', null],
    ['weight', -1], ['weight', 2001], ['weight', 'heavy'], ['weight', NaN],
  ])('rejects %s=%j → 400', async (field, value) => {
    const res = await post(`/exercises/${sessionId}/sets`, { reps: 10, weight: 50, [field]: value });
    expect(res.status).toBe(400);
  });

  test('boundary reps=1 and reps=1000 accepted', async () => {
    expect((await post(`/exercises/${sessionId}/sets`, { reps: 1, weight: 0 })).status).toBe(200);
    expect((await post(`/exercises/${sessionId}/sets`, { reps: 1000, weight: 2000 })).status).toBe(200);
  });

  test('non-owner session → set rejected (IDOR)', async () => {
    const res = await request(app).post(`/exercises/${sessionId}/sets`).set('x-user-id', 'other-user').send({ reps: 10, weight: 50 });
    expect(res.status).toBe(404); // session invisible to other users — not found, not theirs
  });

  test('conflicting reuse of set operation id → 409', async () => {
    const opId = 'op-12345678';
    expect((await post(`/exercises/${sessionId}/sets`, { id: opId, reps: 10, weight: 50 })).status).toBe(200);
    const replay = await post(`/exercises/${sessionId}/sets`, { id: opId, reps: 99, weight: 999 });
    expect(replay.status).toBe(409);
  });
});
