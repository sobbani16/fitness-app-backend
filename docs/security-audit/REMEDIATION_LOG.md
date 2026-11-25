# Remediation Log

## Batch 1 — payments + capability secrets (branch security/master-audit-remediation)

| Finding | Change | Verification |
|---------|--------|--------------|
| SEC-F-001 mock provider/secret | `provider.js`: `getProvider` refuses `mock` when `isProduction()`; `webhookSecret()` throws 503 in prod without `PAYMENTS_WEBHOOK_SECRET` | tests/securityHardening.test.js (5 cases) |
| SEC-F-002 amount verification | `trainerCommerceService.js`: `verifyEventMatchesPurchase` — `payment.succeeded` requires exact amountCents + currency match; `payment.refunded` bounded to purchase total; purchase.provider must match route provider | tests/trainerCommerce.test.js +4 new cases |
| SEC-F-003 webhook rate limit | `paymentWebhooks.js`: dedicated per-IP limiter (120/min default, WEBHOOK_RATE_LIMIT) since mount precedes app limiter | module load + suite pass |
| SEC-F-004 dev-secret fallbacks | new `src/lib/env.js` `requiredSecret()` fail-closed in prod; applied to `DOC_URL_SECRET`, `VIDEO_TOKEN_SECRET` (communication.js), `FORM_CHECK_URL_SECRET` (formChecks.js), `VIEW_AS_SECRET` (viewAsService.js) | tests/securityHardening.test.js (3 cases) |
| SEC-F-005 view-as crash | `verifyViewAsToken`: length check before `timingSafeEqual` | tests/securityHardening.test.js (2 cases) |
| SEC-F-006 body userId | removed `req.body?.userId` identity fallbacks in personalPlans.js, menuAnalysis.js, exerciseController.js | suites pass |

Existing tests updated: `tests/trainerCommerce.test.js` — hoisted `mockCheckoutFlow`, added `provider`/`currency` to event fixtures, +4 webhook-integrity cases.

Results: trainerCommerce 23/23, securityHardening 10/10, formChecks+viewAs+personalPlans+menuAnalysis 40/40.
