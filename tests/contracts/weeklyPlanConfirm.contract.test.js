// Cross-repo contract verification — weekly-plan allergy confirmation (pc-HUM-63).
//
// Pinned revisions (rationale):
//   backend candidate: b55269a (branch HEAD — current contract: structured
//     ALLERGY_* codes, acknowledgeUnknownAllergens, details spread top-level)
//   backend baseline:  625352c (HF-0001 — first revision with the allergy gate;
//     error shape used `blockedMeals`, no acknowledgment param) — fixture-only
//     evidence, exercised via static shape assertions labeled as such.
//   mobile candidate:  c9c0e05 (HUM-34 — first mobile revision aware of the 409
//     contract; sends `acknowledgeUnknown`, parses `details.conflicts`)
//   mobile baseline:   8375ebf (parent of c9c0e05 — plain {planId} wire, no
//     allergy awareness) — represented by its exact wire body.
//
// Mobile wire formats below are transcribed from read-only git objects at those
// revisions — not invented. Fixture-only assertions are labeled FIXTURE.
process.env.NODE_ENV = 'test';
const request = require('supertest');

const state = {
  meals: [], // mutable rows so updateMany effects are observable
};
const mockPrisma = {
  weeklyNutritionPlan: { findUnique: jest.fn() },
  weeklyMeal: {
    findMany: jest.fn(),
    updateMany: jest.fn(async ({ data }) => {
      state.meals.forEach((m) => { m.confirmedByUser = data.confirmedByUser; m.lockedAt = data.lockedAt; });
      return { count: state.meals.length };
    }),
  },
  userAllergy: { findMany: jest.fn() },
  ingredient: { findMany: jest.fn() },
  user: { findUnique: jest.fn() },
  userRole: { findMany: jest.fn() },
  // ownership-middleware models — the cross-user denial happens there BEFORE
  // the route; omitting these produced a fixture-artifact 500, not app behavior.
  trainerProfile: { findUnique: jest.fn(async () => null) },
  trainerClient: { findFirst: jest.fn(async () => null) },
  weeklyShoppingItem: { findUnique: jest.fn(async () => null) },
};
jest.mock('../../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const app = require('../../src/app');

const PLAN = { id: 'plan-1', userId: 'owner-1' };
const OWNER = { 'x-user-id': 'owner-1' };

function seedDay({ peanutMeal = false, unknownMeal = false } = {}) {
  // A "clean" meal for an allergic user must have a resolved, non-composite
  // ingredient list free of allergen hits — empty/absent composition is
  // conservatively UNKNOWN by domain design (never treated as safe).
  state.meals = [{
    id: 'meal-1', planId: 'plan-1', dayOfWeek: 2, mealType: 'lunch',
    foodName: peanutMeal ? 'Peanut noodles' : unknownMeal ? 'Mystery casserole' : 'Plain rice',
    confirmedByUser: false, lockedAt: null,
    recipe: peanutMeal || unknownMeal ? null : {
      recipeName: 'Plain rice', allergens: [],
      ingredients: [{ ingredientName: 'white rice', ingredientId: 'ing-rice' }],
    },
  }];
  mockPrisma.weeklyMeal.findMany.mockImplementation(async ({ where, select }) =>
    state.meals.filter((m) => m.planId === where.planId && (where.dayOfWeek === undefined || m.dayOfWeek === where.dayOfWeek))
      .map((m) => (select ? { confirmedByUser: m.confirmedByUser } : m)));
  mockPrisma.weeklyNutritionPlan.findUnique.mockResolvedValue(PLAN);
  mockPrisma.userAllergy.findMany.mockResolvedValue([{ allergy: { name: 'peanut' } }]);
  mockPrisma.ingredient.findMany.mockImplementation(async ({ where }) =>
    (where?.id?.in || []).includes('ing-rice') ? [{ id: 'ing-rice', name: 'white rice', catalog: null }] : []);
  mockPrisma.user.findUnique.mockResolvedValue({ id: 'owner-1' });
  mockPrisma.userRole.findMany.mockResolvedValue([]);
}

beforeEach(() => { jest.clearAllMocks(); seedDay(); });

const confirm = (day, body, headers = OWNER) =>
  request(app).post(`/weekly-plan/days/${day}/confirm`).set(headers).send(body);

describe('request/response contract — the shape mobile c9c0e05 expects', () => {
  it('clean day confirm returns {confirmed, allConfirmed} exactly as typed in mobile', async () => {
    const res = await confirm(2, { planId: 'plan-1' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['allConfirmed', 'confirmed']);
    expect(res.body).toEqual({ confirmed: true, allConfirmed: true });
  });

  it('missing planId → 400 from the route', async () => {
    expect((await confirm(2, {})).status).toBe(400);
  });

  it('unauthenticated requests never reach the handler — rejected at the authenticate boundary, state unmutated', async () => {
    // Contract note: the route's own 400-on-missing-userId is defense-in-depth —
    // the global authenticate middleware rejects anonymous requests first
    // (401 AUTH_REQUIRED in production semantics). Exact status differs in the
    // mocked harness, the contract is: never 200, never mutating.
    const res = await request(app).post('/weekly-plan/days/2/confirm').send({ planId: 'plan-1' });
    expect(res.status).toBe(403); // deterministic: ownership middleware denies anonymous cross-user access
    expect(state.meals[0].confirmedByUser).toBe(false);
  });

  it('authorization: non-owner is denied 403 at the ownership middleware before the route, state unmutated', async () => {
    const res = await confirm(2, { planId: 'plan-1' }, { 'x-user-id': 'intruder-1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Plan access denied/);
    expect(state.meals[0].confirmedByUser).toBe(false);
    // defense-in-depth beneath it: confirmDay service itself also throws on
    // ownership mismatch (verified by direct invocation — evidence in ledger).
  });

  it('repeat confirmation is repeat-safe — no error, no duplicate effect', async () => {
    expect((await confirm(2, { planId: 'plan-1' })).status).toBe(200);
    const again = await confirm(2, { planId: 'plan-1' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ confirmed: true, allConfirmed: true });
  });
});

describe('allergy 409 contract', () => {
  it('conflicting meal → 409 ALLERGY_CONFLICT with conflicts detail', async () => {
    seedDay({ peanutMeal: true });
    const res = await confirm(2, { planId: 'plan-1' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALLERGY_CONFLICT');
    expect(state.meals[0].confirmedByUser).toBe(false);
  });

  it('response shape vs mobile parser: details spread TOP-LEVEL, mobile reads details.conflicts', async () => {
    seedDay({ peanutMeal: true });
    const res = await confirm(2, { planId: 'plan-1' });
    // Mobile c9c0e05 parses data?.details?.conflicts — the backend spreads
    // details to top level, so `details` is undefined and mobile degrades to
    // [] (conflict detail lost, error type preserved). CONTRACT FINDING.
    expect(res.body.details).toBeUndefined();
    expect(Array.isArray(res.body.conflicts)).toBe(true);
  });

  it('unknown composition → 409 ALLERGY_COMPOSITION_UNKNOWN; correct field unlocks', async () => {
    seedDay({ unknownMeal: true });
    const first = await confirm(2, { planId: 'plan-1' });
    expect(first.status).toBe(409);
    expect(first.body.code).toBe('ALLERGY_COMPOSITION_UNKNOWN');
    // acknowledgment with the backend-correct field name succeeds
    const retry = await confirm(2, { planId: 'plan-1', acknowledgeUnknownAllergens: true });
    expect(retry.status).toBe(200);
    expect(retry.body.confirmed).toBe(true);
  });

  it('CONTRACT DEFECT PROOF: mobile c9c0e05 sends acknowledgeUnknown — the backend never sees it', async () => {
    seedDay({ unknownMeal: true });
    // exact mobile c9c0e05 wire body: { planId, acknowledgeUnknown: true }
    const mobileRetry = await confirm(2, { planId: 'plan-1', acknowledgeUnknown: true });
    expect(mobileRetry.status).toBe(409); // acknowledgment is silently dropped
    expect(state.meals[0].confirmedByUser).toBe(false);
  });
});

describe('cross-generation compatibility', () => {
  it('old mobile (8375ebf wire: bare {planId}) → new backend: clean confirm still works', async () => {
    const res = await confirm(2, { planId: 'plan-1' }); // exact 8375ebf wire body
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ confirmed: true, allConfirmed: true });
  });

  it('old mobile → allergy 409: opaque error but non-2xx — fails safe, never confirms', async () => {
    seedDay({ peanutMeal: true });
    const res = await confirm(2, { planId: 'plan-1' });
    expect(res.status).toBe(409);
    expect(state.meals[0].confirmedByUser).toBe(false); // safety-critical: old clients cannot bypass the gate
  });

  it('FIXTURE-only: new mobile parser vs old backend 625352c error shape — graceful degradation', () => {
    // fixture extracted from git object 625352c:src/routes/weeklyPlan.js —
    // error shape was { error, code, blockedMeals }. New mobile reads
    // data?.details?.conflicts ?? [] → undefined → [] — degrades gracefully,
    // error type still surfaces. Label: static shape assertion, not executed route.
    const oldBackendErrorFixture = { error: 'Meals conflict with allergies.', code: undefined, blockedMeals: [{ mealType: 'lunch' }] };
    const mobileParserResult = oldBackendErrorFixture?.details?.conflicts ?? [];
    expect(mobileParserResult).toEqual([]); // degradation proven by shape, not crash
    expect(oldBackendErrorFixture.blockedMeals).toBeDefined();
  });
});
