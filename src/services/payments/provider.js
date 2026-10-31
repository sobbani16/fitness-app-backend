// Payment provider abstraction — the ONLY module that knows vendor details.
// Swapping providers means adding a class here and a case in getProvider();
// services and routes stay unchanged.
//
// PaymentProvider contract (duck-typed):
//   createCheckout({ purchaseId, amountCents, currency, buyerId, metadata })
//       -> { providerRef, checkoutUrl, status, expiresAt }
//   verifyWebhook(headers, rawBody) -> event | null
//       event: { id, type, purchaseId?, providerRef?, amountCents?, currency?, reason? }
//       Returns null when the signature is missing/invalid or the payload is
//       malformed. rawBody is the exact serialized payload — the app parses
//       JSON globally, so routes pass JSON.stringify(req.body) and providers
//       sign that same serialization.
//   refund(providerRef, amountCents)
//       -> { refundRef, providerRef, amountCents, status }
//
// Providers NEVER receive trust from client-reported success: state changes
// only happen inside handleWebhookEvent after verifyWebhook passes.

const { createHmac, createHash, timingSafeEqual } = require('node:crypto');
const { httpError } = require('../../lib/errors');

const SIGNATURE_HEADERS = ['x-mock-signature', 'x-payment-signature'];
const CHECKOUT_TTL_MS = 30 * 60 * 1000;

function webhookSecret() {
  return process.env.PAYMENTS_WEBHOOK_SECRET || 'mock-secret';
}

/**
 * Deterministic provider for local dev + tests. Every checkout "succeeds"
 * instantly — issueEvent() produces the correctly-signed webhook delivery a
 * real provider would POST, so tests exercise the same signature-verified
 * path production providers will use.
 */
class MockProvider {
  constructor(secret = webhookSecret()) {
    this.name = 'mock';
    this.secret = secret;
  }

  /** HMAC-SHA256 signature over the exact serialized payload. */
  sign(rawBody) {
    return 'sha256=' + createHmac('sha256', this.secret).update(rawBody).digest('hex');
  }

  /**
   * Deterministic providerRef for a checkout. Client-supplied idempotencyKey
   * wins so a retried checkout maps to the same ref (TrainerPurchase.providerRef
   * is unique — that is the idempotency anchor).
   */
  checkoutRef({ idempotencyKey, purchaseId }) {
    const raw = (idempotencyKey || purchaseId || '').toString();
    const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    return `mock_co_${safe || createHash('sha256').update(raw).digest('hex').slice(0, 24)}`;
  }

  async createCheckout({ purchaseId, amountCents, currency, buyerId, metadata = {} }) {
    const providerRef = this.checkoutRef({ idempotencyKey: metadata.idempotencyKey, purchaseId });
    return {
      providerRef,
      checkoutUrl: `mock://checkout/${providerRef}?buyer=${encodeURIComponent(buyerId)}&amount=${amountCents}&currency=${currency}`,
      status: 'pending',
      expiresAt: new Date(Date.now() + CHECKOUT_TTL_MS).toISOString(),
    };
  }

  verifyWebhook(headers, rawBody) {
    if (typeof rawBody !== 'string' || !rawBody) return null;
    const presented = SIGNATURE_HEADERS.map((h) => headers[h]).find((v) => typeof v === 'string' && v);
    if (!presented) return null;
    const expected = Buffer.from(this.sign(rawBody));
    const actual = Buffer.from(presented);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (!event || typeof event !== 'object' || typeof event.id !== 'string' || typeof event.type !== 'string') return null;
    return event;
  }

  async refund(providerRef, amountCents) {
    // Deterministic: identical refund requests collapse to one ref.
    const refundRef = 'mock_rf_' + createHash('sha256').update(`${providerRef}:${amountCents}`).digest('hex').slice(0, 20);
    return { refundRef, providerRef, amountCents, status: 'succeeded' };
  }

  /**
   * Dev/test helper — NOT part of the PaymentProvider contract.
   * Builds the signed webhook delivery the mock "sends" for an event, e.g.
   *   issueEvent('payment.succeeded', { purchaseId, providerRef, amountCents })
   * then POST rawBody to /webhooks/payments/mock with the returned headers.
   */
  issueEvent(type, fields = {}) {
    const digest = createHash('sha256').update(type + JSON.stringify(fields)).digest('hex').slice(0, 16);
    const event = { id: fields.id || `evt_${digest}`, type, ...fields };
    const rawBody = JSON.stringify(event);
    return { event, rawBody, headers: { 'x-mock-signature': this.sign(rawBody) } };
  }
}

const providers = { mock: () => new MockProvider() };

/** Factory: PAYMENTS_PROVIDER env (default 'mock'); routes may pass :provider. */
function getProvider(name) {
  const wanted = (name || process.env.PAYMENTS_PROVIDER || 'mock').toLowerCase();
  const factory = providers[wanted];
  if (!factory) throw httpError(400, `Unsupported payment provider: ${wanted}`);
  return factory();
}

module.exports = { MockProvider, getProvider, SIGNATURE_HEADERS };
