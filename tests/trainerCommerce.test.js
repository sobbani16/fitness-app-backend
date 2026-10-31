// Trainer paid-coaching commerce — packages, checkout, signed webhooks,
// entitlement activation, idempotent replay, refunds, flag gating.
const request = require('supertest');
const { getProvider } = require('../src/services/payments/provider');
const flags = require('../src/services/featureFlags/service');
const { envOverrideName } = require('../src/config/featureRegistry');

const mockPrisma = {
  user: { findUnique: jest.fn(), create: jest.fn() },
  userRole: { findMany: jest.fn() },
  trainerProfile: { findUnique: jest.fn() },
  trainerClient: { findUnique: jest.fn() },
  trainerCoachingPackage: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  trainerPurchase: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  trainerPaymentTransaction: { create: jest.fn() },
  trainerEntitlement: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  trainerSubscription: { create: jest.fn(), updateMany: jest.fn() },
  trainerRefund: { create: jest.fn() },
  trainerPayout: { findMany: jest.fn() },
  auditLog: { create: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

// trainer_paid_coaching_enabled dependsOn trainer_advanced_features_enabled,
// which is class 'control' — tests/setup.js only enables non-control flags.
process.env[envOverrideName('trainer_advanced_features_enabled')] = 'true';
const setFlag = (key, value) => { process.env[envOverrideName(key)] = value; flags.resetCache(); };

const app = require('../src/app');
const provider = getProvider('mock');

const TRAINER = { id: 'tp-1', userId: 'trainer-1', verified: true, active: true, applicationStatus: 'approved' };
const SESSION_PACK = {
  id: 'pkg-1', trainerId: 'tp-1', title: '5-Session Pack', kind: 'session_pack',
  sessionCount: 5, interval: null, priceCents: 5000, currency: 'usd', active: true,
  trainer: { userId: 'trainer-1' },
};
const SUBSCRIPTION_PKG = {
  id: 'pkg-2', trainerId: 'tp-1', title: 'Monthly Coaching', kind: 'subscription',
  sessionCount: null, interval: 'month', priceCents: 9900, currency: 'usd', active: true,
  trainer: { userId: 'trainer-1' },
};

function mockRoles(userId, roleNames) {
  mockPrisma.userRole.findMany.mockImplementation(async ({ where }) =>
    where.userId === userId ? roleNames.map((name) => ({ userId, active: true, role: { name } })) : []);
}

function postWebhook(event, signature) {
  let req = request(app).post('/webhooks/payments/mock').send(event);
  if (signature !== undefined) req = req.set('x-mock-signature', signature);
  return req;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction = jest.fn(async (cb) => cb(mockPrisma));
  mockPrisma.user.findUnique.mockResolvedValue({ id: 'seeded' });
  mockPrisma.userRole.findMany.mockResolvedValue([]);
  // Active coaching relation for client-1 ↔ tp-1 (checkout requires it).
  mockPrisma.trainerClient.findUnique.mockImplementation(async ({ where }) => {
    const k = where && where.trainerId_clientId;
    return k && k.trainerId === 'tp-1' && k.clientId === 'client-1'
      ? { id: 'rel-1', trainerId: 'tp-1', clientId: 'client-1', status: 'active' }
      : null;
  });
  mockPrisma.auditLog.create.mockResolvedValue({});
  flags.resetCache();
});

afterEach(() => setFlag('trainer_paid_coaching_enabled', 'true'));

// ---------------------------------------------------------------------------
describe('package CRUD authorization', () => {
  it('401 without x-user-id', async () => {
    const res = await request(app).post('/trainer/commerce/packages').send({ title: 'x', kind: 'one_time', priceCents: 100 });
    expect(res.status).toBe(401);
  });

  it('403 for MEMBER role', async () => {
    mockRoles('member-1', ['MEMBER']);
    const res = await request(app).post('/trainer/commerce/packages').set('x-user-id', 'member-1')
      .send({ title: 'x', kind: 'one_time', priceCents: 100 });
    expect(res.status).toBe(403);
  });

  it('403 for TRAINER without approved profile', async () => {
    mockRoles('trainer-1', ['TRAINER']);
    mockPrisma.trainerProfile.findUnique.mockResolvedValue({ id: 'tp-1', userId: 'trainer-1', verified: false, active: true, applicationStatus: 'submitted' });
    const res = await request(app).post('/trainer/commerce/packages').set('x-user-id', 'trainer-1')
      .send({ title: 'x', kind: 'one_time', priceCents: 100 });
    expect(res.status).toBe(403);
  });

  it('201 creates a package for an approved trainer', async () => {
    mockRoles('trainer-1', ['TRAINER']);
    mockPrisma.trainerProfile.findUnique.mockResolvedValue(TRAINER);
    mockPrisma.trainerCoachingPackage.create.mockImplementation(async ({ data }) => ({ id: 'pkg-new', ...data }));
    const res = await request(app).post('/trainer/commerce/packages').set('x-user-id', 'trainer-1')
      .send({ title: '5-Session Pack', kind: 'session_pack', sessionCount: 5, priceCents: 5000 });
    expect(res.status).toBe(201);
    expect(res.body.trainerId).toBe('tp-1');
    expect(res.body.currency).toBe('usd');
  });

  it('400 on invalid kind', async () => {
    mockRoles('trainer-1', ['TRAINER']);
    mockPrisma.trainerProfile.findUnique.mockResolvedValue(TRAINER);
    const res = await request(app).post('/trainer/commerce/packages').set('x-user-id', 'trainer-1')
      .send({ title: 'x', kind: 'forever', priceCents: 100 });
    expect(res.status).toBe(400);
  });

  it('GET /packages lists trainer packages', async () => {
    mockRoles('trainer-1', ['TRAINER']);
    mockPrisma.trainerProfile.findUnique.mockResolvedValue(TRAINER);
    mockPrisma.trainerCoachingPackage.findMany.mockResolvedValue([SESSION_PACK]);
    const res = await request(app).get('/trainer/commerce/packages').set('x-user-id', 'trainer-1');
    expect(res.status).toBe(200);
    expect(res.body.packages).toHaveLength(1);
  });

  it('PATCH rejects packages owned by another trainer', async () => {
    mockRoles('trainer-1', ['TRAINER']);
    mockPrisma.trainerProfile.findUnique.mockResolvedValue(TRAINER);
    mockPrisma.trainerCoachingPackage.findUnique.mockResolvedValue({ ...SESSION_PACK, trainerId: 'tp-other' });
    const res = await request(app).patch('/trainer/commerce/packages/pkg-1').set('x-user-id', 'trainer-1')
      .send({ priceCents: 6000 });
    expect(res.status).toBe(404);
  });

  it('DELETE deactivates a package', async () => {
    mockRoles('trainer-1', ['TRAINER']);
    mockPrisma.trainerProfile.findUnique.mockResolvedValue(TRAINER);
    mockPrisma.trainerCoachingPackage.findUnique.mockResolvedValue(SESSION_PACK);
    mockPrisma.trainerCoachingPackage.update.mockImplementation(async ({ data }) => ({ ...SESSION_PACK, ...data }));
    const res = await request(app).delete('/trainer/commerce/packages/pkg-1').set('x-user-id', 'trainer-1');
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });

  it('GET /payouts returns the (empty) payout list', async () => {
    mockRoles('trainer-1', ['TRAINER']);
    mockPrisma.trainerProfile.findUnique.mockResolvedValue(TRAINER);
    mockPrisma.trainerPayout.findMany.mockResolvedValue([]);
    const res = await request(app).get('/trainer/commerce/payouts').set('x-user-id', 'trainer-1');
    expect(res.status).toBe(200);
    expect(res.body.payouts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('checkout -> webhook -> entitlement', () => {
  function mockCheckoutFlow(pkg, purchaseId = 'pur-1') {
    const purchase = {
      id: purchaseId, clientId: 'client-1', packageId: pkg.id, providerRef: 'mock_co_key-1',
      status: 'pending', amountCents: pkg.priceCents, currency: 'usd', package: pkg,
    };
    let existingCheckDone = false;
    mockPrisma.trainerCoachingPackage.findUnique.mockResolvedValue(pkg);
    mockPrisma.trainerPurchase.findUnique.mockImplementation(async ({ where, include }) => {
      // createPurchase's idempotency probe is the only lookup without include.
      if (where.providerRef === 'mock_co_key-1' && !include) {
        if (!existingCheckDone) { existingCheckDone = true; return null; }
        return purchase;
      }
      if (where.providerRef === 'mock_co_key-1' || where.id === purchaseId) return purchase;
      return null;
    });
    mockPrisma.trainerPurchase.create.mockImplementation(async ({ data }) => ({ id: purchaseId, ...data }));
    mockPrisma.trainerPurchase.update.mockImplementation(async ({ data }) => ({ id: purchaseId, ...data }));
    mockPrisma.trainerPaymentTransaction.create.mockResolvedValue({});
    mockPrisma.trainerEntitlement.create.mockImplementation(async ({ data }) => ({ id: 'ent-1', ...data }));
    mockPrisma.trainerSubscription.create.mockImplementation(async ({ data }) => ({ id: 'sub-1', ...data }));
  }

  it('checkout creates a pending purchase; webhook activates the entitlement', async () => {
    mockRoles('client-1', ['MEMBER']);
    mockCheckoutFlow(SESSION_PACK);

    const checkout = await request(app).post('/me/purchases/checkout').set('x-user-id', 'client-1')
      .send({ packageId: 'pkg-1', idempotencyKey: 'key-1' });
    expect(checkout.status).toBe(201);
    expect(checkout.body.purchase.status).toBe('pending');
    expect(checkout.body.checkout.providerRef).toBe('mock_co_key-1');

    const { event, rawBody, headers } = provider.issueEvent('payment.succeeded', {
      id: 'evt-1', purchaseId: 'pur-1', providerRef: 'mock_co_key-1', amountCents: 5000, currency: 'usd',
    });
    const res = await postWebhook(event, headers['x-mock-signature']);
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(true);
    expect(mockPrisma.trainerPurchase.update).toHaveBeenCalledWith({ where: { id: 'pur-1' }, data: { status: 'paid' } });
    expect(mockPrisma.trainerEntitlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'session_pack', remainingSessions: 5, clientId: 'client-1', trainerId: 'tp-1', status: 'active' }),
    });
  });

  it('webhook replay with the same providerEventId is a no-op 200', async () => {
    mockRoles('client-1', ['MEMBER']);
    mockCheckoutFlow(SESSION_PACK);
    const { event, headers } = provider.issueEvent('payment.succeeded', {
      id: 'evt-dup', purchaseId: 'pur-1', providerRef: 'mock_co_key-1', amountCents: 5000,
    });
    expect((await postWebhook(event, headers['x-mock-signature'])).status).toBe(200);
    // Replay: providerEventId unique constraint hits -> duplicate ack.
    mockPrisma.trainerPaymentTransaction.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    const replay = await postWebhook(event, headers['x-mock-signature']);
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(mockPrisma.trainerEntitlement.create).toHaveBeenCalledTimes(1);
  });

  it('subscription package creates subscription + subscription entitlement', async () => {
    mockRoles('client-1', ['MEMBER']);
    mockCheckoutFlow(SUBSCRIPTION_PKG, 'pur-2');
    const { event, headers } = provider.issueEvent('payment.succeeded', {
      id: 'evt-sub', purchaseId: 'pur-2', providerRef: 'mock_co_key-1', amountCents: 9900,
    });
    const res = await postWebhook(event, headers['x-mock-signature']);
    expect(res.status).toBe(200);
    expect(mockPrisma.trainerSubscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ purchaseId: 'pur-2', status: 'active' }),
    });
    expect(mockPrisma.trainerEntitlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'subscription', status: 'active' }),
    });
  });

  it('one_time package grants a single session entitlement', async () => {
    mockRoles('client-1', ['MEMBER']);
    const oneTime = { ...SESSION_PACK, id: 'pkg-3', kind: 'one_time', sessionCount: null };
    mockCheckoutFlow(oneTime, 'pur-3');
    const { event, headers } = provider.issueEvent('payment.succeeded', {
      id: 'evt-one', purchaseId: 'pur-3', providerRef: 'mock_co_key-1', amountCents: 5000,
    });
    await postWebhook(event, headers['x-mock-signature']);
    expect(mockPrisma.trainerEntitlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'session', remainingSessions: 1 }),
    });
  });

  it('idempotent checkout replay returns the existing purchase', async () => {
    mockRoles('client-1', ['MEMBER']);
    mockPrisma.trainerCoachingPackage.findUnique.mockResolvedValue(SESSION_PACK);
    mockPrisma.trainerPurchase.findUnique.mockResolvedValue({
      id: 'pur-1', clientId: 'client-1', packageId: 'pkg-1', providerRef: 'mock_co_key-1', status: 'paid',
    });
    const res = await request(app).post('/me/purchases/checkout').set('x-user-id', 'client-1')
      .send({ packageId: 'pkg-1', idempotencyKey: 'key-1' });
    expect(res.status).toBe(200);
    expect(res.body.checkout.reused).toBe(true);
    expect(mockPrisma.trainerPurchase.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('webhook verification', () => {
  it('rejects a bad signature with 400', async () => {
    const res = await postWebhook({ id: 'evt-x', type: 'payment.succeeded', providerRef: 'mock_co_key-1' }, 'sha256=bad');
    expect(res.status).toBe(400);
  });

  it('rejects a missing signature with 400', async () => {
    const res = await postWebhook({ id: 'evt-x', type: 'payment.succeeded' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown provider with 400', async () => {
    const res = await request(app).post('/webhooks/payments/stripe').send({ id: 'e', type: 'x' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('refund', () => {
  it('trainer refund marks purchase refunded and revokes entitlements', async () => {
    mockRoles('trainer-1', ['TRAINER']);
    mockPrisma.trainerProfile.findUnique.mockResolvedValue(TRAINER);
    mockPrisma.trainerPurchase.findUnique.mockResolvedValue({
      id: 'pur-1', clientId: 'client-1', packageId: 'pkg-1', provider: 'mock',
      providerRef: 'mock_co_key-1', status: 'paid', amountCents: 5000, currency: 'usd',
      package: { trainerId: 'tp-1' },
    });
    mockPrisma.trainerPurchase.update.mockResolvedValue({});
    mockPrisma.trainerPaymentTransaction.create.mockResolvedValue({});
    mockPrisma.trainerRefund.create.mockImplementation(async ({ data }) => ({ id: 'rf-1', ...data }));
    mockPrisma.trainerEntitlement.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.trainerSubscription.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app).post('/trainer/commerce/purchases/pur-1/refund').set('x-user-id', 'trainer-1').send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('refunded');
    expect(mockPrisma.trainerPurchase.update).toHaveBeenCalledWith({ where: { id: 'pur-1' }, data: { status: 'refunded' } });
    expect(mockPrisma.trainerEntitlement.updateMany).toHaveBeenCalledWith({
      where: { purchaseId: 'pur-1', status: 'active' },
      data: { status: 'revoked' },
    });
  });
});

// ---------------------------------------------------------------------------
describe('feature flag off', () => {
  it('403 FEATURE_DISABLED when trainer_paid_coaching_enabled is off', async () => {
    setFlag('trainer_paid_coaching_enabled', 'false');
    for (const req of [
      request(app).get('/me/purchases').set('x-user-id', 'client-1'),
      request(app).post('/trainer/commerce/packages').set('x-user-id', 'trainer-1').send({}),
    ]) {
      const res = await req;
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FEATURE_DISABLED');
    }
  });
});
