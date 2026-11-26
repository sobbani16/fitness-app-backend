// HUM-68 DEV5 key invariant — executable proof that camera observations NEVER
// become saved workout reps without explicit user confirmation.
// Two layers: (1) behavioral — confirmedReps stays null until an explicit
// finalize; (2) structural — the pose write path contains no reference to the
// workout-log models at all, so a future regression that wires camera counts
// directly into saved reps fails CI immediately.
const fs = require('fs');
const path = require('path');

jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const svc = require('../src/services/poseCoaching');

const store = [];
function fakeDb() {
  getPrisma.mockReturnValue({
    coachingSession: {
      create: jest.fn(async ({ data }) => {
        const row = { id: `cs-${store.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        store.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }) =>
        store.find((s) => s.id === where.id
          || (where.userId_clientRef && s.userId === where.userId_clientRef.userId && s.clientRef === where.userId_clientRef.clientRef)) || null),
      update: jest.fn(async ({ where, data }) => {
        const i = store.findIndex((s) => s.id === where.id);
        store[i] = { ...store[i], ...data };
        return store[i];
      }),
    },
  });
}
beforeEach(() => { store.length = 0; fakeDb(); });

const BASE = {
  exerciseId: 'squat', startedAt: '2026-01-10T10:00:00Z', endedAt: '2026-01-10T10:04:00Z',
  countedReps: 9, consentToStore: true,
  observations: [{ ruleId: 'squat.depth', deviation: 'shallow', confidence: 0.7, priority: 'coach' }],
};

describe('camera observations never become saved reps without confirmation', () => {
  test('a stored camera session has NO confirmed reps — countedReps is not confirmation', async () => {
    const r = await svc.createSession('u-inv', BASE);
    expect(r.stored).toBe(true);
    expect(r.session.countedReps).toBe(9); // camera count stored as diagnostics…
    expect(r.session.confirmedReps ?? null).toBeNull(); // …but never as confirmed reps
  });

  test('finalize with an empty/missing confirmation cannot manufacture confirmed reps', async () => {
    const r = await svc.createSession('u-inv2', BASE);
    await expect(svc.finalizeSession('u-inv2', r.session.id, {})).rejects.toMatchObject({ status: 400 });
    const after = await svc.getSession('u-inv2', r.session.id);
    expect(after.confirmedReps ?? null).toBeNull();
  });

  test('observations payload can never write rep counts — schema drops unknown fields', async () => {
    const r = await svc.createSession('u-inv3', { ...BASE, confirmedReps: 9, savedToWorkout: true });
    expect(r.session.confirmedReps ?? null).toBeNull(); // client cannot self-confirm at create time
  });

  test('STRUCTURAL: pose write path contains zero references to workout-log persistence', () => {
    for (const f of ['src/services/poseCoaching.js', 'src/routes/poseCoaching.js', 'src/routes/poseRecording.js']) {
      const p = path.join(__dirname, '..', f);
      if (!fs.existsSync(p)) continue; // poseRecording lands with the recording card — scanned when present
      const src = fs.readFileSync(p, 'utf8');
      expect(src).not.toMatch(/workoutSession\.(create|update|upsert)/i);
      expect(src).not.toMatch(/exerciseSet\.(create|update|upsert)/i);
      expect(src).not.toMatch(/workoutLog\.(create|update|upsert)/i);
    }
  });
});
