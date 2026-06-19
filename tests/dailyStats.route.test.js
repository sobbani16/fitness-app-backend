const request = require('supertest');

const mockPrisma = {
  waterLog: { create: jest.fn(), deleteMany: jest.fn(), aggregate: jest.fn() },
  dailySteps: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const app = require('../src/app');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PUT /daily-stats/water/replace', () => {
  it('replaces today water total', async () => {
    mockPrisma.waterLog.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.waterLog.create.mockResolvedValue({ id: 'w-1', amountMl: 1500 });
    const res = await request(app)
      .put('/daily-stats/water/replace')
      .set('x-user-id', 'u-1')
      .send({ amountMl: 1500 });
    expect(res.status).toBe(200);
    expect(res.body.log.amountMl).toBe(1500);
  });

  it('rejects missing amountMl', async () => {
    const res = await request(app).put('/daily-stats/water/replace').set('x-user-id', 'u-1').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /daily-stats/water', () => {
  it('returns today water total', async () => {
    mockPrisma.waterLog.aggregate.mockResolvedValue({ _sum: { amountMl: 1200 } });
    const res = await request(app).get('/daily-stats/water').set('x-user-id', 'u-1');
    expect(res.status).toBe(200);
    expect(res.body.amountMl).toBe(1200);
  });

  it('returns 0 when no water logs', async () => {
    mockPrisma.waterLog.aggregate.mockResolvedValue({ _sum: { amountMl: null } });
    const res = await request(app).get('/daily-stats/water').set('x-user-id', 'u-1');
    expect(res.status).toBe(200);
    expect(res.body.amountMl).toBe(0);
  });
});

describe('POST /daily-stats/steps', () => {
  it('upserts today steps', async () => {
    mockPrisma.dailySteps.findFirst.mockResolvedValue(null);
    mockPrisma.dailySteps.create.mockResolvedValue({ id: 's-1', steps: 8000 });
    const res = await request(app)
      .post('/daily-stats/steps')
      .set('x-user-id', 'u-1')
      .send({ steps: 8000 });
    expect(res.status).toBe(200);
    expect(res.body.record.steps).toBe(8000);
  });

  it('updates existing steps', async () => {
    mockPrisma.dailySteps.findFirst.mockResolvedValue({ id: 's-1', steps: 5000 });
    mockPrisma.dailySteps.update.mockResolvedValue({ id: 's-1', steps: 10000 });
    const res = await request(app)
      .post('/daily-stats/steps')
      .set('x-user-id', 'u-1')
      .send({ steps: 10000 });
    expect(res.status).toBe(200);
    expect(res.body.record.steps).toBe(10000);
  });
});

describe('GET /daily-stats/steps', () => {
  it('returns today steps', async () => {
    mockPrisma.dailySteps.findFirst.mockResolvedValue({ steps: 7500 });
    const res = await request(app).get('/daily-stats/steps').set('x-user-id', 'u-1');
    expect(res.status).toBe(200);
    expect(res.body.steps).toBe(7500);
  });
});
