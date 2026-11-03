const request = require('supertest');

const mockPrisma = {
  waterLog: { create: jest.fn(), deleteMany: jest.fn(), aggregate: jest.fn() },
  dailySteps: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
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
    mockPrisma.dailySteps.findMany.mockResolvedValue([]);
    mockPrisma.dailySteps.create.mockResolvedValue({ id: 's-1', steps: 8000 });
    const res = await request(app)
      .post('/daily-stats/steps')
      .set('x-user-id', 'u-1')
      .send({ steps: 8000 });
    expect(res.status).toBe(200);
    expect(res.body.record.steps).toBe(8000);
  });

  it('updates existing steps', async () => {
    mockPrisma.dailySteps.findMany.mockResolvedValue([{ id: 's-1', steps: 5000 }]);
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
    mockPrisma.dailySteps.findMany.mockResolvedValue([{ steps: 7500 }]);
    const res = await request(app).get('/daily-stats/steps').set('x-user-id', 'u-1');
    expect(res.status).toBe(200);
    expect(res.body.steps).toBe(7500);
  });
});

describe('steps reliability', () => {
  it('stores the client local date and only replaces the device row', async () => {
    mockPrisma.dailySteps.findMany.mockResolvedValue([]);
    mockPrisma.dailySteps.create.mockResolvedValue({ id: 's-2', steps: 4200 });
    const res = await request(app).post('/daily-stats/steps').set('x-user-id', 'u-1').send({ steps: 4200, date: '2026-11-02' });
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-11-02');
    expect(mockPrisma.dailySteps.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u-1', date: new Date('2026-11-02T00:00:00.000Z'), source: 'app' } }));
    expect(mockPrisma.dailySteps.create).toHaveBeenCalledWith({ data: { userId: 'u-1', date: new Date('2026-11-02T00:00:00.000Z'), steps: 4200, source: 'app' } });
  });

  it('collapses duplicate device rows instead of accumulating', async () => {
    mockPrisma.dailySteps.findMany.mockResolvedValue([{ id: 'a', steps: 100 }, { id: 'b', steps: 200 }]);
    mockPrisma.dailySteps.update.mockResolvedValue({ id: 'a', steps: 300 });
    const res = await request(app).post('/daily-stats/steps').set('x-user-id', 'u-1').send({ steps: 300, date: '2026-11-02' });
    expect(res.status).toBe(200);
    expect(mockPrisma.dailySteps.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['b'] } } });
  });

  it('reports the highest source count, never the sum of device and wearable', async () => {
    mockPrisma.dailySteps.findMany.mockResolvedValue([{ steps: 6000 }, { steps: 6400 }]);
    const res = await request(app).get('/daily-stats/steps?date=2026-11-02').set('x-user-id', 'u-1');
    expect(res.body.steps).toBe(6400);
  });

  it('rejects a malformed date and a non-integer count', async () => {
    expect((await request(app).post('/daily-stats/steps').set('x-user-id', 'u-1').send({ steps: 10, date: '11/02/2026' })).status).toBe(400);
    expect((await request(app).post('/daily-stats/steps').set('x-user-id', 'u-1').send({ steps: 10.5 })).status).toBe(400);
  });

  it('returns a sanitized 500 with a correlation id when the database fails', async () => {
    mockPrisma.dailySteps.findMany.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    const res = await request(app).post('/daily-stats/steps').set('x-user-id', 'u-1').set('x-correlation-id', 'corr-steps-0001').send({ steps: 10 });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Service unavailable. Please try again.', code: 'INTERNAL', correlationId: 'corr-steps-0001' });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });
});
