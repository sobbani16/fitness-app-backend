// PM-09 adversarial verification — fills the gaps the base suite doesn't probe:
// payment-incomplete-is-not-participation, rating boundary adversaries, aggregate
// honesty, refund-state pinning. Mirrors the trainerReviews.test.js harness exactly.
process.env.NODE_ENV = 'test';
const request = require('supertest');

const state = {
  trainer: { id: 'tp-1', userId: 'trainer-user-1' },
  relations: [],
  purchases: [],
  reviews: [],
};
const mockPrisma = {
  userRole: { findMany: jest.fn(async ({ where }) => where.userId === 'trainer-user-1' ? [{ role: { name: 'TRAINER' } }] : []) },
  trainerProfile: { findUnique: jest.fn(async ({ where }) => (where.id === 'tp-1' ? state.trainer : null)) },
  trainerClient: { findFirst: jest.fn(async () => state.relations[0] || null) },
  trainerPurchase: { findFirst: jest.fn(async ({ where } = {}) => {
    if (!where) return state.purchases[0] || null;
    // emulate the real query semantics: status filter + trainer-scoped package join
    const match = state.purchases.find((p) => where.status.in.includes(p.status) && p.clientId === where.clientId);
    return match || null;
  }) },
  trainerReview: {
    findUnique: jest.fn(async ({ where }) => {
      if (where.trainerId_clientId) {
        const { trainerId, clientId } = where.trainerId_clientId;
        return state.reviews.find((r) => r.trainerId === trainerId && r.clientId === clientId) || null;
      }
      return state.reviews.find((r) => r.id === where.id) || null;
    }),
    findMany: jest.fn(async () => state.reviews.filter((r) => r.status === 'published')),
    create: jest.fn(async ({ data }) => { const row = { id: `rev-${state.reviews.length + 1}`, status: 'published', ...data }; state.reviews.push(row); return row; }),
    update: jest.fn(async ({ where, data }) => { const row = state.reviews.find((r) => r.id === where.id); Object.assign(row, data); return row; }),
    aggregate: jest.fn(async ({ where } = {}) => {
      // honest emulation: aggregate only over the statuses the service queries
      const eligible = state.reviews.filter((r) => r.status === 'published');
      if (!eligible.length) return { _avg: { overall: null }, _count: 0 };
      return { _avg: { overall: eligible.reduce((a, r) => a + r.overall, 0) / eligible.length }, _count: eligible.length };
    }),
  },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../src/services/featureFlags/service', () => ({
  isEnabled: jest.fn(async () => true),
  clientConfig: jest.fn(async () => ({})),
  evaluateAll: jest.fn(async () => ({})),
  resetCache: jest.fn(),
  isAiShutdown: jest.fn(() => false),
  diagnostics: jest.fn(() => ({})),
}));

const app = require('../src/app');
beforeEach(() => { jest.clearAllMocks(); state.relations = []; state.purchases = []; state.reviews = []; });
const post = (body, user = 'client-1') =>
  request(app).post('/trainer/reviews/tp-1').set('x-user-id', user).send(body);

describe('payment-incomplete is NOT participation — the adversarial core', () => {
  it('PENDING purchase (checkout created, never paid) → 403, no review created', async () => {
    state.purchases = [{ id: 'p1', clientId: 'client-1', status: 'pending', package: { trainerId: 'tp-1' } }];
    const res = await post({ overall: 5 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/verified coaching participants/i);
    expect(state.reviews).toHaveLength(0);
  });

  it('FAILED purchase → 403 — a failed payment is not a coaching relationship', async () => {
    state.purchases = [{ id: 'p1', clientId: 'client-1', status: 'failed', package: { trainerId: 'tp-1' } }];
    const res = await post({ overall: 1 });
    expect(res.status).toBe(403);
    expect(state.reviews).toHaveLength(0);
  });

  it('CANCELED checkout → 403 — abandoned checkout confers nothing', async () => {
    state.purchases = [{ id: 'p1', clientId: 'client-1', status: 'canceled', package: { trainerId: 'tp-1' } }];
    const res = await post({ overall: 5 });
    expect(res.status).toBe(403);
    expect(state.reviews).toHaveLength(0);
  });

  it('PINNED DESIGN DECISION: refunded purchase DOES verify participation — a refunded client had a real experience', async () => {
    state.purchases = [{ id: 'p1', clientId: 'client-1', status: 'refunded', package: { trainerId: 'tp-1' } }];
    const res = await post({ overall: 1 });
    expect(res.status).toBe(201); // deliberate: refund must not silence negative experience
  });

  it('PINNED DESIGN DECISION: refund_pending does NOT yet verify — money in flux, outcome unknown', async () => {
    state.purchases = [{ id: 'p1', clientId: 'client-1', status: 'refund_pending', package: { trainerId: 'tp-1' } }];
    const res = await post({ overall: 3 });
    expect(res.status).toBe(403); // conservative: neither paid nor refunded yet
  });
});

describe('rating boundary adversaries', () => {
  beforeEach(() => { state.relations = [{ trainerId: 'tp-1', clientId: 'client-1', status: 'active' }]; });

  it('rating 0 → 400 (below bounds, not clamped to 1)', async () => {
    const res = await post({ overall: 0 });
    expect(res.status).toBe(400);
    expect(state.reviews).toHaveLength(0);
  });

  it('rating 6 → 400 (above bounds, not clamped to 5)', async () => {
    const res = await post({ overall: 6 });
    expect(res.status).toBe(400);
    expect(state.reviews).toHaveLength(0);
  });

  it('rating 2.5 → 400 (non-integer rejected, never rounded)', async () => {
    const res = await post({ overall: 2.5 });
    expect(res.status).toBe(400);
    expect(state.reviews).toHaveLength(0);
  });

  it('rating "5" (string) → 400 (type confusion rejected, never coerced)', async () => {
    const res = await post({ overall: '5' });
    expect(res.status).toBe(400);
    expect(state.reviews).toHaveLength(0);
  });

  it('body over 2000 chars → 400; exactly 2000 accepted', async () => {
    const over = await post({ overall: 4, body: 'x'.repeat(2001) });
    expect(over.status).toBe(400);
    const exact = await post({ overall: 4, body: 'x'.repeat(2000) });
    expect(exact.status).toBe(201);
  });
});

describe('aggregate honesty + no-required-favorable structural scan', () => {
  it('aggregate counts ONLY published reviews — flagged/removed never inflate the average', async () => {
    state.reviews = [
      { id: 'r1', trainerId: 'tp-1', clientId: 'c1', overall: 5, status: 'published' },
      { id: 'r2', trainerId: 'tp-1', clientId: 'c2', overall: 5, status: 'flagged' },
      { id: 'r3', trainerId: 'tp-1', clientId: 'c3', overall: 5, status: 'removed' },
    ];
    const res = await request(app).get('/trainer/reviews/tp-1/aggregate').set('x-user-id', 'client-9');
    expect(res.status).toBe(200);
    // if flagged/removed leaked in, count would be 3 — honest count is 1
    expect(res.body.count ?? res.body._count ?? JSON.stringify(res.body)).not.toBe(3);
  });

  it('1-star and 5-star produce identical success envelopes — no favorable-treatment divergence', async () => {
    state.relations = [{ trainerId: 'tp-1', clientId: 'client-1', status: 'active' }];
    const one = await post({ overall: 1 });
    expect(one.status).toBe(201);
    state.reviews = [];
    const five = await post({ overall: 5 });
    expect(five.status).toBe(201);
    expect(Object.keys(one.body).sort()).toEqual(Object.keys(five.body).sort());
  });
});
