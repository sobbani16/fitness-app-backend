# Payment Provider Integration Proposal (NOT IMPLEMENTED — design only)

Paid commerce is disabled for launch. This proposal covers the real-provider
architecture when product/legal review approves it.

## Provider split — physical services vs digital goods

| Surface | Provider | Why |
|---|---|---|
| Trainer coaching packages (physical service delivered by a human) | **Stripe Checkout** (intl) / **Razorpay** (India: UPI, cards, RBI-compliant) | Apple/Google IAP rules exempt "person-to-person" real-world services — coaching sessions qualify; card checkout avoids the 15-30% store cut |
| Digital-only unlocks (if any ever added: premium content, AI extras) | **Apple IAP / Google Play Billing** — REQUIRED by store policy | Store rules mandate IAP for digital goods consumed in-app |

## Architecture

- `PAYMENTS_PROVIDER=stripe|razorpay|iap` → `getProvider()` returns a real
  adapter implementing the existing MockProvider contract (`createCheckout`,
  `verifyWebhook`, `issueRefund`, `checkoutRef`). The webhook handler, purchase
  state machine, entitlement activation, replay protection, and flag gates are
  already provider-agnostic.
- Webhooks: Stripe `stripe-signature` (HMAC + timestamp tolerance), Razorpay
  `X-Razorpay-Signature`, App Store Server Notifications (JWS chain to Apple
  root), Play `RTDN` via Pub/Sub OIDC. Raw-body capture required per provider —
  mount dedicated raw-body parsers on webhook subroutes before `express.json`.
- Amount/currency: keep the existing `verifyEventMatchesPurchase` exact-match —
  events supply `amount_total`/`currency` per provider schema.
- IAP: receipts verified server-side via App Store Server API / Play Developer
  API; entitlement keyed to `originalTransactionId` (Apple) / `purchaseToken`
  (Play). Client never claims success — same trust model.
- Refunds: Stripe `Refund` API bounded to charge amount; Razorpay refund API;
  store refunds arrive via server notifications → existing `payment.refunded`.
- Subscriptions: provider-managed (`subscription_schedule` / store
  auto-renewable) → map lifecycle events onto `payment.succeeded`/renewal/
  `customer.subscription.deleted`; expiry via `endsAt` on TrainerSubscription.
- Regional: Razorpay for INR/UPI; Stripe for the rest; pick per-user region at
  checkout creation, never let the client choose its own provider.

## Activation checklist (when approved)

1. Implement adapter + tests mirroring `MockProvider` contract tests.
2. Provision `PAYMENTS_WEBHOOK_SECRET` (per provider) + `PAYMENTS_PROVIDER`.
3. Raw-body middleware for real signature verification.
4. Legal/compliance review (refund policy, GST/tax, store exceptions for
   person-to-person services on iOS).
5. Flag rollout: `trainer_paid_coaching_enabled` staged via feature flags.
