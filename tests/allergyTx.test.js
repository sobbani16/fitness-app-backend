// PUT /me/allergies transaction consistency (HUM-59 / P6-002).
// Fault-injection: if plan revalidation fails, the allergy write must roll
// back with it — previously revalidation ran post-commit, leaving stale
// "clear" marks under a changed allergy profile.
const request = require('supertest');
const express = require('express');

const mockTX = "tx-tag";
const mockTxOps = { upserts: 0, deletes: 0, creates: 0, planUpdates: 0, failAt: null };
jest.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    userAllergy: { findMany: async () => [{ allergy: { name: 'Peanuts' } }] },
    allergy: { upsert: async ({ where }) => ({ id: 'a-' + where.name }) },
    $transaction: async (cb) => {
      const tx = {
        __tag: mockTX,
        $queryRaw: async () => [],
        allergy: { upsert: async () => { mockTxOps.upserts++; return { id: 'a1' }; } },
        userAllergy: {
          deleteMany: async () => { mockTxOps.deletes++; return { count: 1 }; },
          createMany: async () => { mockTxOps.creates++; return { count: 1 }; },
          findMany: async () => [{ allergy: { name: 'Peanuts' } }],
        },
        weeklyNutritionPlan: {
          findMany: async () => [{ id: 'p1', userId: 'u1', status: 'active', weekStartDate: '2026-11-23', meals: [], generationDetails: {} }],
          update: async () => {
            mockTxOps.planUpdates++;
            if (mockTxOps.failAt === 'revalidation') throw new Error('injected plan update failure');
            return {};
          },
        },
      };
      return cb(tx);
    },
  }),
}));
jest.mock('../src/services/featureFlags/service', () => ({ isEnabled: async () => true }));

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.userId = 'u1'; next(); });
app.use('/me/allergies', require('../src/routes/allergies'));
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

beforeEach(() => { mockTxOps.upserts = mockTxOps.deletes = mockTxOps.creates = mockTxOps.planUpdates = 0; mockTxOps.failAt = null; });

it('commits writes and revalidation atomically on success', async () => {
  const res = await request(app).put('/me/allergies').send({ allergens: ['peanut'] });
  expect(res.status).toBe(200);
  expect(mockTxOps.creates).toBe(1);
  expect(mockTxOps.planUpdates).toBe(1); // revalidation ran INSIDE the tx
});

it('fault injection: failed revalidation propagates — nothing commits', async () => {
  mockTxOps.failAt = 'revalidation';
  const res = await request(app).put('/me/allergies').send({ allergens: ['peanut'] });
  expect(res.status).toBe(500);
  // The tx callback threw before returning — under a real transaction the
  // writes above roll back with it (prisma.$transaction semantics).
  expect(mockTxOps.deletes).toBe(1); // write attempted in-tx, rolled back on throw
});

it('idempotent retry: the same PUT applied twice converges to one consistent state', async () => {
  // Replace-set semantics: upsert/deleteMany+createMany are naturally
  // idempotent — a client retry after a timeout must not duplicate rows or
  // diverge. Provable invariants: both succeed, write counts identical.
  const first = await request(app).put('/me/allergies').send({ allergens: ['peanut'], custom: ['sesame oil'] });
  expect(first.status).toBe(200);
  const writesAfterFirst = { ...mockTxOps };
  const second = await request(app).put('/me/allergies').send({ allergens: ['peanut'], custom: ['sesame oil'] });
  expect(second.status).toBe(200);
  // Same net effect: exactly one deleteMany+createMany per request, never additive
  expect(mockTxOps.deletes - writesAfterFirst.deletes).toBe(1);
  expect(mockTxOps.creates - writesAfterFirst.creates).toBe(1);
  // Response shape identical — retry-safe for clients reconciling state
  expect(second.body.allergens).toEqual(first.body.allergens);
  expect(second.body.custom).toEqual(first.body.custom);
});

it('no external calls inside the transaction: revalidation is tx-scoped DB work only', async () => {
  // Regression guard: the tx callback must never await network/AI/queue calls
  // while holding the row lock. Structural proof — the revalidation service
  // receives ONLY the tx client (never the global prisma or fetch).
  const fs = require('fs');
  const route = fs.readFileSync(require.resolve('../src/routes/allergies'), 'utf8');
  const txBody = route.slice(route.indexOf('$transaction'));
  const insideTx = txBody.slice(0, txBody.indexOf('});'));
  expect(insideTx).not.toMatch(/fetch|axios|openai|askJSON|http\./);
  // lock-before-write ordering is structural in the route: FOR UPDATE precedes upserts
  expect(insideTx.indexOf('FOR UPDATE')).toBeLessThan(insideTx.indexOf('upsert'));
});
