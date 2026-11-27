// pc-HUM-110 sections 20+32 — registry invariants: no auto-promotion,
// mandatory baseline comparison for ML architectures, independent-eval gate
// on activation, append-only rollback history, per-exercise capability overrides.
const { registerModel, transition, rollback, setExerciseEnabled, activeManifest } = require('../src/services/pose/modelRegistry');

const valid = (over = {}) => ({
  name: 'squat-v1', version: '1.0.0', architecture: 'deterministic_baseline',
  datasetVersion: 'ds-2026-11-25', configHash: 'cfghash', seed: 42,
  supportedExercises: ['squat'], capabilities: { squat: { observations: ['knee_valgus'], enabled: true } },
  checksum: 'a'.repeat(64), runtimeCompat: 'onnxruntime-mobile>=1.17', ...over,
});

function fakeDb() {
  const models = [], events = [];
  return {
    models, events,
    mlModel: {
      create: async ({ data }) => { const m = { id: `m-${models.length + 1}`, createdAt: new Date(), ...data }; models.push(m); return m; },
      findUnique: async ({ where }) => models.find(m => m.id === where.id) || null,
      findFirst: async ({ where }) => models.find(m => m.name === where.name && m.status === where.status && m.id !== where.id?.not) || null,
      findMany: async ({ where }) => models.filter(m => m.status === where.status),
      update: async ({ where, data }) => { const m = models.find(x => x.id === where.id); Object.assign(m, data); return m; },
    },
    mlRolloutEvent: {
      create: async ({ data }) => { const e = { id: `e-${events.length + 1}`, createdAt: new Date(), ...data }; events.push(e); return e; },
    },
  };
}

describe('registration validation', () => {
  it('accepts a complete baseline registration', async () => {
    const db = fakeDb();
    const m = await registerModel(db, valid());
    expect(m.status).toBe('registered');
  });
  it.each([
    ['missing checksum', { checksum: undefined }],
    ['bad checksum format', { checksum: 'nothex' }],
    ['unknown architecture', { architecture: 'gpt-pose' }],
    ['empty exercises', { supportedExercises: [] }],
    ['capability without observations', { capabilities: { squat: { enabled: true } } }],
  ])('rejects %s', async (_label, patch) => {
    const db = fakeDb();
    const data = valid(patch);
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete data[k];
    await expect(registerModel(db, data)).rejects.toMatchObject({ status: 400 });
  });
});

