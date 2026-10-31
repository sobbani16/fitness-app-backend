// Trainer paid-coaching commerce — packages, purchases, webhook-driven state
// machine, entitlements, refunds, payout listing.
//
// TRUST MODEL: purchases never transition on client-reported success. Only
// signature-verified webhook events (handleWebhookEvent) and server-initiated
// provider calls (refundPurchase) mutate state.

const { randomUUID } = require('node:crypto');
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { requireApprovedTrainer, requireActiveRelation } = require('./trainerAccess');
const { getProvider } = require('./payments/provider');
const { coachingTransaction } = require('./coachingTransaction');

const PACKAGE_KINDS = ['subscription', 'one_time', 'session_pack'];
const SUBSCRIPTION_INTERVALS = ['month', 'year'];

// ---------------------------------------------------------------------------
// Package validation
// ---------------------------------------------------------------------------

function requireTitle(title) {
  if (typeof title !== 'string' || !title.trim() || title.length > 120) {
    throw httpError(400, 'title is required (120 chars max).');
  }
  return title.trim();
}

function requirePrice(priceCents) {
  if (!Number.isInteger(priceCents) || priceCents < 1 || priceCents > 10_000_000) {
    throw httpError(400, 'priceCents must be an integer between 1 and 10000000.');
  }
  return priceCents;
}

function requireCurrency(currency) {
  const value = currency === undefined ? 'usd' : currency;
  if (typeof value !== 'string' || !/^[a-zA-Z]{3}$/.test(value)) {
    throw httpError(400, 'currency must be a 3-letter code.');
  }
  return value.toLowerCase();
}

function validateNewPackage({ title, kind, priceCents, currency, sessionCount, interval }) {
  if (!PACKAGE_KINDS.includes(kind)) {
    throw httpError(400, `kind must be one of: ${PACKAGE_KINDS.join(', ')}.`);
  }
  const data = {
    title: requireTitle(title),
    kind,
    priceCents: requirePrice(priceCents),
    currency: requireCurrency(currency),
    sessionCount: null,
    interval: null,
  };
  if (kind === 'subscription') {
    const resolved = interval === undefined ? 'month' : interval;
    if (!SUBSCRIPTION_INTERVALS.includes(resolved)) {
      throw httpError(400, 'interval must be month or year for subscriptions.');
    }
    data.interval = resolved;
  }
  if (kind === 'session_pack') {
    if (!Number.isInteger(sessionCount) || sessionCount < 1 || sessionCount > 1000) {
      throw httpError(400, 'sessionCount must be an integer between 1 and 1000 for session packs.');
    }
    data.sessionCount = sessionCount;
  }
  return data;
}

function validatePackagePatch(fields) {
  const data = {};
  if (fields.title !== undefined) data.title = requireTitle(fields.title);
  if (fields.priceCents !== undefined) data.priceCents = requirePrice(fields.priceCents);
  if (fields.currency !== undefined) data.currency = requireCurrency(fields.currency);
  if (fields.active !== undefined) {
    if (typeof fields.active !== 'boolean') throw httpError(400, 'active must be a boolean.');
    data.active = fields.active;
  }
  if (fields.sessionCount !== undefined) {
    if (fields.sessionCount !== null && (!Number.isInteger(fields.sessionCount) || fields.sessionCount < 1 || fields.sessionCount > 1000)) {
      throw httpError(400, 'sessionCount must be an integer between 1 and 1000.');
    }
    data.sessionCount = fields.sessionCount;
  }
  if (fields.interval !== undefined) {
    if (fields.interval !== null && !SUBSCRIPTION_INTERVALS.includes(fields.interval)) {
      throw httpError(400, 'interval must be month or year.');
    }
    data.interval = fields.interval;
  }
  // kind is immutable once purchased history may exist — create a new package instead.
  if (fields.kind !== undefined) throw httpError(400, 'kind cannot be changed; create a new package.');
  return data;
}

