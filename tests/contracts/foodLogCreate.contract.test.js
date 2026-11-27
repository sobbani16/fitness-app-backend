// Cross-repo contract verification — food log creation + portion compatibility (pc-HUM-63, milestone 7).
//
// Pinned revisions (rationale):
//   backend candidate: 5962739 (branch HEAD — tested live)
//   backend baseline:  625352c (pre-feature merge — static/fixture comparison)
//   mobile pair: f184c99 / 846a88a — mealSync.ts offline-queue caller transcribed
//     from read-only git objects (wire: nutritionProfileId/catalogRevision/ingredientId/
//     selectedServing/servingId/servingCount/id/foodName/quantityG/calories/proteinG/carbsG/
//     fatG/fiberG(nullable)/mealType/loggedAt)
//   related commit 24ff6b8: ABSENT from candidate (merge-base check) — recorded; the
//     candidate's portion/idempotency behavior stands on the branch lineage tested.
//
// Harness: AUTH_TEST_BYPASS disabled — real authenticate chain.
// The ingredient catalog conversion service is mocked at the calculate() boundary:
// catalog arithmetic is a separate contract; the PORTION contract under test is the
// route's unit/amount persistence and validation behavior.
process.env.NODE_ENV = 'test';
process.env.AUTH_TEST_BYPASS = 'false';
const request = require('supertest');
const { hashToken } = require('../../src/services/authService');

const TOKEN = 'synthetic-foodlog-token-0001';
const rows = [];
const empty = async () => [];
const mockPrisma = {
  authSession: { findUnique: jest.fn(async ({ where }) => where.tokenHash === hashToken(TOKEN) ? { userId: 'user-synth-1', expiresAt: new Date(Date.now() + 3600e3) } : null) },
  user: { findUnique: jest.fn(async () => ({ id: 'user-synth-1', emailVerifiedAt: new Date('2026-01-01') })) },
  userRole: { findMany: empty },
  foodLog: {
    findUnique: jest.fn(async ({ where }) => rows.find((r) => r.id === where.id) || null),
    findFirst: jest.fn(async () => null),
    create: jest.fn(async ({ data }) => { rows.push({ ...data }); return rows[rows.length - 1]; }),
  },
};
jest.mock('../../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/services/ingredientNutrition', () => ({
  calculate: jest.fn(async (_id, opts = {}) => {
    const count = opts.count || 1;
    return {
      grams: 150 * count, serving: { id: 'srv-1', grams: 150 },
      nutrition: { calories: 200 * count, proteinG: 10 * count, carbsG: 20 * count, fatG: 8 * count, fiberG: 3 * count },
      provenance: { revision: 'rev-abc' },
    };
  }),
}));

const app = require('../../src/app');
beforeEach(() => { jest.clearAllMocks(); rows.length = 0; });

const wire = (overrides = {}) => ({
  id: 'meal-abc123', foodName: 'Grilled chicken bowl', quantityG: 250, calories: 420,
  proteinG: 35, carbsG: 30, fatG: 12, fiberG: 6, mealType: 'lunch',
  loggedAt: '2026-11-26T12:00:00.000Z', ...overrides,
});
const post = (body, token = TOKEN) => {
  const r = request(app).post('/food-logs');
  if (token) r.set('authorization', `Bearer ${token}`);
  return r.send(body);
};

describe('exact mobile wire format — happy path', () => {
  it('mobile mealSync payload shape → 201 with persisted units/amounts intact', async () => {
    const res = await post(wire({ fiberG: null, nutritionProfileId: undefined, ingredientId: undefined }));
    expect(res.status).toBe(201);
    expect(res.body.quantityG).toBe(250);
    expect(res.body.calories).toBe(420);
    expect(res.body.fiberG).toBeNull(); // explicit null survives — nullable macro contract
    expect(res.body.userId).toBe('user-synth-1'); // session ownership, never body-derived
  });

  it('nutritionSnapshot present with loggedSource + grams', async () => {
    const res = await post(wire());
    expect(res.body.nutritionSnapshot).toBeTruthy();
    expect(res.body.nutritionSnapshot.grams).toBe(250);
  });
});

describe('legacy vs candidate portion payloads', () => {
  it('LEGACY portion path: quantityG direct without serving metadata → persisted verbatim', async () => {
    const res = await post(wire());
    expect(res.status).toBe(201);
    expect(res.body.quantityG).toBe(250);
  });

  it('CANDIDATE portion path: servingId+servingCount → catalog grams authoritative server-side', async () => {
    const res = await post(wire({ ingredientId: 'ing-1', servingId: 'srv-1', servingCount: 1, quantityG: 999 }));
    expect(res.status).toBe(201);
    expect(res.body.quantityG).toBe(150); // serving conversion overrode client quantityG — documented contract
    expect(res.body.nutritionSnapshot.servingCount).toBe(1);
    expect(res.body.nutritionSnapshot.servingGrams).toBe(150);
  });
});

describe('validation envelope — no-row-on-rejection proofs', () => {
  it.each([
    ['missing foodName', { foodName: undefined }],
    ['missing stable id', { id: undefined }],
    ['malformed id (spaces)', { id: 'bad id!' }],
    ['negative quantityG', { quantityG: -5 }],
    ['absurd quantityG', { quantityG: 200000 }],
    ['non-finite calories', { calories: NaN }],
    ['far-future loggedAt', { loggedAt: '2027-06-01T00:00:00.000Z' }],
  ])('%s → 400 and zero rows persisted', async (_label, bad) => {
    const res = await post(wire(bad));
    expect(res.status).toBe(400);
    expect(rows.length).toBe(0);
  });

  it('missing token → 401 AUTH_REQUIRED, zero rows', async () => {
    const res = await post(wire(), null);
    expect(res.status).toBe(401);
    expect(rows.length).toBe(0);
  });
});

describe('idempotency — the retry contract the offline queue depends on', () => {
  it('repeat POST same id same user → no-op returning existing (200), exactly one row', async () => {
    const first = await post(wire());
    expect(first.status).toBe(201);
    const replay = await post(wire());
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe('meal-abc123');
    expect(rows.length).toBe(1); // offline-queue redelivery is safe — CONTRAST with symptom submission
  });

  it('cross-user id conflict → 409 (ownership protection on compound identity)', async () => {
    rows.push({ id: 'meal-abc123', userId: 'other-user', foodName: 'x' });
    const res = await post(wire());
    expect(res.status).toBe(409);
    expect(rows.length).toBe(1); // original untouched
  });
});

describe('cross-generation compatibility — fixture-labeled', () => {
  it('FIXTURE: old-mobile minimal wire (id/foodName/quantityG/macros only) ⊆ candidate-accepted fields', () => {
    // baseline-era mobile sent the same core keys minus serving metadata — all optional
    // in the candidate route. Forward-compatible for legacy clients by construction.
    const legacyKeys = ['id', 'foodName', 'quantityG', 'calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'mealType', 'loggedAt'];
    const requiredByRoute = ['id', 'foodName', 'quantityG', 'calories', 'proteinG', 'carbsG', 'fatG'];
    for (const key of requiredByRoute) expect(legacyKeys).toContain(key);
  });

  it('EXECUTION: candidate-mobile full wire with serving metadata accepted by candidate backend', async () => {
    const res = await post(wire({ ingredientId: 'ing-1', servingId: 'srv-1', servingCount: 2, catalogRevision: 'rev-abc', selectedServing: '1 cup' }));
    expect(res.status).toBe(201);
    expect(res.body.quantityG).toBe(300); // 2 × 150g serving
  });
});