describe('controlled rollout state machine', () => {
  it('no direct jump registered → active', async () => {
    const db = fakeDb();
    const m = await registerModel(db, valid());
    await expect(transition(db, m.id, 'active', { reason: 'x' })).rejects.toMatchObject({ status: 409 });
  });
  it('ML architecture requires beatsBaseline=true before approval', async () => {
    const db = fakeDb();
    const m = await registerModel(db, valid({ architecture: 'tcn' }));
    await transition(db, m.id, 'candidate', { reason: 'eval staged' });
    await expect(transition(db, m.id, 'approved', { reason: 'no comparison' })).rejects.toMatchObject({ status: 409 });
    const ok = await transition(db, m.id, 'approved', { reason: 'independent eval', baselineComparison: { beatsBaseline: true } });
    expect(ok.model.status).toBe('approved');
  });
  it('baseline architecture approves without comparison', async () => {
    const db = fakeDb();
    const m = await registerModel(db, valid());
    await transition(db, m.id, 'candidate', { reason: 'staged' });
    const ok = await transition(db, m.id, 'approved', { reason: 'reference implementation' });
    expect(ok.model.status).toBe('approved');
  });
  it('activation requires approvalRef + evalResults', async () => {
    const db = fakeDb();
    const m = await registerModel(db, valid());
    await transition(db, m.id, 'candidate', { reason: 'staged' });
    await transition(db, m.id, 'approved', { reason: 'eval' });
    await expect(transition(db, m.id, 'active', { reason: 'ship' })).rejects.toMatchObject({ status: 409 });
    db.models.find(x => x.id === m.id).approvalRef = 'qa-report-7';
    db.models.find(x => x.id === m.id).evalResults = { macroF1: 0.9 };
    const ok = await transition(db, m.id, 'active', { reason: 'ship' });
    expect(ok.model.status).toBe('active');
    expect(ok.model.promotedAt).toBeTruthy();
  });
  it('activating a new version demotes the previous active with history intact', async () => {
    const db = fakeDb();
    const mk = async (version) => {
      const m = await registerModel(db, valid({ version, evalResults: { macroF1: 0.9 }, approvalRef: 'qa-7' }));
      await transition(db, m.id, 'candidate', { reason: 's' });
      await transition(db, m.id, 'approved', { reason: 'a' });
      await transition(db, m.id, 'active', { reason: 'ship' });
      return m;
    };
    const v1 = await mk('1.0.0');
    const v2 = await mk('1.1.0');
    const old = db.models.find(x => x.id === v1.id);
    expect(old.status).toBe('rolled_back');
    expect(db.events.some(e => e.modelId === v1.id && e.toState === 'rolled_back' && /superseded/.test(e.reason))).toBe(true);
    expect(db.models.find(x => x.id === v2.id).status).toBe('active');
  });
  it('controlled rollout: supersession AUTO-WIRES the rollback target when the operator did not — fleet never stranded', async () => {
    const db = fakeDb();
    const m1 = await registerModel(db, valid({ evalResults: { macroF1: 0.9 }, approvalRef: 'qa' }));
    await transition(db, m1.id, 'candidate', { reason: 's' });
    await transition(db, m1.id, 'approved', { reason: 'a' });
    await transition(db, m1.id, 'active', { reason: 'ship' });
    // operator forgets rollbackTargetId — the system must wire it anyway
    const m2 = await registerModel(db, valid({ version: '2.0.0', evalResults: { macroF1: 0.95 }, approvalRef: 'qa' }));
    await transition(db, m2.id, 'candidate', { reason: 's' });
    await transition(db, m2.id, 'approved', { reason: 'a' });
    await transition(db, m2.id, 'active', { reason: 'ship' });
    expect(db.models.find(x => x.id === m2.id).rollbackTargetId).toBe(m1.id); // auto-wired
    // the superseded model never self-points
    expect(db.models.find(x => x.id === m1.id).rollbackTargetId ?? null).not.toBe(m1.id);
    // rollback of m2 restores m1 even without operator wiring
    await rollback(db, m2.id, { reason: 'prod regression' });
    expect(db.models.find(x => x.id === m1.id).status).toBe('active');
  });

  it('rollback restores the rollback target and never deletes events', async () => {
    const db = fakeDb();
    const m1 = await registerModel(db, valid({ evalResults: { macroF1: 0.9 }, approvalRef: 'qa' }));
    await transition(db, m1.id, 'candidate', { reason: 's' });
    await transition(db, m1.id, 'approved', { reason: 'a' });
    await transition(db, m1.id, 'active', { reason: 'ship' });
    const m2 = await registerModel(db, valid({ version: '2.0.0', evalResults: { macroF1: 0.95 }, approvalRef: 'qa', rollbackTargetId: m1.id }));
    await transition(db, m2.id, 'candidate', { reason: 's' });
    await transition(db, m2.id, 'approved', { reason: 'a' });
    await transition(db, m2.id, 'active', { reason: 'ship' });
    await rollback(db, m2.id, { reason: 'regression in prod' });
    expect(db.models.find(x => x.id === m2.id).status).toBe('rolled_back');
    expect(db.models.find(x => x.id === m1.id).status).toBe('active');
    expect(db.events.filter(e => e.modelId === m2.id).length).toBeGreaterThanOrEqual(4);
  });
});

describe('per-exercise capability disabling + manifest', () => {
  it('disables an exercise without touching checksum; reflected in manifest', async () => {
    const db = fakeDb();
    const m = await registerModel(db, valid({ evalResults: { macroF1: 0.9 }, approvalRef: 'qa' }));
    await transition(db, m.id, 'candidate', { reason: 's' });
    await transition(db, m.id, 'approved', { reason: 'a' });
    await transition(db, m.id, 'active', { reason: 'ship' });
    await setExerciseEnabled(db, m.id, 'squat', false);
    const manifest = await activeManifest(db);
    expect(manifest[0].exercises.squat.enabled).toBe(false);
    expect(db.models.find(x => x.id === m.id).checksum).toBe('a'.repeat(64));
  });
  it('rejects disabling an unsupported exercise', async () => {
    const db = fakeDb();
    const m = await registerModel(db, valid());
    await expect(setExerciseEnabled(db, m.id, 'deadlift', false)).rejects.toMatchObject({ status: 400 });
  });
});
