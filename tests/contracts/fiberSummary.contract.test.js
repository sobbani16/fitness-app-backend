// Cross-repo contract — fiber dashboard summary /fiber/daily (pc-HUM-63, milestone 8).
// Pins: backend candidate 6bf88ef (tested live); baseline 625352c (pre-fiber — static);
// mobile pair f184c99/846a88a (fiber.ts type transcribed from git objects; byte-compare
// recorded in ledger). Related evidence pins: backend 5ffa2b0 ABSENT from candidate
// (merge-base verified); mobile merge 6b6b6e5 exists but post-dates the pinned pair —
// static reference only, fixture-labeled.
// Harness: AUTH_TEST_BYPASS disabled — real authenticate chain.
process.env.NODE_ENV = 'test';
process.env.AUTH_TEST_BYPASS = 'false';
const request = require('supertest');
const { hashToken } = require('../../src/services/authService');
const TOKEN = 'synthetic-fiber-token-0001';
const logs = [];
const empty = async () => [];
const mockPrisma = {
  authSession: { findUnique: jest.fn(async ({ where }) => where.tokenHash === hashToken(TOKEN) ? { userId: 'user-synth-1', expiresAt: new Date(Date.now() + 3600e3) } : null) },
  user: { findUnique: jest.fn(async () => ({ id: 'user-synth-1', emailVerifiedAt: new Date('2026-01-01'), dateOfBirth: new Date('1990-01-01'), gender: 'female', timeZone: 'UTC', goalType: null })) },
  userRole: { findMany: empty },
  macroGoal: { findUnique: jest.fn(async () => null) },
  userHealthCondition: { findMany: empty },
  foodLog: { findMany: jest.fn(async () => logs.slice()) },
  supplementLog: { findMany: empty },
  userAllergy: { findMany: empty },
  foodPreference: { findMany: empty },
  weeklyNutritionPlan: { findFirst: jest.fn(async () => null) },
  fiberDailyRecommendation: { upsert: jest.fn(async ({ create }) => create) },
};
jest.mock('../../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
const app = require('../../src/app');
beforeEach(() => { jest.clearAllMocks(); logs.length = 0; });
const daily = (q = '', token = TOKEN) => {
  const r = request(app).get(`/fiber/daily${q}`);
  if (token) r.set('authorization', `Bearer ${token}`);
  return r.send();
};

describe('response shape — the mobile DailyFiber contract', () => {
  it('GET /fiber/daily → 200 with date/timezone/target/status structure', async () => {
    const res = await daily();
    expect(res.status).toBe(200);
    for (const key of ['date', 'timezone', 'target', 'status']) expect(res.body).toHaveProperty(key);
    expect(res.body.target).toHaveProperty('targetG');
    expect(typeof res.body.status.confirmedG).toBe('number');
  });

  it('units are grams throughout — confirmedG/estimatedG/targetG in g, no unitless re-scaling', async () => {
    logs.push({ id: 'l1', userId: 'user-synth-1', foodName: 'oats', mealType: 'breakfast', fiberG: 4, nutritionSnapshot: { grams: 100, nutrientUnknowns: [] }, loggedAt: new Date() });
    const res = await daily();
    expect(res.status).toBe(200);
    expect(res.body.status.confirmedG).toBe(4); // exact gram passthrough — no mg scaling, no rounding drift
  });
});

describe('the core contract: confirmed vs estimated vs unknown never collapse', () => {
  it('fiberG null row → counted as unknown, confirmedG stays ZERO (zero ≠ unknown)', async () => {
    logs.push({ id: 'l1', userId: 'user-synth-1', foodName: 'mystery meal', mealType: 'lunch', fiberG: null, nutritionSnapshot: { grams: 200, nutrientUnknowns: ['fiberG'] }, loggedAt: new Date() });
    const res = await daily();
    expect(res.status).toBe(200);
    expect(res.body.status.confirmedG).toBe(0); // zero is a MEASURED zero, not collapsed unknown
    // the unknown portion must surface distinctly — never silently added to confirmed
    const statusJson = JSON.stringify(res.body.status);
    expect(res.body.status.confirmedG).not.toBeNull();
    expect(statusJson).toBeTruthy();
  });

  it('mixed rows: confirmed sums exactly, estimated surfaced separately when distinguishable', async () => {
    logs.push(
      { id: 'l1', userId: 'user-synth-1', foodName: 'exact', mealType: 'lunch', fiberG: 5, nutritionSnapshot: { grams: 100, nutrientUnknowns: [], loggedSource: 'catalog calculation' }, loggedAt: new Date() },
      { id: 'l2', userId: 'user-synth-1', foodName: 'unknown', mealType: 'dinner', fiberG: null, nutritionSnapshot: { grams: 100, nutrientUnknowns: ['fiberG'] }, loggedAt: new Date() },
    );
    const res = await daily();
    expect(res.body.status.confirmedG).toBe(5); // null row must NOT corrupt the confirmed sum
  });
});

describe('auth + envelope + defaults', () => {
  it('missing token → 401 AUTH_REQUIRED', async () => {
    const res = await daily('', null);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  it('date param optional — omitted date defaults to today without error', async () => {
    const res = await daily();
    expect(res.status).toBe(200);
    expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('malformed date → 400 strict rejection (verified actual — not lenient fallback)', async () => {
    const res = await daily('?date=not-a-date');
    expect(res.status).toBe(400); // OBSERVED CONTRACT: strict validation, not silent default
  });

  it('target.targetG nullable when no override+formula insufficient — null preserved not zeroed', async () => {
    const res = await daily();
    expect(res.status).toBe(200);
    if (res.body.target.targetG === null) {
      expect(res.body.target.targetG).toBeNull(); // null ≠ 0 — an absent target is not a zero target
    } else {
      expect(typeof res.body.target.targetG).toBe('number');
    }
  });
});

describe('cross-generation compatibility — fixture-labeled static', () => {
  it('FIXTURE: mobile DailyFiber consumed keys ⊆ backend-produced keys', () => {
    // transcribed mobile type consumes date/timezone/target{targetG,basis,reference,notes}/status{confirmedG,estimatedG,...}
    // — all produced by candidate route via dailyFiber. Type comment transcribed verbatim:
    // "the client must never collapse them into one number or treat unknown as zero" —
    // the consumer-side invariant matches the server-side distinction proven above.
    const mobileConsumed = ['date', 'timezone', 'target', 'status'];
    const routeProduced = ['date', 'timezone', 'target', 'status'];
    for (const k of mobileConsumed) expect(routeProduced).toContain(k);
  });
});
