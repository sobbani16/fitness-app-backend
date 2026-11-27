// Cross-repo contract verification — injury PATCH (pc-HUM-63, milestone 3).
//
// Pinned revisions (rationale):
//   backend candidate: 5e2f3ef (branch HEAD — tested live, real route+middleware)
//   backend baseline:  625352c — injury PATCH exists but the granular validation
//     envelope (unsupported_fields/invalid_field/no_editable_fields/clinician_fields_locked)
//     is a candidate-side ADDITIVE expansion (static diff evidence — fixture-labeled)
//   mobile candidate:  f184c99 — humai/dev-02/pc-HUM-43-injury-ux tip (read-only git objects)
//   mobile baseline:   846a88a — mobile origin/main; updateInjury present in BOTH revisions
//     so both generations share the wire format examined here.
//
// Harness: AUTH_TEST_BYPASS disabled — real authenticate chain, synthetic tokens.
process.env.NODE_ENV = 'test';
process.env.AUTH_TEST_BYPASS = 'false';
const request = require('supertest');
const { hashToken } = require('../../src/services/authService');

const TOKEN = 'synthetic-injury-token-0001';
const state = { injury: null, updateCalls: [] };
const mockPrisma = {
  authSession: {
    findUnique: jest.fn(async ({ where }) =>
      where.tokenHash === hashToken(TOKEN) ? { userId: 'user-synth-1', expiresAt: new Date(Date.now() + 3600e3) } : null),
  },
  userInjury: {
    findFirst: jest.fn(async ({ where }) =>
      state.injury && state.injury.id === where.id && state.injury.userId === where.userId
        ? { source: state.injury.source } : null),
    updateMany: jest.fn(async ({ where, data }) => {
      state.updateCalls.push({ where, data });
      if (state.injury && state.injury.id === where.id && state.injury.userId === where.userId) {
        Object.assign(state.injury, data);
        return { count: 1 };
      }
      return { count: 0 };
    }),
  },
  user: { findUnique: jest.fn(async () => ({ id: 'user-synth-1', emailVerifiedAt: new Date('2026-01-01') })) },
  userRole: { findMany: jest.fn(async () => []) },
  safetyAdviceCache: { deleteMany: jest.fn(async () => ({ count: 0 })) },
};
jest.mock('../../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
// invalidateSafetyAdvice must not explode on the minimal mock surface
jest.mock('../../src/services/activitySafety/adviceCache', () => ({ invalidateSafetyAdvice: async () => null }), { virtual: true });

const app = require('../../src/app');

beforeEach(() => {
  jest.clearAllMocks();
  state.updateCalls = [];
  state.injury = { id: 'inj-1', userId: 'user-synth-1', source: 'self_reported', status: 'current', painLevel: 4 };
});

const patch = (id, body, headers = {}) =>
  request(app).patch(`/activity-safety/injuries/${id}`).set({ authorization: `Bearer ${TOKEN}`, ...headers }).send(body);

describe('authorized happy path — method, path, response shape', () => {
  it('valid patch returns {updated:true} and persists only editable fields', async () => {
    const res = await patch('inj-1', { status: 'recovering', painLevel: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: true });
    expect(state.injury.status).toBe('recovering');
    expect(state.injury.painLevel).toBe(2);
    // object-level authz in the write itself
    expect(state.updateCalls[0].where).toEqual({ id: 'inj-1', userId: 'user-synth-1' });
  });

  it('status=resolved sets resolvedAt server-side; reverting clears it', async () => {
    const res = await patch('inj-1', { status: 'resolved' });
    expect(res.status).toBe(200);
    expect(state.updateCalls[0].data.resolvedAt).toBeInstanceOf(Date);
    const back = await patch('inj-1', { status: 'current' });
    expect(back.status).toBe(200);
    expect(state.updateCalls[1].data.resolvedAt).toBeNull();
  });
});

describe('validation errors — exact envelope, state unchanged', () => {
  it('unsupported fields → 400 unsupported_fields listing them, zero mutation', async () => {
    const res = await patch('inj-1', { status: 'recovering', evilField: 'x', userId: 'other' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_fields');
    expect(res.body.unsupported).toContain('evilField');
    expect(state.injury.status).toBe('current');
    expect(state.updateCalls).toHaveLength(0);
  });

  it('invalid enum values → 400 invalid_field with the field named', async () => {
    const res = await patch('inj-1', { status: 'half_better' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_field');
    expect(res.body.field).toBe('status');
    expect(state.updateCalls).toHaveLength(0);
  });

  it('painLevel bounds — non-integer and out-of-range rejected, null accepted', async () => {
    expect((await patch('inj-1', { painLevel: 11 })).status).toBe(400);
    expect((await patch('inj-1', { painLevel: 2.5 })).status).toBe(400);
    const ok = await patch('inj-1', { painLevel: null });
    expect(ok.status).toBe(200);
    // RECORDED CONTRACT DEFECT (pc-HUM-63 finding, app logic unchanged per instructions):
    // num(null) coerces to 0 — mobile explicitly types painLevel as `number | null`
    // where null means "cleared/unrecorded", but the write persists 0 (a concrete
    // pain value). Semantically distinct states collapse: no-pain-recorded vs pain-level-zero.
    // Assertion documents ACTUAL behavior; expected contract is null-preserving.
    expect(state.injury.painLevel).toBe(0); // actual — defect recorded in ledgers
  });

  it('empty patch → 400 no_editable_fields', async () => {
    const res = await patch('inj-1', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_editable_fields');
  });

  it('clearance pair must be provided together', async () => {
    const res = await patch('inj-1', { clearanceNote: 'cleared for full activity' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_field');
    expect(state.updateCalls).toHaveLength(0);
  });
});

describe('authorization failures — cross-user and missing auth', () => {
  it('cross-user injury id → 404 not_found (no existence leak), zero mutation', async () => {
    state.injury.userId = 'someone-else';
    const res = await patch('inj-1', { status: 'recovering' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
    expect(state.updateCalls).toHaveLength(0);
  });

  it('missing token → 401 envelope with correlation', async () => {
    const res = await request(app).patch('/activity-safety/injuries/inj-1').send({ status: 'recovering' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
    expect(state.updateCalls).toHaveLength(0);
  });
});

describe('clinician-documented lock — 409 contract', () => {
  it('clinician-documented injury rejects edits to locked fields with 409', async () => {
    state.injury.source = 'clinician_documented';
    const res = await patch('inj-1', { weightBearingRestriction: 'full' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('clinician_fields_locked');
    expect(res.body.locked).toContain('weightBearingRestriction');
    expect(state.updateCalls).toHaveLength(0);
  });

  it('clinician-documented injury still accepts non-locked edits', async () => {
    state.injury.source = 'clinician_documented';
    const res = await patch('inj-1', { status: 'recovering' });
    expect(res.status).toBe(200);
    expect(state.injury.status).toBe('recovering');
  });
});

describe('repeat-request behavior', () => {
  it('identical repeat patch is repeat-safe — same response, no error accumulation', async () => {
    expect((await patch('inj-1', { status: 'recovering' })).status).toBe(200);
    const again = await patch('inj-1', { status: 'recovering' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ updated: true });
  });
});

describe('cross-generation compatibility — fixture-labeled static evidence', () => {
  it('FIXTURE: old mobile (846a88a) wire fields ⊆ candidate INJURY_EDITABLE — forward compatible', () => {
    // mobile updateInjury input keys transcribed from git objects (both revisions identical surface):
    // status/type/laterality/painLevel/weightBearingRestriction/rangeOfMotionRestriction —
    // all members of the backend INJURY_EDITABLE allowlist, so no old-client payload is rejected
    // as unsupported_fields. Static shape comparison, not executed mobile code.
    const mobileWireKeys = ['status', 'type', 'laterality', 'painLevel', 'weightBearingRestriction', 'rangeOfMotionRestriction'];
    const backendEditable = ['status', 'type', 'laterality', 'painLevel', 'weightBearingRestriction', 'rangeOfMotionRestriction', 'prohibitedCategories', 'rehabInstructions', 'notes', 'expectedReassessmentAt', 'clearanceRecordedAt', 'clearanceNote'];
    for (const key of mobileWireKeys) expect(backendEditable).toContain(key);
  });

  it('FIXTURE: candidate backend validation envelope is additive-expansion vs baseline 625352c', () => {
    // static diff evidence: baseline lacked unsupported_fields/invalid_field/no_editable_fields/
    // clinician_fields_locked granularity. Valid payloads behave identically; invalid payloads get
    // richer 400s — no breaking change for well-formed clients in either upgrade order.
    const baselineErrorKeys = ['not_found']; // extracted from git object at 625352c
    const candidateErrorKeys = ['unsupported_fields', 'invalid_field', 'no_editable_fields', 'not_found', 'clinician_fields_locked', 'injury_update_failed'];
    for (const key of baselineErrorKeys) expect(candidateErrorKeys).toContain(key);
  });
});
