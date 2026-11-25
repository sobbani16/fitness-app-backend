// SEC-P05 real-DB concurrency validation — pc-HUM-75.
// tests/trainerCommerce.test.js is fully mock-based ($transaction just invokes
// the callback with the mock), so the atomic-claim, unique-constraint, and
// Serializable-retry paths were never exercised against a real database.
// This suite runs createPurchase / handleWebhookEvent / refundPurchase against
// the REAL prisma layer on the disposable fitness_test DB with n5x75-scoped
// fixtures and proves no double-grant / double-charge is possible. P17 price-
// integrity probes (quantity/coupon/referral fields, spoofed webhook amounts)
// are covered here as well. All fixtures removed in afterAll.
const { getPrisma } = require('../src/lib/prisma');
const commerce = require('../src/services/trainerCommerceService');
const { getProvider } = require('../src/services/payments/provider');
const flags = require('../src/services/featureFlags/service');
const { envOverrideName } = require('../src/config/featureRegistry');

const prisma = getPrisma();
const provider = getProvider('mock');
const P = 'n5x75';
const CLIENT = `${P}-client`;
const TRAINER_USER = `${P}-trainer-user`;

let pkg; // session_pack, 5000¢, 5 sessions
let pkgSub; // subscription, 9900¢ — used for the refund race

beforeAll(async () => {
  process.env[envOverrideName('trainer_advanced_features_enabled')] = 'true';
  process.env[envOverrideName('trainer_paid_coaching_enabled')] = 'true';
  flags.resetCache();
  await prisma.user.create({ data: { id: CLIENT, email: `${P}-client@syn.local` } });
  await prisma.user.create({ data: { id: TRAINER_USER, email: `${P}-trainer@syn.local` } });
  const trainer = await prisma.trainerProfile.create({
    data: { userId: TRAINER_USER, verified: true, active: true, applicationStatus: 'approved', specialties: [], certifications: [] },
  });
  await prisma.trainerClient.create({ data: { trainerId: trainer.id, clientId: CLIENT, status: 'active' } });
  pkg = await prisma.trainerCoachingPackage.create({
    data: { trainerId: trainer.id, title: `${P} 5-pack`, kind: 'session_pack', sessionCount: 5, priceCents: 5000 },
  });
  pkgSub = await prisma.trainerCoachingPackage.create({
    data: { trainerId: trainer.id, title: `${P} monthly`, kind: 'subscription', interval: 'month', priceCents: 9900 },
  });
});

afterAll(async () => {
  const purchases = await prisma.trainerPurchase.findMany({ where: { clientId: CLIENT }, select: { id: true } });
  const pids = purchases.map((p) => p.id);
  await prisma.trainerPaymentTransaction.deleteMany({ where: { purchaseId: { in: pids } } });
  await prisma.trainerEntitlement.deleteMany({ where: { clientId: CLIENT } });
  await prisma.trainerSubscription.deleteMany({ where: { purchaseId: { in: pids } } });
  await prisma.trainerRefund.deleteMany({ where: { purchaseId: { in: pids } } });
  await prisma.trainerPurchase.deleteMany({ where: { clientId: CLIENT } });
  await prisma.trainerCoachingPackage.deleteMany({ where: { title: { startsWith: P } } });
  const trainer = await prisma.trainerProfile.findUnique({ where: { userId: TRAINER_USER } });
  if (trainer) {
    await prisma.trainerClient.deleteMany({ where: { trainerId: trainer.id } });
    await prisma.trainerProfile.delete({ where: { id: trainer.id } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [CLIENT, TRAINER_USER] } } });
  await prisma.$disconnect();
});

const send = (delivery) => commerce.handleWebhookEvent('mock', delivery.headers, delivery.rawBody);

