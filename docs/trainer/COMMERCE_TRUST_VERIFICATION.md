# Commerce, Payments & Marketplace Trust — Verification (2026-11-25)

pc-HUM-143 audit + implementation against `origin/main` (`3650bbb`).
The payments skeleton from the trainer-platform build was already deep;
the marketplace-trust gap this card closes is **entitlement consumption**:
paid session packs previously never depleted.

## 1. What existed (verified)

| Layer | Evidence |
|---|---|
| Provider abstraction | `services/payments/provider.js` — mock provider exercises the same HMAC-signed path a real provider will; `PAYMENTS_WEBHOOK_SECRET` fails closed in production (503, no predictable fallback) |
| Webhook trust | state mutates only inside `handleWebhookEvent` after `verifyWebhook` passes — never on client-reported success; replay-safe via unique `providerEventId` (P2002 → `{duplicate: true}` ack) |
| Amount verification | `payment.succeeded` events must match purchase amount+currency exactly — a mis-wired integration cannot activate entitlements |
| Purchase state machine | atomic claim `not: 'paid' → 'paid'` inside the tx — concurrent duplicate events can't double-grant; unknown-purchase events acked-and-ignored (provider stops retrying); wrong-provider events rejected; commerce-disabled fail-closed |
| Refunds | trainer-initiated: atomic `paid → refund_pending` claim BEFORE the external provider call (never inside a tx), provider-confirmed, then recorded — concurrent refunds impossible |
| Entitlement revocation | refund revokes active entitlements + cancels subscriptions atomically |
| Client surface | `/me/purchases` (history), `/me/purchases/checkout`, `/me/entitlements` (balance), `/trainer/commerce/*` (packages, payouts, refunds) — all flag-gated `trainer_paid_coaching_enabled` (OFF pending store/legal review) |
| Tests | `tests/trainerCommerce.test.js` — 26/26 on main |

## 2. Gap closed on this branch — entitlement consumption

`remainingSessions` was written at purchase time but **never decremented** —
a 5-session pack entitled unlimited bookings. Implemented in
`src/services/schedulingService.js`:

- **Consume on request**: booking consumes one session from the client's
  soonest-expiring usable entitlement (`session`/`session_pack` kinds only —
  subscriptions are time-based and never decrement). Guarded atomic decrement
  (`remainingSessions > 0` in the updateMany where) — concurrent bookings
  can't drive it negative. Pack hits 0 → status `exhausted`.
- **Restore on cancel/decline**: exactly-once via atomic status-transition
  claims (`updateMany` on `status in CANCELABLE/RESPONDABLE`) — the loser of
  a concurrent double-cancel cannot double-restore. This also closes a latent
  race in the pre-existing cancel/respond paths.
- **Never restore into revoked/expired**: a refund that lands mid-flight
  already returned the money — restoring the session would double-compensate.
- **Reschedule keeps the consumption** (same session, new time).
- **No-entitlement bookings proceed unchanged** — requiring an entitlement to
  book is a product decision (below), not a trust invariant.

Schema: `TrainerBooking.entitlementId` (nullable, FK `ON DELETE SET NULL` +
index) — additive migration `20261228000000_booking_entitlement_consumption`.

## 3. Test evidence

```
npx jest tests/scheduling.test.js tests/trainerCommerce.test.js \
    tests/trainerWorkoutPlans.test.js --runInBand
→ 3 suites passed, 68/68 tests
```
9 new consumption tests written failing-first (all red pre-implementation):
consume/exhaust/subscription-exempt/free-flow/expired-skip/cancel-restore-once/
decline-restore/revoked-no-restore/reschedule-keeps.

## 4. Deferred — needs product/legal decisions, not engineering

1. **Entitlement-required booking**: whether booking *requires* a paid
   entitlement when commerce is enabled (today: optional consumption).
   Changes the free-booking product behavior — human decision.
2. **Real payment provider**: only the deterministic mock exists. Stripe/etc.
   requires credentials, webhook endpoint registration, and store/legal
   review — the flag `trainer_paid_coaching_enabled` is documented OFF
   until then (registry line 560-568).
3. **Cancellation/refund policy**: cancel currently always restores. If
   policy becomes "late cancel forfeits the session", that's a rules change
   inside `cancel()` — needs the policy first.

## Residual engineering items

- Subscription renewal flow: `payment.succeeded` on a subscription renews
  `currentPeriodEnd`? — renewal events are recorded but the period extension
  semantics are untested; needs a real provider's event taxonomy first.
- `EntitlementEvent` (platform-level audit model) is not yet written by the
  trainer-commerce path — purchase/refund audit currently lives in
  `TrainerPaymentTransaction` + `auditLog`.
