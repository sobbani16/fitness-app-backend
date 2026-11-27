// §28 idempotency — no duplicate workouts on retry/offline sync (pc-HUM-108)
process.env.NODE_ENV = 'test';
const rows = [];
jest.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    coachingSession: {
      findUnique: async ({ where }) => {
        if (where.clientOpId) return rows.find(r => r.clientOpId === where.clientOpId) || null;
        if (where.id) return rows.find(r => r.id === where.id) || null;
        return null;
      },
      create: async ({ data }) => { const row = { id: `cs-${rows.length + 1}`, ...data }; rows.push(row); return row; },
    },
  }),
}));
const svc = require('../src/services/poseCoaching');
beforeEach(() => { rows.length = 0; });
const base = { consentToStore: true, exerciseId: 'squat', startedAt: '2026-11-27T10:00:00Z', countedReps: 12 };

describe('idempotent session creation', () => {
  it('first delivery creates', async () => {
    const r = await svc.createSession('u1', { ...base, clientOpId: 'op-1' });
    expect(r.stored).toBe(true);
    expect(r.deduplicated).toBeUndefined();
    expect(rows.length).toBe(1);
  });

  it('retry same clientOpId same user → no-op returning existing, exactly one row', async () => {
    await svc.createSession('u1', { ...base, clientOpId: 'op-1' });
    const retry = await svc.createSession('u1', { ...base, clientOpId: 'op-1' });
    expect(retry.deduplicated).toBe(true);
    expect(rows.length).toBe(1); // THE §28 guarantee — no duplicate workout on retry
  });

  it('offline-sync redelivery with drifted payload still dedupes (server truth wins)', async () => {
    await svc.createSession('u1', { ...base, clientOpId: 'op-1', countedReps: 12 });
    const redelivery = await svc.createSession('u1', { ...base, clientOpId: 'op-1', countedReps: 14 });
    expect(redelivery.session.countedReps).toBe(12); // original persisted truth, not the retry drift
    expect(rows.length).toBe(1);
  });

  it('cross-user clientOpId conflict → 409', async () => {
    await svc.createSession('u1', { ...base, clientOpId: 'op-1' });
    await expect(svc.createSession('u2', { ...base, clientOpId: 'op-1' })).rejects.toMatchObject({ status: 409 });
    expect(rows.length).toBe(1);
  });

  it('malformed clientOpId → 400, nothing persisted', async () => {
    await expect(svc.createSession('u1', { ...base, clientOpId: 'bad id!' })).rejects.toMatchObject({ status: 400 });
    expect(rows.length).toBe(0);
  });

  it('absent clientOpId still creates (legacy path unaffected)', async () => {
    const r = await svc.createSession('u1', base);
    expect(r.stored).toBe(true);
    expect(rows.length).toBe(1);
  });

  it('non-consent still persists nothing even with valid clientOpId', async () => {
    const r = await svc.createSession('u1', { ...base, clientOpId: 'op-1', consentToStore: false });
    expect(r.stored).toBe(false);
    expect(rows.length).toBe(0);
  });
});
