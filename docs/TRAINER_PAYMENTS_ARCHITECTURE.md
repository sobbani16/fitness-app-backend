# Trainer Payments — Architecture

Date: 2026-10-31 · Verified against `src/services/trainerCommerceService.js`, `src/services/payments/provider.js`, `src/routes/{trainerCommerce,myPurchases,paymentWebhooks}.js`, `src/app.js`, `prisma/schema.prisma` (models 2225–2333). Flag: `trainer_paid_coaching_enabled` (**default off — stays off until legal/store review**). Tests: `tests/trainerCommerce.test.js` (19).

## 1. Trust model

**Purchases never transition on client-reported success.** The only mutation paths are: (a) signature-verified webhooks via `handleWebhookEvent`, and (b) server-initiated provider calls (`refundPurchase` — provider confirms *before* anything is recorded, outside the tx). Checkout creates `status:'pending'`; `paid` arrives only via `payment.succeeded` webhook.

## 2. Provider abstraction (`services/payments/provider.js`)

Duck-typed contract — the only module knowing vendor details:

```js
createCheckout({ purchaseId, amountCents, currency, buyerId, metadata })
  → { providerRef, checkoutUrl, status, expiresAt }
verifyWebhook(headers, rawBody) → event | null        // null on bad signature/malformed
  event: { id, type, purchaseId?, providerRef?, amountCents?, currency?, reason? }
refund(providerRef, amountCents) → { refundRef, providerRef, amountCents, status }
```

| Impl | Detail |
|---|---|
| `MockProvider` (default, `PAYMENTS_PROVIDER=mock`) | deterministic `providerRef` = `mock_co_<sanitized idempotencyKey\|purchaseId>`; `checkoutUrl` is a `mock://` URL; `issueEvent(type, fields)` (test/dev helper, **not** contract) fabricates correctly-signed webhook deliveries so tests exercise the real verification path |
| `getProvider(name)` | env `PAYMENTS_PROVIDER` or route `:provider`; unknown → 400 |
| `StripeConnectProvider` | **not implemented** — documented extension point |

Raw-body note: the app parses JSON globally (no raw-body capture), so the route passes `JSON.stringify(req.body)` and providers sign that same serialization.

## 3. Webhook security

`POST /webhooks/payments/:provider` — **public**, mounted in `app.js` before session auth; trust comes solely from HMAC.

| Step | Detail |
|---|---|
| Signature | `x-mock-signature` or `x-payment-signature` header = `'sha256=' + HMAC-SHA256(secret, rawBody)`; `timingSafeEqual` compare; `PAYMENTS_WEBHOOK_SECRET` env (default `mock-secret` — dev only) |
| Failure | missing/bad signature or malformed payload → **400** |
| Idempotency | `providerEventId = '<provider>:<event.id>'` recorded in `TrainerPaymentTransaction` (@unique); duplicate → `{duplicate:true}` 200 so provider stops retrying |
| Unknown purchase | `{received:true, ignored:'unknown_purchase'}` 200 — ack to stop retries |
| Event mapping | `payment.succeeded` → `paid` + `activateEntitlement` (replay-safe: only first success activates) · `payment.failed`/`checkout.canceled`/`checkout.expired` → `failed`/`canceled` from `pending` only · `payment.refunded` → `markRefunded` · unknown types recorded but ignored |
| Flag | **not** flag-gated — keeps applying while `trainer_paid_coaching_enabled` is off (intentional: wedges no provider retry loop) |

## 4. Purchase & entitlement lifecycle

| Model | States |
|---|---|
| `TrainerCoachingPackage` | `kind subscription\|one_time\|session_pack` (**immutable** post-create — 400), `sessionCount` (required 1–1000 for packs), `interval month\|year` (subs, def month), `priceCents 1–10,000,000`, `currency` 3-letter, `active` (deactivated, never deleted — history) |
| `TrainerPurchase` | `pending → paid \| failed \| canceled → refunded`; `providerRef @unique` = checkout idempotency anchor |
| `TrainerEntitlement` | server-side grant on first `payment.succeeded`: `subscription` → kind `subscription` + `expiresAt` (now+1mo/1yr) + `TrainerSubscription(1:1)` · `session_pack` → `remainingSessions=sessionCount` · `one_time` → kind `session`, `remainingSessions=1`. Statuses `active\|exhausted\|expired\|revoked` — **no decrement/consume path exists yet** (entitlements are granted and revoked, never spent) |
| `TrainerSubscription` | `active\|canceled\|expired\|past_due`, `currentPeriodEnd` (no renewal events modeled) |
| `TrainerRefund` | `pending\|processed\|failed`; refund revokes active entitlements + cancels subscription atomically |
| `TrainerPaymentTransaction` | append-only event log per purchase (`checkout`, `payment`, `refund`, `payout`, `subscription_update`) |
| `TrainerPayout`, `TrainerPromotion` | modeled, **no processing/validation code** |

Checkout idempotency: client `idempotencyKey` (required, ≤120) → deterministic `providerRef` → `findUnique` short-circuits (`{reused:true}` 200); concurrent insert P2002 → returns winner.

## 5. Endpoints

`/trainer/commerce` (`requireFeature` + `requireRole('TRAINER')` + `requireApprovedTrainer`):

| Method | Path | Notes |
|---|---|---|
| POST | `/packages` | create; 201 |
| GET | `/packages` `?active=1` | own packages |
| PATCH | `/packages/:id` | own only; `kind` immutable |
| DELETE | `/packages/:id` | deactivate only |
| GET | `/purchases` | sales of own packages |
| GET | `/payouts` | recorded payouts (usually `[]` — execution not built) |
| POST | `/purchases/:purchaseId/refund` | own trainer's sale + `status:'paid'`; `{amountCents?, reason?}` |

`/me` (`requireFeature` + `identifyUser`):

| Method | Path | Notes |
|---|---|---|
| POST | `/me/purchases/checkout` | `{packageId*, idempotencyKey*}` → 201/200 `{purchase, checkout}`; trainer blocked from buying own package (400) |
| GET | `/me/purchases` | own history |
| GET | `/me/entitlements` | own entitlements |

## 6. Store-policy findings (blocking activation)

| Finding | Implication |
|---|---|
| Live 1:1 human coaching is generally **IAP-exempt** on both app stores (real-world service) | session/subscription purchases may use external payments |
| Digital content/packages (pre-recorded plans, downloadable content) **may not** be exempt | package `kind`/catalog split needs counsel review before flag-on |
| US payout rails | Stripe Connect Express covers US |
| **India payout gap** | Connect doesn't cover India payouts — needs PayPal/wise-style alternative; documented decision, no code |
| `PAYMENTS_WEBHOOK_SECRET` default `mock-secret` | must be provisioned before any real provider; never ship default to prod |

## 7. What's deliberately absent

live Stripe/PayPal integration · entitlement consumption/decrement · subscription renewal webhooks (`subscription_update` type reserved) · payout execution · promo-code application · IAP receipt validation · tax/KYC handling.
