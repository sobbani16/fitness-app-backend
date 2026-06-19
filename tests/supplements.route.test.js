const request = require('supertest');

const mockPrisma = {
  supplement: { findMany: jest.fn(), upsert: jest.fn() },
  userSupplement: { findUnique: jest.fn() },
  supplementLog: { create: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const app = require('../src/app');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /supplements', () => {
  it('returns the catalog', async () => {
    mockPrisma.supplement.findMany.mockResolvedValue([
      { id: '1', name: 'Creatine', category: 'Performance', defaultDose: '5 g', isDefault: true },
    ]);
    const res = await request(app).get('/supplements');
    expect(res.status).toBe(200);
    expect(res.body.supplements).toHaveLength(1);
    expect(res.body.supplements[0].name).toBe('Creatine');
  });

  it('returns 500 when the DB errors', async () => {
    mockPrisma.supplement.findMany.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/supplements');
    expect(res.status).toBe(500);
  });
});

describe('POST /supplements', () => {
  it('adds a supplement (upsert by name)', async () => {
    mockPrisma.supplement.upsert.mockImplementation(async ({ create }) => ({
      id: 'new',
      isDefault: false,
      ...create,
    }));
    const res = await request(app).post('/supplements').send({ name: 'Ashwagandha' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Ashwagandha');
    expect(mockPrisma.supplement.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.supplement.upsert.mock.calls[0][0].where).toEqual({ name: 'Ashwagandha' });
  });

  it('rejects an empty name', async () => {
    const res = await request(app).post('/supplements').send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(mockPrisma.supplement.upsert).not.toHaveBeenCalled();
  });
});

describe('POST /supplements/log', () => {
  it('creates a supplement log scaled by quantity', async () => {
    mockPrisma.userSupplement.findUnique.mockResolvedValue({
      id: 'us-1',
      userId: 'u-1',
      supplement: { name: 'Whey', calories: 120, proteinG: 24, carbsG: 2, fatG: 1, fiberG: 0 },
    });
    mockPrisma.supplementLog.create.mockResolvedValue({ id: 'log-1', userSupplementId: 'us-1', quantity: 1.5, proteinG: 36 });
    const res = await request(app)
      .post('/supplements/log')
      .set('x-user-id', 'u-1')
      .send({ userSupplementId: 'us-1', quantity: 1.5 });
    expect(res.status).toBe(201);
    expect(res.body.proteinG).toBe(36);
    expect(mockPrisma.supplementLog.create).toHaveBeenCalled();
  });

  it('rejects missing userSupplementId', async () => {
    const res = await request(app).post('/supplements/log').set('x-user-id', 'u-1').send({ quantity: 1 });
    expect(res.status).toBe(400);
  });

  it('rejects when userSupplement belongs to another user', async () => {
    mockPrisma.userSupplement.findUnique.mockResolvedValue({
      id: 'us-1',
      userId: 'u-2',
      supplement: { name: 'Whey', calories: 120, proteinG: 24, carbsG: 2, fatG: 1, fiberG: 0 },
    });
    const res = await request(app)
      .post('/supplements/log')
      .set('x-user-id', 'u-1')
      .send({ userSupplementId: 'us-1' });
    expect(res.status).toBe(404);
  });
});

describe('GET /supplements/log', () => {
  it('returns today logs for user', async () => {
    mockPrisma.supplementLog.findMany.mockResolvedValue([{ id: 'log-1', supplementName: 'Whey' }]);
    const res = await request(app).get('/supplements/log').set('x-user-id', 'u-1');
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
  });
});

describe('DELETE /supplements/log/:id', () => {
  it('deletes user supplement log', async () => {
    mockPrisma.supplementLog.deleteMany.mockResolvedValue({ count: 1 });
    const res = await request(app).delete('/supplements/log/log-1').set('x-user-id', 'u-1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
