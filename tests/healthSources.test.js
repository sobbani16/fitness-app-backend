// Wearable platform tests — ingest idempotency, dedup, recovery honesty.
jest.mock('../src/lib/prisma', () => ({
  healthDataSource: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn(), update: jest.fn(), delete: jest.fn() },
  healthMeasurement: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
  healthSyncCursor: { deleteMany: jest.fn(), upsert: jest.fn().mockResolvedValue({}) },
  wearableDevice: { updateMany: jest.fn() },
  sleepLog: { findMany: jest.fn() },
  workoutSession: { count: jest.fn() },
}));
const prisma = require('../src/lib/prisma');
const svc = require('../src/services/healthSources');

const SRC = { id: 's1', userId: 'u1', provider: 'apple_health', connectionState: 'connected' };

describe('health sources', () => {
  beforeEach(() => jest.clearAllMocks());

  test('provider registry: humai_band registered but NOT_AVAILABLE', () => {
    const band = svc.listProviders().find((p) => p.id === 'humai_band');
    expect(band.availability).toBe('not_available');
    expect(band.metrics).toEqual([]);
  });

  test('connect: band refuses until hardware exists', async () => {
    await expect(svc.connectSource('u1', 'humai_band')).rejects.toMatchObject({ status: 409 });
  });

  test('ingest: rejects invalid records, requires connected source', async () => {
    prisma.healthDataSource.findUnique.mockResolvedValue(null);
    await expect(svc.ingestMeasurements('u1', 'apple_health', [{}])).rejects.toMatchObject({ status: 409 });
    prisma.healthDataSource.findUnique.mockResolvedValue(SRC);
    prisma.healthDataSource.update.mockResolvedValue({});
    const r = await svc.ingestMeasurements('u1', 'apple_health', [{ metric: 'bogus', unit: 'x', startAt: '2026-01-01' }]);
    expect(r.rejected).toBe(1); expect(r.accepted).toBe(0);
  });

  test('ingest: same externalId is idempotent — no double count', async () => {
    prisma.healthDataSource.findUnique.mockResolvedValue(SRC);
    prisma.healthDataSource.update.mockResolvedValue({});
    prisma.healthMeasurement.findFirst.mockResolvedValue({ id: 'm1', value: 8000, startAt: new Date('2026-01-01T08:00:00Z') });
    prisma.healthMeasurement.update.mockResolvedValue({});
    const rec = { metric: 'steps', value: 8000, unit: 'count', startAt: '2026-01-01T00:00:00Z', endAt: '2026-01-01T23:00:00Z', externalId: 'ah-123' };
    const r = await svc.ingestMeasurements('u1', 'apple_health', [rec, rec]);
    expect(r.duplicates).toBe(2); expect(r.accepted).toBe(0);
    expect(prisma.healthMeasurement.create).not.toHaveBeenCalled();
  });

  test('ingest: overlapping same-provider interval skipped (backfill protection)', async () => {
    prisma.healthDataSource.findUnique.mockResolvedValue(SRC);
    prisma.healthDataSource.update.mockResolvedValue({});
    prisma.healthMeasurement.findFirst.mockResolvedValueOnce({ id: 'm9' }); // overlap found
    const r = await svc.ingestMeasurements('u1', 'apple_health', [
      { metric: 'steps', value: 5000, unit: 'count', startAt: '2026-01-01T00:00:00Z', endAt: '2026-01-01T12:00:00Z' },
    ]);
    expect(r.duplicates).toBe(1);
  });

  test('daily summary: two providers same day — precedence wins, not double-sum', () => {
    const rows = [
      { metric: 'steps', value: 8000, unit: 'count', provider: 'apple_health', startAt: new Date('2026-01-01T00:00:00Z'), endAt: new Date('2026-01-01T23:00:00Z') },
      { metric: 'steps', value: 8000, unit: 'count', provider: 'health_connect', startAt: new Date('2026-01-01T00:00:00Z'), endAt: new Date('2026-01-01T23:00:00Z') },
    ];
    const out = svc.reconcileDaily ? svc.reconcileDaily(rows) : null;
    const day = out.find((d) => d.day === '2026-01-01');
    expect(day.value).toBe(8000); // NOT 16000
    expect(day.provider).toBe('apple_health');
    expect(day.providersSeen).toContain('health_connect');
  });

  test('recovery: INSUFFICIENT_DATA rather than an invented score', async () => {
    prisma.healthMeasurement.findMany.mockResolvedValue([]);
    prisma.sleepLog.findMany.mockResolvedValue([{ durationMin: 400 }]);
    prisma.workoutSession.count.mockResolvedValue(0);
    const r = await svc.getRecovery('u1');
    expect(r.status).toBe('INSUFFICIENT_DATA');
  });

  test('HRV statistics never mix — sdnn/rmssd trend separately', async () => {
    const rows = [];
    for (let i = 0; i < 6; i++) {
      rows.push({ metric: 'hrv_rmssd', value: 40 + i, startAt: new Date(Date.now() - i * 864e5) });
      rows.push({ metric: 'hrv_sdnn', value: 60 + i, startAt: new Date(Date.now() - i * 864e5) });
    }
    prisma.healthMeasurement.findMany
      .mockResolvedValueOnce(rows.map((x) => ({ ...x, metric: 'resting_heart_rate', value: 60 }))) // rhr
      .mockResolvedValueOnce(rows); // hrv
    prisma.sleepLog.findMany.mockResolvedValue([]);
    prisma.workoutSession.count.mockResolvedValue(0);
    const r = await svc.getRecovery('u1');
    const hrvTrend = r.trends.find((t) => t.metric.startsWith('hrv'));
    expect(['hrv_rmssd', 'hrv_sdnn']).toContain(hrvTrend.metric);
  });
});
