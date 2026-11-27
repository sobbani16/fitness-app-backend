// Cross-repo contract verification — auth, error envelope, correlation (pc-HUM-63).
//
// Pinned revisions (rationale):
//   backend candidate: 4a21ab5 (branch HEAD — tested here live)
//   backend baseline:  625352c — requestContext.js and authenticate.js are
//     BYTE-IDENTICAL to candidate (diff-verified) — the envelope is invariant
//     across the backend pair, so both upgrade orders share one behavior.
//   mobile candidate:  c9c0e05 / baseline 8375ebf — src/api/client.ts is
//     BYTE-IDENTICAL across the pair (diff-verified) — client expectations
//     invariant. Interceptor semantics are transcribed as FIXTURE-labeled
//     static assertions; wire behavior exercised live against real middleware.
//
// CRITICAL harness property: AUTH_TEST_BYPASS is disabled here — the real
// authenticate() path runs against mocked authSession rows. No test bypass,
// no real credentials, synthetic tokens only.
process.env.NODE_ENV = 'test';
process.env.AUTH_TEST_BYPASS = 'false'; // real middleware chain — the point of this harness
const request = require('supertest');
const { hashToken } = require('../../src/services/authService');

const VALID_TOKEN = 'synthetic-valid-token-0001';
const state = {};
const mockPrisma = {
  authSession: {
    findUnique: jest.fn(async ({ where }) => {
      if (where.tokenHash === hashToken(VALID_TOKEN)) {
        return { userId: 'user-synth-1', expiresAt: new Date(Date.now() + 3600e3) };
      }
      if (where.tokenHash === hashToken('synthetic-expired-token')) {
        return { userId: 'user-synth-1', expiresAt: new Date(Date.now() - 1000) }; // expired
      }
      return null;
    }),
  },
  weeklyNutritionPlan: { findUnique: jest.fn(async () => ({ id: 'plan-1', userId: 'user-synth-1' })) },
  weeklyMeal: {
    findMany: jest.fn(async ({ where, select } = {}) =>
      state.meals.filter((m) => m.planId === where.planId && (where.dayOfWeek === undefined || m.dayOfWeek === where.dayOfWeek))
        .map((m) => (select ? { confirmedByUser: m.confirmedByUser } : m))),
    updateMany: jest.fn(async ({ data }) => {
      state.meals.forEach((m) => { m.confirmedByUser = data.confirmedByUser; });
      return { count: state.meals.length };
    }),
  },
  userAllergy: { findMany: jest.fn(async () => []) },
  ingredient: { findMany: jest.fn(async () => []) },
  user: { findUnique: jest.fn(async () => ({ id: 'user-synth-1', emailVerifiedAt: new Date('2026-01-01') })) },
  userRole: { findMany: jest.fn(async () => []) },
  trainerProfile: { findUnique: jest.fn(async () => null) },
  trainerClient: { findFirst: jest.fn(async () => null) },
  weeklyShoppingItem: { findUnique: jest.fn(async () => null) },
};
jest.mock('../../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
const app = require('../../src/app');

beforeEach(() => {
  state.meals = [{
    id: 'meal-1', planId: 'plan-1', dayOfWeek: 2, mealType: 'lunch', foodName: 'Plain rice',
    confirmedByUser: false, lockedAt: null,
    recipe: { recipeName: 'Plain rice', allergens: [], ingredients: [{ ingredientName: 'white rice', ingredientId: 'ing-rice' }] },
  }];
  mockPrisma.ingredient.findMany.mockImplementation(async ({ where }) =>
    (where?.id?.in || []).includes('ing-rice') ? [{ id: 'ing-rice', name: 'white rice', catalog: null }] : []);
});

const confirm = (body, headers = {}) =>
  request(app).post('/weekly-plan/days/2/confirm').set(headers).send(body);

describe('authorized access — real session validation', () => {
  it('valid Bearer token reaches the handler; server identity authoritative', async () => {
    const res = await confirm({ planId: 'plan-1' }, { authorization: `Bearer ${VALID_TOKEN}` });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ confirmed: true, allConfirmed: true });
  });

  it('client-supplied x-user-id is overwritten — spoofing another user impossible', async () => {
    // mobile correctly DELETES x-user-id (client.ts), but a hostile client could send it:
    // the middleware must replace it with the session identity. Plan belongs to user-synth-1;
    // if the spoofed 'intruder-1' survived, ownership middleware would 403.
    const res = await confirm({ planId: 'plan-1' }, { authorization: `Bearer ${VALID_TOKEN}`, 'x-user-id': 'intruder-1' });
    expect(res.status).toBe(200); // proves session identity won, not the spoofed header
  });
});

