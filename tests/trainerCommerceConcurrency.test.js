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

describe('SEC-P05 extended — cross-user, out-of-order, cumulative, recovery', () => {
  test('cross-user idempotency key reuse is rejected with 409 and leaks nothing', async () => {
    // second user reusing the SAME key must not receive or disturb the first purchase
    const other = `${P}-other`;
    await prisma.user.create({ data: { id: other, email: `${P}-other@syn.local` } });
    const trainer = await prisma.trainerProfile.findUnique({ where: { userId: TRAINER_USER } });
    await prisma.trainerClient.create({ data: { trainerId: trainer.id, clientId: other, status: 'active' } });
    const key = `${P}-xuser-key`;
    const first = await commerce.createPurchase(CLIENT, { packageId: pkg.id, idempotencyKey: key });
    await expect(commerce.createPurchase(other, { packageId: pkg.id, idempotencyKey: key })).rejects.toMatchObject({ status: 409 });
    const purchases = await prisma.trainerPurchase.findMany({ where: { packageId: pkg.id, clientId: other } });
    expect(purchases).toHaveLength(0);
    // owner replay still works
    const replay = await commerce.createPurchase(CLIENT, { packageId: pkg.id, idempotencyKey: key });
    expect(replay.purchase.id).toBe(first.purchase.id);
    await prisma.trainerClient.deleteMany({ where: { clientId: other } });
    await prisma.user.delete({ where: { id: other } });
  });

  test('concurrent delivery of the SAME webhook event: exactly one processed, one duplicate, one entitlement', async () => {
    const { purchase } = await commerce.createPurchase(CLIENT, { packageId: pkg.id, idempotencyKey: `${P}-same-evt` });
    const evt = provider.issueEvent('payment.succeeded', { providerRef: purchase.providerRef, amountCents: 5000, currency: 'usd' });
    const results = await Promise.allSettled([send(evt), send(evt)]);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0);
    const processed = results.filter((r) => r.status === 'fulfilled' && r.value.duplicate === false);
    const dups = results.filter((r) => r.status === 'fulfilled' && r.value.duplicate === true);
    expect(processed).toHaveLength(1);
    expect(dups).toHaveLength(1);
    expect(await prisma.trainerEntitlement.count({ where: { purchaseId: purchase.id } })).toBe(1);
  });

  test('currency mismatch fails loudly and grants nothing', async () => {
    const { purchase } = await commerce.createPurchase(CLIENT, { packageId: pkg.id, idempotencyKey: `${P}-cur` });
    const forged = provider.issueEvent('payment.succeeded', { providerRef: purchase.providerRef, amountCents: 5000, currency: 'eur' });
    await expect(send(forged)).rejects.toMatchObject({ status: 400 });
    expect((await prisma.trainerPurchase.findUnique({ where: { id: purchase.id } })).status).toBe('pending');
    expect(await prisma.trainerEntitlement.count({ where: { purchaseId: purchase.id } })).toBe(0);
  });

  test('out-of-order: refund webhook before payment.succeeded must not end with an active entitlement', async () => {
    const { purchase } = await commerce.createPurchase(CLIENT, { packageId: pkgSub.id, idempotencyKey: `${P}-ooo` });
    // refund arrives FIRST (provider ordering is not guaranteed)
    await send(provider.issueEvent('payment.refunded', { providerRef: purchase.providerRef, amountCents: 9900, currency: 'usd' }));
    // the success event arrives after
    await send(provider.issueEvent('payment.succeeded', { providerRef: purchase.providerRef, amountCents: 9900, currency: 'usd' }));
    const final = await prisma.trainerPurchase.findUnique({ where: { id: purchase.id } });
    const activeEnt = await prisma.trainerEntitlement.count({ where: { purchaseId: purchase.id, status: 'active' } });
    // money was refunded — the client must not hold usable value
    expect(activeEnt).toBe(0);
    expect(final.status).not.toBe('paid');
  });

  test('two distinct full-refund webhooks cannot create duplicate refund rows (totals <= captured)', async () => {
    const { purchase } = await commerce.createPurchase(CLIENT, { packageId: pkgSub.id, idempotencyKey: `${P}-duprf` });
    await send(provider.issueEvent('payment.succeeded', { providerRef: purchase.providerRef, amountCents: 9900, currency: 'usd' }));
    const [a, b] = [
      provider.issueEvent('payment.refunded', { id: `${P}-rf-a`, providerRef: purchase.providerRef, amountCents: 9900, currency: 'usd' }),
      provider.issueEvent('payment.refunded', { id: `${P}-rf-b`, providerRef: purchase.providerRef, amountCents: 9900, currency: 'usd' }),
    ];
    await send(a);
    await expect(send(b)).rejects.toMatchObject({ status: 400 }); // fails loudly — never silent double-refund
    const refunds = await prisma.trainerRefund.findMany({ where: { purchaseId: purchase.id } });
    const total = refunds.reduce((t, r) => t + r.amountCents, 0);
    expect(total).toBeLessThanOrEqual(9900); // never refund more than captured
    expect(refunds.length).toBe(1);
  });

  test('partial refund webhooks accumulate within captured total; overflow is rejected', async () => {
    const { purchase } = await commerce.createPurchase(CLIENT, { packageId: pkgSub.id, idempotencyKey: `${P}-partrf` });
    await send(provider.issueEvent('payment.succeeded', { providerRef: purchase.providerRef, amountCents: 9900, currency: 'usd' }));
    await send(provider.issueEvent('payment.refunded', { id: `${P}-p1`, providerRef: purchase.providerRef, amountCents: 4000, currency: 'usd' }));
    await send(provider.issueEvent('payment.refunded', { id: `${P}-p2`, providerRef: purchase.providerRef, amountCents: 4000, currency: 'usd' }));
    // this one would push cumulative refunds (4000+4000+4000=12000) beyond captured 9900
    const overflow = provider.issueEvent('payment.refunded', { id: `${P}-p3`, providerRef: purchase.providerRef, amountCents: 4000, currency: 'usd' });
    await expect(send(overflow)).rejects.toMatchObject({ status: 400 });
    const refunds = await prisma.trainerRefund.findMany({ where: { purchaseId: purchase.id } });
    expect(refunds.reduce((t, r) => t + r.amountCents, 0)).toBeLessThanOrEqual(9900);
  });

  test('crash-between-provider-and-DB reconciliation: refund_pending purchase is finalized by the provider refund webhook', async () => {
    const { purchase } = await commerce.createPurchase(CLIENT, { packageId: pkgSub.id, idempotencyKey: `${P}-crash` });
    await send(provider.issueEvent('payment.succeeded', { providerRef: purchase.providerRef, amountCents: 9900, currency: 'usd' }));
    // simulate the crash window: provider accepted the refund, we died before recording
    await prisma.trainerPurchase.updateMany({ where: { id: purchase.id, status: 'paid' }, data: { status: 'refund_pending' } });
    // reconciliation path: provider's payment.refunded webhook arrives
    await send(provider.issueEvent('payment.refunded', { providerRef: purchase.providerRef, amountCents: 9900, currency: 'usd' }));
    const final = await prisma.trainerPurchase.findUnique({ where: { id: purchase.id } });
    expect(final.status).toBe('refunded');
    expect(await prisma.trainerRefund.count({ where: { purchaseId: purchase.id } })).toBe(1);
    expect(await prisma.trainerEntitlement.count({ where: { purchaseId: purchase.id, status: 'active' } })).toBe(0);
  });

  test('failed provider refund call releases the claim — consistent and refundable state', async () => {
    const { purchase } = await commerce.createPurchase(CLIENT, { packageId: pkgSub.id, idempotencyKey: `${P}-failp` });
    await send(provider.issueEvent('payment.succeeded', { providerRef: purchase.providerRef, amountCents: 9900, currency: 'usd' }));
    // force provider failure
    const prov = getProvider('mock');
    const proto = Object.getPrototypeOf(prov);
    const orig = proto.refund;
    proto.refund = async () => { throw new Error('provider down'); };
    try {
      await expect(commerce.refundPurchase(TRAINER_USER, purchase.id, {})).rejects.toThrow(/provider down/);
    } finally {
      proto.refund = orig;
    }
    const final = await prisma.trainerPurchase.findUnique({ where: { id: purchase.id } });
    expect(final.status).toBe('paid'); // claim released — not stuck in refund_pending
    expect(await prisma.trainerRefund.count({ where: { purchaseId: purchase.id } })).toBe(0);
    expect(await prisma.trainerEntitlement.count({ where: { purchaseId: purchase.id, status: 'active' } })).toBe(1);
    // and a retry succeeds — interrupted retry is safe
    const retry = await commerce.refundPurchase(TRAINER_USER, purchase.id, {});
    expect(retry.status).toBe('refunded');
    expect(await prisma.trainerRefund.count({ where: { purchaseId: purchase.id } })).toBe(1);
  });

  test('ownership: a different trainer cannot refund this purchase (403), no state change', async () => {
    const otherTrainerUser = `${P}-trainer2`;
    await prisma.user.create({ data: { id: otherTrainerUser, email: `${P}-t2@syn.local` } });
    const t2 = await prisma.trainerProfile.create({ data: { userId: otherTrainerUser, verified: true, active: true, applicationStatus: 'approved', specialties: [], certifications: [] } });
    const { purchase } = await commerce.createPurchase(CLIENT, { packageId: pkgSub.id, idempotencyKey: `${P}-own` });
    await send(provider.issueEvent('payment.succeeded', { providerRef: purchase.providerRef, amountCents: 9900, currency: 'usd' }));
    await expect(commerce.refundPurchase(otherTrainerUser, purchase.id, {})).rejects.toMatchObject({ status: 403 });
    expect((await prisma.trainerPurchase.findUnique({ where: { id: purchase.id } })).status).toBe('paid');
    expect(await prisma.trainerRefund.count({ where: { purchaseId: purchase.id } })).toBe(0);
    // unrelated-purchase immunity: refunding ANOTHER purchase never touches this one
    await prisma.trainerProfile.delete({ where: { id: t2.id } });
    await prisma.user.delete({ where: { id: otherTrainerUser } });
  });

  test('unrelated-purchase immunity: events for purchase A never mutate purchase B', async () => {
    const a = await commerce.createPurchase(CLIENT, { packageId: pkgSub.id, idempotencyKey: `${P}-imm-a` });
    const b = await commerce.createPurchase(CLIENT, { packageId: pkgSub.id, idempotencyKey: `${P}-imm-b` });
    await send(provider.issueEvent('payment.succeeded', { providerRef: a.purchase.providerRef, amountCents: 9900, currency: 'usd' }));
    const bAfter = await prisma.trainerPurchase.findUnique({ where: { id: b.purchase.id } });
    expect(bAfter.status).toBe('pending');
    expect(await prisma.trainerEntitlement.count({ where: { purchaseId: b.purchase.id } })).toBe(0);
  });

  test('disabled commerce: valid webhook while paid coaching off grants nothing (fail-closed ack)', async () => {
    const { purchase } = await commerce.createPurchase(CLIENT, { packageId: pkg.id, idempotencyKey: `${P}-disab` });
    process.env[envOverrideName('trainer_paid_coaching_enabled')] = 'false';
    flags.resetCache();
    const res = await send(provider.issueEvent('payment.succeeded', { providerRef: purchase.providerRef, amountCents: 5000, currency: 'usd' }));
    expect(res.ignored).toBe('commerce_disabled');
    expect((await prisma.trainerPurchase.findUnique({ where: { id: purchase.id } })).status).toBe('pending');
    expect(await prisma.trainerEntitlement.count({ where: { purchaseId: purchase.id } })).toBe(0);
    process.env[envOverrideName('trainer_paid_coaching_enabled')] = 'true';
    flags.resetCache();
  });

  test('fractional/overflow server refund amounts are rejected before any provider call', async () => {
    const { purchase } = await commerce.createPurchase(CLIENT, { packageId: pkgSub.id, idempotencyKey: `${P}-frac` });
    await send(provider.issueEvent('payment.succeeded', { providerRef: purchase.providerRef, amountCents: 9900, currency: 'usd' }));
    await expect(commerce.refundPurchase(TRAINER_USER, purchase.id, { amountCents: 99.5 })).rejects.toMatchObject({ status: 400 });
    await expect(commerce.refundPurchase(TRAINER_USER, purchase.id, { amountCents: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(commerce.refundPurchase(TRAINER_USER, purchase.id, { amountCents: -50 })).rejects.toMatchObject({ status: 400 });
    await expect(commerce.refundPurchase(TRAINER_USER, purchase.id, { amountCents: 9901 })).rejects.toMatchObject({ status: 400 });
    expect((await prisma.trainerPurchase.findUnique({ where: { id: purchase.id } })).status).toBe('paid');
    expect(await prisma.trainerRefund.count({ where: { purchaseId: purchase.id } })).toBe(0);
  });
});