// ---------------------------------------------------------------------------
// Packages (trainer-owned, verified trainers only)
// ---------------------------------------------------------------------------

async function createPackage(trainerUserId, fields, prisma = getPrisma()) {
  const trainer = await requireApprovedTrainer(trainerUserId);
  const data = validateNewPackage(fields || {});
  return prisma.trainerCoachingPackage.create({ data: { ...data, trainerId: trainer.id } });
}

async function listPackages(trainerUserId, { activeOnly = false } = {}) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(trainerUserId);
  const where = { trainerId: trainer.id };
  if (activeOnly) where.active = true;
  return prisma.trainerCoachingPackage.findMany({ where });
}

async function getOwnedPackage(trainerUserId, packageId, prisma = getPrisma()) {
  const trainer = await requireApprovedTrainer(trainerUserId);
  const pkg = await prisma.trainerCoachingPackage.findUnique({ where: { id: packageId } });
  if (!pkg || pkg.trainerId !== trainer.id) throw httpError(404, 'Package not found.');
  return { trainer, pkg };
}

async function updatePackage(trainerUserId, packageId, fields, prisma = getPrisma()) {
  const { pkg } = await getOwnedPackage(trainerUserId, packageId, prisma);
  const data = validatePackagePatch(fields || {});
  if (Object.keys(data).length === 0) return pkg;
  return prisma.trainerCoachingPackage.update({ where: { id: pkg.id }, data });
}

/** Packages are deactivated, never deleted — purchase history must survive. */
async function deactivatePackage(trainerUserId, packageId, prisma = getPrisma()) {
  const { pkg } = await getOwnedPackage(trainerUserId, packageId, prisma);
  if (!pkg.active) return pkg;
  return prisma.trainerCoachingPackage.update({ where: { id: pkg.id }, data: { active: false } });
}

// ---------------------------------------------------------------------------
// Checkout — idempotent via client idempotencyKey -> providerRef
// ---------------------------------------------------------------------------