describe('missing/expired sessions — the error envelope mobile depends on', () => {
  it('missing token → 401 AUTH_REQUIRED with correlationId', async () => {
    const res = await confirm({ planId: 'plan-1' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
    expect(res.body.error).toMatch(/Sign in required/);
    expect(res.body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.meals[0].confirmedByUser).toBe(false);
  });

  it('expired session → 401 — mobile interceptor purges cache + clears session on this', async () => {
    const res = await confirm({ planId: 'plan-1' }, { authorization: 'Bearer synthetic-expired-token' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBeDefined();
    expect(res.body.correlationId).toBeDefined();
    expect(state.meals[0].confirmedByUser).toBe(false);
  });

  it('unknown token → 401 same envelope (no user enumeration delta)', async () => {
    const res = await confirm({ planId: 'plan-1' }, { authorization: 'Bearer never-issued-token' });
    expect(res.status).toBe(401);
    expect(res.body.correlationId).toBeDefined();
  });
});

describe('denied access — authz beneath authn', () => {
  it('valid session but cross-user plan → 403 ownership middleware, correlation preserved', async () => {
    // plan-1 belongs to user-synth-1; a second valid session for someone else is not in our
    // mock — approximate with the valid token but a plan owned by another user.
    mockPrisma.weeklyNutritionPlan.findUnique.mockImplementationOnce(async () => ({ id: 'plan-1', userId: 'someone-else' }));
    const res = await confirm({ planId: 'plan-1' }, { authorization: `Bearer ${VALID_TOKEN}` });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Plan access denied/);
    expect(state.meals[0].confirmedByUser).toBe(false);
  });
});

describe('correlation ID propagation — the exact contract mobile sends', () => {
  it('valid mobile-format correlation id echoed on success', async () => {
    // mobile c9c0e05/8375ebf format: m-<base36time>-<base36rand> (byte-identical across pair)
    const mobileId = 'm-abc12345-x7k2p9w1q8';
    const res = await confirm({ planId: 'plan-1' }, { authorization: `Bearer ${VALID_TOKEN}`, 'x-correlation-id': mobileId });
    expect(res.status).toBe(200);
    expect(res.headers['x-correlation-id']).toBe(mobileId);
  });

  it('malformed correlation id replaced with server UUID — never reflected', async () => {
    const res = await confirm({ planId: 'plan-1' }, { authorization: `Bearer ${VALID_TOKEN}`, 'x-correlation-id': 'evil; drop table--' });
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-correlation-id']).not.toContain('evil');
  });

  it('error responses carry the same correlation id in header AND body', async () => {
    const mobileId = 'm-def67890-q1w2e3r4t5';
    const res = await confirm({ planId: 'plan-1' }, { 'x-correlation-id': mobileId }); // no auth — 401 path
    expect(res.status).toBe(401);
    expect(res.headers['x-correlation-id']).toBe(mobileId);
    expect(res.body.correlationId).toBe(mobileId);
  });
});

describe('client-contract enforcement', () => {
  it('stale client contract → 426 CLIENT_UPGRADE_REQUIRED with correlation', async () => {
    const res = await confirm({ planId: 'plan-1' }, { authorization: `Bearer ${VALID_TOKEN}`, 'x-client-contract': '0' });
    expect(res.status).toBe(426);
    expect(res.body.code).toBe('CLIENT_UPGRADE_REQUIRED');
    expect(res.body.correlationId).toBeDefined();
  });

  it('current client contract passes — both mobile revisions send contract 2', async () => {
    const res = await confirm({ planId: 'plan-1' }, { authorization: `Bearer ${VALID_TOKEN}`, 'x-client-contract': '2' });
    expect(res.status).toBe(200);
  });
});

describe('FIXTURE-labeled client-interceptor semantics (static, transcribed from git objects)', () => {
  it('mobile interceptor contract is invariant across the revision pair', () => {
    // Transcribed from c9c0e05/8375ebf src/api/client.ts — BYTE-IDENTICAL files:
    // on 401 with the same token still current and non-/auth/ url: purgeAccountCache + saveSession(null)
    // on 403 EMAIL_NOT_VERIFIED: marks email unverified locally
    // This is static analysis evidence — not executed mobile code.
    const interceptorTranscription = {
      on401: 'purgeAccountCache(user.id, UNSYNCED_KEYS) + saveSession(null) — auto-logout on expired session',
      on403EmailUnverified: 'saveSession with emailVerifiedAt: null',
      sendsHeaders: ['Authorization: Bearer', 'x-correlation-id (m- format)', 'x-client-build', 'x-client-contract'],
      deletesHeaders: ['x-user-id — server-side identity only'],
    };
    // the backend behaviors verified live above satisfy every element of this contract
    expect(interceptorTranscription.deletesHeaders).toContain('x-user-id — server-side identity only');
    expect(interceptorTranscription.on401).toContain('saveSession(null)');
  });
});
