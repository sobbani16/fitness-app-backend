// Route tests — trainer review HTTP surface (pc-HUM-143).
process.env.NODE_ENV = 'test';
const request = require('supertest');

const state = {
  trainer: { id: 'tp-1', userId: 'trainer-user-1' },
  relations: [],
  purchases: [],
  reviews: [],
};
const mockPrisma = {
  userRole: { findMany: jest.fn(async ({ where }) => where.userId === 'admin-1' ? [{ role: { name: 'ADMIN' } }] : where.userId === 'trainer-user-1' ? [{ role: { name: 'TRAINER' } }] : []) },
  trainerProfile: { findUnique: jest.fn(async ({ where }) => (where.id === 'tp-1' ? state.trainer : null)) },
  trainerClient: { findFirst: jest.fn(async () => state.relations[0] || null) },
  trainerPurchase: { findFirst: jest.fn(async () => state.purchases[0] || null) },
  trainerReview: {
    findUnique: jest.fn(async ({ where }) => {
      if (where.id) return state.reviews.find((r) => r.id === where.id) || null;
      if (where.trainerId_clientId) {
        const { trainerId, clientId } = where.trainerId_clientId;
        return state.reviews.find((r) => r.trainerId === trainerId && r.clientId === clientId) || null;
      }
      return null;
    }),
    findMany: jest.fn(async () => state.reviews.filter((r) => r.status === 'published')),
    create: jest.fn(async ({ data }) => { const row = { id: `rev-${state.reviews.length + 1}`, status: 'published', ...data }; state.reviews.push(row); return row; }),
    update: jest.fn(async ({ where, data }) => {
      const row = state.reviews.find((r) => r.id === where.id);
      Object.assign(row, data);
      return row;
    }),
    aggregate: jest.fn(async () => ({ _avg: { overall: 4.5 }, _count: 2 })),
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
beforeEach(() => {
  jest.clearAllMocks();
  state.relations = [{ trainerId: 'tp-1', clientId: 'client-1', status: 'active' }];
  state.purchases = [];
  state.reviews = [];
});

const as = (userId, roles = []) => ({ 'x-user-id': userId, 'x-user-roles': roles.join(',') });

describe('POST /trainer/reviews/:trainerProfileId — verified-participant write', () => {
  it('active coaching relation → 201 creates review', async () => {
    const res = await request(app).post('/trainer/reviews/tp-1').set(as('client-1')).send({ overall: 5, quality: 4, body: 'Excellent structured coaching.' });
    expect(res.status).toBe(201);
    expect(res.body.overall).toBe(5);
  });

  it('no relation and no purchase → 403 verified-participant gate', async () => {
    state.relations = [];
    const res = await request(app).post('/trainer/reviews/tp-1').set(as('stranger-1')).send({ overall: 5 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/verified coaching participants/);
  });

  it('paid purchase (no relation) → 201 — purchase also verifies participation', async () => {
    state.relations = [];
    state.purchases = [{ clientId: 'client-1', status: 'paid' }];
    const res = await request(app).post('/trainer/reviews/tp-1').set(as('client-1')).send({ overall: 4 });
    expect(res.status).toBe(201);
  });

  it('self-review → 403 professionals cannot review own profile', async () => {
    const res = await request(app).post('/trainer/reviews/tp-1').set(as('trainer-user-1')).send({ overall: 5 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/own profile/);
  });

  it('repeat submission edits in place — no duplicate accumulation', async () => {
    await request(app).post('/trainer/reviews/tp-1').set(as('client-1')).send({ overall: 5 });
    const second = await request(app).post('/trainer/reviews/tp-1').set(as('client-1')).send({ overall: 3, body: 'Revised down after poor follow-through.' });
    expect(second.status).toBe(201);
    expect(state.reviews.length).toBe(1);
    expect(state.reviews[0].overall).toBe(3); // honest current assessment, not averaged manipulation
  });

  it('low ratings accepted identically — no favorable-review requirement', async () => {
    const res = await request(app).post('/trainer/reviews/tp-1').set(as('client-1')).send({ overall: 1, body: 'Did not deliver the promised plan.' });
    expect(res.status).toBe(201);
    expect(res.body.overall).toBe(1);
  });
});

describe('GET listing + aggregate — published-only surface', () => {
  it('returns only published reviews with public projection', async () => {
    state.reviews = [
      { id: 'r1', trainerId: 'tp-1', clientId: 'c1', overall: 5, status: 'published', body: 'great' },
      { id: 'r2', trainerId: 'tp-1', clientId: 'c2', overall: 1, status: 'removed', body: 'hidden' },
    ];
    const res = await request(app).get('/trainer/reviews/tp-1').set(as('anyone-1'));
    expect(res.status).toBe(200);
    expect(res.body.reviews.length).toBe(1); // removed never surfaces
  });
});

describe('moderation separation', () => {
  it('flagging without reason → 400 (moderation trail never unexplained)', async () => {
    state.reviews = [{ id: 'r1', trainerId: 'tp-1', clientId: 'c1', overall: 2, status: 'published' }];
    const res = await request(app).post('/trainer/reviews/r1/moderate').set(as('admin-1', ['ADMIN'])).send({ status: 'flagged' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/flaggedReason/);
  });
});