async function createPurchase(clientId, { packageId, idempotencyKey }) {
  const prisma = getPrisma();
  if (typeof packageId !== 'string' || !packageId) throw httpError(400, 'packageId is required.');
  if (typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 120) {
    throw httpError(400, 'idempotencyKey is required (120 chars max).');
  }

  const pkg = await prisma.trainerCoachingPackage.findUnique({
    where: { id: packageId },
    include: { trainer: { select: { userId: true } } },
  });
  if (!pkg || !pkg.active) throw httpError(404, 'Package not found or inactive.');
  if (pkg.trainer.userId === clientId) throw httpError(400, 'Trainers cannot purchase their own packages.');
  // Paid coaching requires an active trainer↔client relationship.
  await requireActiveRelation({ trainerId: pkg.trainerId, clientUserId: clientId });

  const provider = getProvider();
  const providerRef = provider.checkoutRef({ idempotencyKey, purchaseId: `${clientId}:${packageId}` });

  // Idempotent replay: the key already produced a purchase — return it as-is.
  const existing = await prisma.trainerPurchase.findUnique({ where: { providerRef } });
  if (existing) return { purchase: existing, checkout: { providerRef, reused: true } };

  const checkout = await provider.createCheckout({
    purchaseId: randomUUID(), // hints ref generation when no key is present
    amountCents: pkg.priceCents,
    currency: pkg.currency,
    buyerId: clientId,
    metadata: { packageId, idempotencyKey },
  });

  try {
    const purchase = await prisma.$transaction(async (tx) => {
      const created = await tx.trainerPurchase.create({
        data: {
          clientId,
          packageId,
          provider: provider.name,
          providerRef: checkout.providerRef,
          status: 'pending',
          amountCents: pkg.priceCents,
          currency: pkg.currency,
        },
      });
      await tx.trainerPaymentTransaction.create({
        data: {
          purchaseId: created.id,
          provider: provider.name,
          providerEventId: `checkout:${created.id}`,
          type: 'checkout',
          payload: { providerRef: checkout.providerRef, checkoutUrl: checkout.checkoutUrl, idempotencyKey },
        },
      });
      return created;
    });
    return { purchase, checkout };
  } catch (err) {
    if (err.code === 'P2002') {
      // Concurrent checkout with the same key — the first request won.
      const won = await prisma.trainerPurchase.findUnique({ where: { providerRef } });
      if (won) return { purchase: won, checkout: { providerRef, reused: true } };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Webhook handling — the ONLY path that mutates purchase/entitlement state
// ---------------------------------------------------------------------------

function addSubscriptionInterval(interval) {
  const end = new Date();
  if (interval === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}

async function activateEntitlement(tx, purchase) {
  const pkg = purchase.package;
  const base = { purchaseId: purchase.id, clientId: purchase.clientId, trainerId: pkg.trainerId };
  if (pkg.kind === 'subscription') {
    const periodEnd = addSubscriptionInterval(pkg.interval);
    await tx.trainerSubscription.create({
      data: { purchaseId: purchase.id, status: 'active', currentPeriodEnd: periodEnd },
    });
    return tx.trainerEntitlement.create({
      data: { ...base, kind: 'subscription', expiresAt: periodEnd, status: 'active' },
    });
  }
  if (pkg.kind === 'session_pack') {
    return tx.trainerEntitlement.create({
      data: { ...base, kind: 'session_pack', remainingSessions: pkg.sessionCount || 0, status: 'active' },
    });
  }
  // one_time: a single bookable session
  return tx.trainerEntitlement.create({
    data: { ...base, kind: 'session', remainingSessions: 1, status: 'active' },
  });
}

async function markRefunded(tx, purchase, amountCents, reason) {
  if (purchase.status !== 'refunded') {
    await tx.trainerPurchase.update({ where: { id: purchase.id }, data: { status: 'refunded' } });
  }
  await tx.trainerRefund.create({
    data: { purchaseId: purchase.id, amountCents, reason: reason || 'provider_refund', status: 'processed' },
  });
  await tx.trainerEntitlement.updateMany({
    where: { purchaseId: purchase.id, status: 'active' },
    data: { status: 'revoked' },
  });
  await tx.trainerSubscription.updateMany({
    where: { purchaseId: purchase.id, status: 'active' },
    data: { status: 'canceled' },
  });
}

async function applyEvent(tx, purchase, event) {
  switch (event.type) {
    case 'payment.succeeded':
      // Replay-safe: only first success activates.
      if (purchase.status !== 'paid') {
        await tx.trainerPurchase.update({ where: { id: purchase.id }, data: { status: 'paid' } });
        await activateEntitlement(tx, purchase);
      }
      break;
    case 'payment.failed':
      if (purchase.status === 'pending') {
        await tx.trainerPurchase.update({ where: { id: purchase.id }, data: { status: 'failed' } });
      }
      break;
    case 'checkout.canceled':
    case 'checkout.expired':
      if (purchase.status === 'pending') {
        await tx.trainerPurchase.update({ where: { id: purchase.id }, data: { status: 'canceled' } });
      }
      break;
    case 'payment.refunded':
      await markRefunded(tx, purchase, event.amountCents ?? purchase.amountCents, event.reason);
      break;
    default:
      // Unknown event types are recorded (transaction row above) but ignored.
      break;
  }
}

/**
 * Verify + record + apply a provider webhook event.
 * Throws 400 on bad signature. Replay of an already-seen providerEventId
 * returns { duplicate: true } — the provider keeps retrying until it sees 200.
 */
async function handleWebhookEvent(providerName, headers, rawBody) {
  const provider = getProvider(providerName);
  const event = provider.verifyWebhook(headers, rawBody);
  if (!event) throw httpError(400, 'Invalid webhook signature.');

  const prisma = getPrisma();
  const providerEventId = `${provider.name}:${event.id}`;
  const include = { package: true };
  const purchase = event.providerRef
    ? await prisma.trainerPurchase.findUnique({ where: { providerRef: event.providerRef }, include })
    : event.purchaseId
      ? await prisma.trainerPurchase.findUnique({ where: { id: event.purchaseId }, include })
      : null;
  // Unknown purchase: ack so the provider stops retrying; nothing to apply.
  if (!purchase) return { received: true, ignored: 'unknown_purchase' };

  return coachingTransaction(async (tx) => {
    try {
      await tx.trainerPaymentTransaction.create({
        data: { purchaseId: purchase.id, provider: provider.name, providerEventId, type: event.type, payload: event },
      });
    } catch (err) {
      if (err.code === 'P2002') return { duplicate: true };
      throw err;
    }
    await applyEvent(tx, purchase, event);
    return { duplicate: false, processed: true, type: event.type };
  });
}

// ---------------------------------------------------------------------------
// Refund — server-initiated, provider-confirmed, then recorded atomically
// ---------------------------------------------------------------------------

async function refundPurchase(trainerUserId, purchaseId, { amountCents, reason } = {}) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(trainerUserId);
  const purchase = await prisma.trainerPurchase.findUnique({
    where: { id: purchaseId },
    include: { package: true },
  });
  if (!purchase) throw httpError(404, 'Purchase not found.');
  if (purchase.package.trainerId !== trainer.id) throw httpError(403, 'Not your purchase.');
  if (purchase.status !== 'paid') throw httpError(400, `Cannot refund a purchase in status '${purchase.status}'.`);

  const amount = amountCents === undefined ? purchase.amountCents : amountCents;
  if (!Number.isInteger(amount) || amount < 1 || amount > purchase.amountCents) {
    throw httpError(400, 'amountCents must be a positive integer up to the purchase amount.');
  }

  // External effect — provider confirms BEFORE we record anything. Never inside a tx.
  const provider = getProvider(purchase.provider);
  const result = await provider.refund(purchase.providerRef, amount);

  return coachingTransaction(async (tx) => {
    await tx.trainerPaymentTransaction.create({
      data: { purchaseId, provider: provider.name, providerEventId: `refund:${result.refundRef}`, type: 'refund', payload: result },
    });
    await tx.trainerPurchase.update({ where: { id: purchaseId }, data: { status: 'refunded' } });
    await tx.trainerRefund.create({
      data: { purchaseId, amountCents: amount, reason: reason || null, status: 'processed' },
    });
    await tx.trainerEntitlement.updateMany({
      where: { purchaseId, status: 'active' },
      data: { status: 'revoked' },
    });
    await tx.trainerSubscription.updateMany({
      where: { purchaseId, status: 'active' },
      data: { status: 'canceled' },
    });
    return { refundRef: result.refundRef, purchaseId, amountCents: amount, currency: purchase.currency, status: 'refunded' };
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function listPurchases(clientId) {
  const prisma = getPrisma();
  return prisma.trainerPurchase.findMany({
    where: { clientId },
    include: { package: { select: { title: true, kind: true, trainerId: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

async function listTrainerPurchases(trainerUserId) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(trainerUserId);
  return prisma.trainerPurchase.findMany({
    where: { package: { trainerId: trainer.id } },
    include: { package: { select: { title: true, kind: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

async function listEntitlements(clientId) {
  const prisma = getPrisma();
  return prisma.trainerEntitlement.findMany({
    where: { clientId },
    include: { purchase: { select: { packageId: true, amountCents: true, currency: true } } },
  });
}

/** Payout execution is not built yet — this lists recorded payouts (usually []). */
async function listPayouts(trainerUserId) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(trainerUserId);
  return prisma.trainerPayout.findMany({
    where: { trainerId: trainer.id },
    orderBy: { createdAt: 'desc' },
  });
}

module.exports = {
  createPackage,
  listPackages,
  updatePackage,
  deactivatePackage,
  createPurchase,
  handleWebhookEvent,
  refundPurchase,
  listPurchases,
  listTrainerPurchases,
  listEntitlements,
  listPayouts,
};
