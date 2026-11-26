# Paid Commerce — Safely Disabled Verification

Decision: **paid commerce stays disabled for public launch** (no approved product
requirement exists; only a mock provider is implemented). This document proves
the disabled state is fail-closed.

## Entry-point verification

| Entry point | Control | Verified |
|---|---|---|
| `POST /trainer/commerce/*` (packages, payouts, refunds) | `requireFeature('trainer_paid_coaching_enabled')` + `requireRole('TRAINER')` — flag default `false`, `failOpen:false` | trainerCommerce.test.js 24/24 |
| `POST /me/purchases/checkout` | flag-gated `myPurchases` router | FEATURE_DISABLED test |
| `GET /me/purchases`, `/me/entitlements` | flag-gated | FEATURE_DISABLED test |
| `POST /webhooks/payments/:provider` | signature + provider binding + amount/currency match + **flag gate**: `isEnabled('trainer_paid_coaching_enabled', purchase.clientId)` → `{ignored:'commerce_disabled'}` — signed events cannot transition or entitle | disabled-webhook test (trainerCommerce.test.js) |
| Provider selection | `getProvider()` throws if `PAYMENTS_PROVIDER`/`mock` used when `isProduction()` (NODE_ENV=production **or** RAILWAY_ENVIRONMENT_NAME=production — staging's prod NODE_ENV does not block the mock, real prod does) | securityHardening.test.js (5 cases) |
| Webhook secret | `webhookSecret()` throws 503 in prod without `PAYMENTS_WEBHOOK_SECRET`; predictable values rejected | securityHardening.test.js |
| Refunds | route flag-gated; provider-side refund bounded to purchase total | refund-bounds test |
| Background jobs | none exist for commerce (verified — no scheduler touches trainerPurchase) | grep |
| Mobile checkout UI | `TrainerPackages`/`Entitlements` screens behind `gateScreen('trainerPaidCoachingEnabled')` — flag default false → not reachable | RootNavigator.tsx:223-224,382-383 |
| Web checkout UI | none exists (only super-admin component references purchases) | grep |

## Startup independence

Missing `PAYMENTS_WEBHOOK_SECRET` does NOT block unrelated functionality:
`validateConfig` only requires it when `PAYMENTS_PROVIDER` is a real provider
(`enabled()` in SECRET_RULES); `webhookSecret()` throws lazily at webhook call
time, never at boot. Login/meals/etc. unaffected — verified: `node -e require('./src/app')`
loads with the var unset.

## Replay/idempotency/concurrency (from Phase 1, re-verified)

- `providerRef` unique → idempotent checkout; `providerEventId` unique → replay
  returns `{duplicate:true}` without re-applying.
- Purchase bound to creating provider (`purchase.provider !== provider.name` → 400).
- `payment.succeeded` requires exact amount+currency; `payment.refunded` bounded.
- State transitions inside `coachingTransaction`; concurrent events serialize on
  the purchase row.

## Residual risk while disabled

Effectively none for granting entitlements: a forged webhook needs the mock
provider enabled (prod-blocked) or the real secret plus a pre-existing purchase
plus the feature flag on — three independent controls.

## Enabling later

See `PAYMENT_PROVIDER_PROPOSAL.md` for the Stripe/Razorpay/IAP architecture.
Enabling requires: real provider impl, `PAYMENTS_PROVIDER` set,
`PAYMENTS_WEBHOOK_SECRET` provisioned, flag rolled out — each independently gated.
