// Pose coaching sessions — consent gate, ownership, corrections, allowlist.
jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const svc = require('../src/services/poseCoaching');
const { isPoseDiagnosticsTester } = require('../src/services/testerAccess');

const SESSION = {
  id: 'cs1', userId: 'u1', exerciseId: 'squat', countedReps: 9,
  confirmedReps: null, discarded: false, consentToStore: true,
};

function fakeDb(sessions = [SESSION]) {
  const store = sessions.map((s) => ({ ...s }));
  getPrisma.mockReturnValue({
    coachingSession: {
      create: jest.fn(async ({ data }) => ({ id: 'cs-new', createdAt: new Date(), updatedAt: new Date(), ...data })),
      findMany: jest.fn(async ({ where } = {}) =>
        store.filter((s) => (!where?.userId || s.userId === where.userId) && (!where?.exerciseId || s.exerciseId === where.exerciseId))),
      findUnique: jest.fn(async ({ where }) => store.find((s) => s.id === where.id) || null),
      update: jest.fn(async ({ where, data }) => {
        const i = store.findIndex((s) => s.id === where.id);
        store[i] = { ...store[i], ...data };
        return store[i];
      }),
      delete: jest.fn(async ({ where }) => {
        const i = store.findIndex((s) => s.id === where.id);
        if (i >= 0) store.splice(i, 1);
      }),
    },
    userRole: {
      findMany: jest.fn(async () => []),
    },
  });
  return store;
}

const BASE = {
  exerciseId: 'squat',
  startedAt: '2026-01-10T10:00:00Z',
  endedAt: '2026-01-10T10:04:00Z',
  devicePlatform: 'ios',
  appBuild: '1.2.3(45)',
  modelVersion: 'pose_landmarker_lite@59929e1d',
  ruleVersion: 'squat-1.0.0',
  cameraView: 'side',
  countedReps: 9,
  consentToStore: true,
  repDiagnostics: [{ rep: 1, side: 'right', samplesUsed: 24, minVisibilitySeen: 0.61, rangeOfMotion: 82, durationMs: 2300 }],
  observations: [{ ruleId: 'squat.depth', deviation: 'shallow', confidence: 0.7, priority: 'coach' }],
};

describe('poseCoaching.createSession', () => {
  test('persists a consented session with provenance', async () => {
    fakeDb([]);
    const r = await svc.createSession('u1', BASE);
    expect(r.stored).toBe(true);
    expect(r.session.exerciseId).toBe('squat');
    expect(r.session.countedReps).toBe(9);
    expect(r.session.consentToStore).toBe(true);
    expect(r.session.repDiagnostics[0].side).toBe('right');
  });

  test('non-consent stores nothing and is not an error', async () => {
    const store = fakeDb([]);
    const r = await svc.createSession('u1', { ...BASE, consentToStore: false });
    expect(r.stored).toBe(false);
    expect(store).toHaveLength(0);
  });

  test('rejects missing exerciseId / startedAt', async () => {
    fakeDb([]);
    await expect(svc.createSession('u1', { ...BASE, exerciseId: '' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createSession('u1', { ...BASE, startedAt: 'junk' })).rejects.toMatchObject({ status: 400 });
  });

  test('rejects invalid endedAt with 400 instead of persisting an invalid date', async () => {
    fakeDb([]);
    await expect(svc.createSession('u1', { ...BASE, endedAt: 'junk' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createSession('u1', { ...BASE, endedAt: 'not-a-date' })).rejects.toMatchObject({ status: 400 });
  });

  test('sanitizes diagnostics bounds and unknown enums', async () => {
    fakeDb([]);
    const r = await svc.createSession('u1', {
      ...BASE,
      cameraView: 'diagonal',
      repDiagnostics: [{ rep: 1, side: 'diagonal', samplesUsed: 999999, minVisibilitySeen: 9, rangeOfMotion: 999, durationMs: -5 }],
    });
    expect(r.session.cameraView).toBeNull();
    const d = r.session.repDiagnostics[0];
    expect(d.side).toBe('unknown');
    expect(d.samplesUsed).toBe(10000);
    expect(d.minVisibilitySeen).toBe(1);
    expect(d.rangeOfMotion).toBe(360);
    expect(d.durationMs).toBe(0);
  });
});

describe('poseCoaching ownership + finalize', () => {
  test('owner-only reads; other users get 404', async () => {
    fakeDb();
    expect((await svc.getSession('u1', 'cs1')).id).toBe('cs1');
    await expect(svc.getSession('u2', 'cs1')).rejects.toMatchObject({ status: 404 });
    await expect(svc.getSession('u1', 'nope')).rejects.toMatchObject({ status: 404 });
  });

  test('finalize writes confirmedReps / corrections / discard', async () => {
    const store = fakeDb();
    const s = await svc.finalizeSession('u1', 'cs1', { confirmedReps: 8, corrections: { adjust: -1, final: 8 } });
    expect(s.confirmedReps).toBe(8);
    expect(s.corrections.final).toBe(8);
    const d = await svc.finalizeSession('u1', 'cs1', { discarded: true });
    expect(d.discarded).toBe(true);
    expect(d.confirmedReps).toBeNull();
    expect(store[0].discarded).toBe(true);
  });

  test('finalize rejects bad confirmedReps and empty bodies', async () => {
    fakeDb();
    await expect(svc.finalizeSession('u1', 'cs1', { confirmedReps: 2.5 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.finalizeSession('u1', 'cs1', {})).rejects.toMatchObject({ status: 400 });
    await expect(svc.finalizeSession('u2', 'cs1', { confirmedReps: 1 })).rejects.toMatchObject({ status: 404 });
  });

  test('finalize rejects an invalid endedAt', async () => {
    fakeDb();
    await expect(svc.finalizeSession('u1', 'cs1', { endedAt: 'junk' })).rejects.toMatchObject({ status: 400 });
  });

  test('delete removes the record (owner only)', async () => {
    const store = fakeDb();
    await svc.deleteSession('u1', 'cs1');
    expect(store).toHaveLength(0);
    await expect(svc.deleteSession('u2', 'cs1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('isPoseDiagnosticsTester', () => {
  const OLD_ENV = process.env.POSE_DIAGNOSTIC_TESTER_IDS;
  afterEach(() => { process.env.POSE_DIAGNOSTIC_TESTER_IDS = OLD_ENV; });

  test('env allowlist grants access; strangers denied', async () => {
    getPrisma.mockReturnValue({ userRole: { findMany: jest.fn(async () => []) } });
    process.env.POSE_DIAGNOSTIC_TESTER_IDS = 'tester-1, tester-2';
    expect(await isPoseDiagnosticsTester('tester-1')).toBe(true);
    expect(await isPoseDiagnosticsTester('random-user')).toBe(false);
  });

  test('ADMIN role grants access without env entry', async () => {
    delete process.env.POSE_DIAGNOSTIC_TESTER_IDS;
    getPrisma.mockReturnValue({
      userRole: { findMany: jest.fn(async () => [{ role: { name: 'ADMIN' } }]) },
    });
    expect(await isPoseDiagnosticsTester('admin-user')).toBe(true);
    getPrisma.mockReturnValue({
      userRole: { findMany: jest.fn(async () => [{ role: { name: 'MEMBER' } }]) },
    });
    expect(await isPoseDiagnosticsTester('member-user')).toBe(false);
  });
});
