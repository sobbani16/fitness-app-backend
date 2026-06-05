const request = require('supertest');

const mockPrisma = {
  supplement: { findMany: jest.fn(), upsert: jest.fn() },
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