describe('SEC-P05 real-DB concurrency', () => {
  test('concurrent checkouts with the same idempotencyKey produce exactly one purchase', async () => {
    const key = `${P}-race-co`;
    const results = await Promise.allSettled([
      commerce.createPurchase(CLIENT, { packageId: pkg.id, idempotencyKey: key }),
      commerce.createPurchase(CLIENT, { packageId: pkg.id, idempotencyKey: key }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const purchases = await prisma.trainerPurchase.findMany({ where: { clientId: CLIENT, packageId: pkg.id } });
    expect(purchases).toHaveLength(1);
    // Every resolved call returns the same winning purchase.
    for (const r of ok) expect(r.purchase.id).toBe(purchases[0].id);
    const checkoutTxns = await prisma.trainerPaymentTransaction.count({ where: { purchaseId: purchases[0].id, type: 'checkout' } });
    expect(checkoutTxns).toBe(1);
  });

  test('two payment.succeeded webhooks with distinct providerEventIds cannot double-grant', async () => {
    const purchase = await prisma.trainerPurchase.findFirst({ where: { clientId: CLIENT, packageId: pkg.id } });
    const [a, b] = [
      provider.issueEvent('payment.succeeded', { id: `${P}-evt-a`, providerRef: purchase.providerRef, amountCents: 5000, currency: 'usd' }),
      provider.issueEvent('payment.succeeded', { id: `${P}-evt-b`, providerRef: purchase.providerRef, amountCents: 5000, currency: 'usd' }),
    ];
    expect(a.event.id).not.toBe(b.event.id); // distinct events, like a provider retry + redelivery
    const results = await Promise.allSettled([send(a), send(b)]);
    const failures = results.filter((r) => r.status === 'rejected');
    expect(failures).toHaveLength(0); // Serializable retry must absorb the contention
    const entitlements = await prisma.trainerEntitlement.findMany({ where: { purchaseId: purchase.id } });
    expect(entitlements).toHaveLength(1);
    expect(entitlements[0].remainingSessions).toBe(5);
    const final = await prisma.trainerPurchase.findUnique({ where: { id: purchase.id } });
    expect(final.status).toBe('paid');
    const successTxns = await prisma.trainerPaymentTransaction.count({ where: { purchaseId: purchase.id, type: 'payment.succeeded' } });
    expect(successTxns).toBe(2); // both deliveries recorded for audit — the claim guarded the grant
  });

  test('replayed webhook with the same providerEventId returns duplicate and grants nothing extra', async () => {
    const purchase = await prisma.trainerPurchase.findFirst({ where: { clientId: CLIENT, packageId: pkg.id } });
    const replay = provider.issueEvent('payment.succeeded', { providerRef: purchase.providerRef, amountCents: 5000, currency: 'usd' });
    const first = await send(replay);
    const second = await send(replay);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    const entitlements = await prisma.trainerEntitlement.count({ where: { purchaseId: purchase.id } });
    expect(entitlements).toBe(1);
  });

  test('concurrent refunds: only one claim wins, exactly one refund row', async () => {
    const { purchase } = await commerce.createPurchase(CLIENT, { packageId: pkgSub.id, idempotencyKey: `${P}-race-rf` });
    await send(provider.issueEvent('payment.succeeded', { providerRef: purchase.providerRef, amountCents: 9900, currency: 'usd' }));
    const results = await Promise.allSettled([
      commerce.refundPurchase(TRAINER_USER, purchase.id, {}),
      commerce.refundPurchase(TRAINER_USER, purchase.id, {}),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.status).toBe(409);
    const refunds = await prisma.trainerRefund.findMany({ where: { purchaseId: purchase.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amountCents).toBe(9900);
    const active = await prisma.trainerEntitlement.count({ where: { purchaseId: purchase.id, status: 'active' } });
    expect(active).toBe(0);
    const final = await prisma.trainerPurchase.findUnique({ where: { id: purchase.id } });
    expect(final.status).toBe('refunded');
  });
});

describe('P17 quantity / coupon / referral / amount integrity', () => {
  test('quantity, couponCode, and referralCode fields are ignored — price comes from the package only', async () => {
    const { purchase } = await commerce.createPurchase(CLIENT, {
      packageId: pkg.id,
      idempotencyKey: `${P}-p17`,
      quantity: 99,
      couponCode: 'FREE100',
      referralCode: 'FRIEND',
    });
    const stored = await prisma.trainerPurchase.findUnique({ where: { id: purchase.id } });
    expect(stored.amountCents).toBe(5000); // package price — 99× multiplier and coupon had no effect
    expect(stored.currency).toBe('usd');
    expect(stored).not.toHaveProperty('quantity');
    expect(stored).not.toHaveProperty('couponCode');
    expect(stored).not.toHaveProperty('referralCode');
  });

  test('signed webhook with a spoofed lower amount fails loudly and grants nothing', async () => {
    const { purchase } = await commerce.createPurchase(CLIENT, { packageId: pkgSub.id, idempotencyKey: `${P}-p17-amt` });
    const forged = provider.issueEvent('payment.succeeded', { providerRef: purchase.providerRef, amountCents: 1, currency: 'usd' });
    await expect(send(forged)).rejects.toMatchObject({ status: 400 });
    const final = await prisma.trainerPurchase.findUnique({ where: { id: purchase.id } });
    expect(final.status).toBe('pending');
    expect(await prisma.trainerEntitlement.count({ where: { purchaseId: purchase.id } })).toBe(0);
  });
});
