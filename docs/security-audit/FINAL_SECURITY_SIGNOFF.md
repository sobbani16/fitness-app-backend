# Final Security Sign-off — Phase 2

## Vulnerability / finding table

| # | Finding | Risk | Found where | Fix | Status |
|---|---------|------|-------------|-----|--------|
| 1 | Mock payment provider + `mock-secret` usable in prod | HIGH | payments/provider.js | prod-gated `getProvider` + `webhookSecret()` fail-closed | FIXED |
| 2 | Webhook events unverified vs purchase | HIGH | trainerCommerceService | amount+currency exact match, provider binding, refund bounds | FIXED |
| 3 | Webhook route unrate-limited | MED | paymentWebhooks.js | dedicated limiter | FIXED |
| 4 | Dev-secret fallbacks for capability tokens | HIGH | viewAs, communication, formChecks | `requiredSecret` fail-closed; HMAC domain separation | FIXED |
| 5 | View-as `timingSafeEqual` length crash | LOW | viewAsService | length check | FIXED |
| 6 | `req.body.userId` identity fallback | MED | personalPlans, menuAnalysis, exerciseController | removed | FIXED |
| 7 | Signed webhook grants while commerce disabled | MED | trainerCommerceService | `commerce_disabled` flag gate | FIXED (P2) |
| 8 | `AUTH_LINK_SECRET` reused raw for all signing | MED | lib/env | HMAC domain separation `humai:<purpose>` | FIXED (P2) |
| 9 | Missing per-feature secret validation | MED | startup | `validateConfig` feature-conditional | FIXED (P2) |
| 10 | Predictable values accepted if explicitly set | MED | lib/env | `isPredictable` blocklist rejected in prod | FIXED (P2) |
| 11 | Concurrent `payment.succeeded` double-grant | MED | applyEvent (2nd pass) | atomic `updateMany` claim; entitlement only on count=1 | FIXED (P2) |
| 12 | Checkout idempotency cross-user disclosure | MED | createPurchase (2nd pass) | `clientId` ownership check → 409 | FIXED (P2) |
| 13 | Double-refund race (provider called pre-claim) | MED-LOW | refundPurchase (2nd pass) | atomic `refund_pending` claim + release on failure | FIXED (P2) |
| 14 | Supplement dose idempotency same-pattern leak | LOW | supplements.js (2nd pass) | `userId` ownership check → 409 | FIXED (P2) |
| 15 | `reminders.js` undefined `fail()` → crash path | LOW | reminders.js (2nd pass) | explicit 500 JSON | FIXED (P2) |
| 16 | Admin app `x-user-id` spoofed identity, no auth | HIGH | fitness-app-admin | real bearer session + permission gate + logout | FIXED (P2) |
| 17 | Dep advisories: prisma chain, swagger, zod, next, postcss, playwright, vite, axios, react-router, minimatch | HIGH | all lockfiles | overrides/upgrades; **0 vulns web/admin; 0 high/crit backend** | FIXED (P2) |
| 18 | Mobile image-size DoS | HIGH(scanner)/LOW(real) | metro toolchain | build-time only, needs malicious repo asset; no safe fix until metro 0.87/RN SDK upgrade | RISK-ACCEPTED (documented) |
| 19 | `.env` tracked mobile+admin (public URLs only) | MED | git history | untracked + gitignore verified | FIXED |
| 20 | Dashboard Promise.all misalignment | functional | web dashboard | reorder — all 25 pre-existing TS errors cleared | FIXED (P2) |

## Second-pass review items intentionally deferred (documented lows)

| Item | Disposition |
|------|-------------|
| Route-level `err.message` passthrough on 5xx (paymentWebhooks, commerce, chat, etc.) | LOW — global middleware already returns generic errors; route catches echo only `err.message` of thrown httpErrors in practice; logged for hardening follow-up |
| `identities.js` external-identity linking trusts caller iss/sub | DARK FEATURE — flag off; must require verified ID-token proof before enabling |
| Communication.js stale comment about signature contents | cosmetic |
| CI grep-guard literal coverage | backstopped by behavioral jest job — accepted |
| HF-0016 calorie floor | policy module complete but deliberately unwired — **clinical sign-off required**, not a code defect (open decision G4) |
| Admin MFA | documented decision needed; compensating controls listed below |

## Launch blocker tracker

| Blocker | Previous | Current | Remaining action | Owner |
|---|---|---|---|---|
| Predictable/missing prod secrets | OPEN | CODE FIXED | Provision per runbook §1 | user |
| Mock payments in prod | OPEN | RESOLVED (verified disabled) | none — enable real provider only per proposal | — |
| Dependency vulns | OPEN | RESOLVED (1 risk-accepted) | expo SDK upgrade track for image-size | future sprint |
| Admin unauthenticated | OPEN | RESOLVED | Set `CORS_ORIGINS` incl. admin origin at deploy | user |
| Secret rotation (local dev keys) | OPEN | runbook ready | Rotate: AUTH_LINK_SECRET + provider keys used in local `.env` | user |
| Authorization coverage | OPEN | VERIFIED (68 tests, 0 holes) | none | — |
| CI gates | OPEN | OPERATIONAL | Branch protection + require checks on main | user |
| Cross-repo regressions | OPEN | VERIFIED (see below) | none | — |
| EAS/device artifact | — | BLOCKED | EAS build + device smoke (no creds in env) | user |
| PR creation/merge | — | PREPARED | Create PRs per RELEASE_CANDIDATE_REPORT (gh absent) | user |
| Clinical calorie floor | open decision | policy-ready, unwired | clinical review sign-off | clinical owner |
| Admin MFA | decision | documented | choose MFA or compensating controls (IP allowlist) | user |

## Test totals (final candidate)

| Repo | Result |
|------|--------|
| backend | 6127 total — 6076 pass, 48 todo, 4 skipped, **0 real failures** (1 transient DB socket flake, 3/3 isolated green) |
| mobile | 673/673, typecheck clean |
| web | build green, 0 TS errors, vitest configured (e2e needs live env) |
| admin | build + typecheck green |

Security-specific: securityHardening 12, trainerCommerce 26, authorization.memberAB 68.

## Readiness states

- Code complete: **YES**
- Tests complete: **YES** (unit+integration; browser e2e blocked — needs live env)
- Release candidate ready: **YES**
- Production configuration ready: **NO** — secrets + CORS provisioning pending (runbook §1)
- Production deployment verified: **NO**
- Public launch ready: **NO** — pending manual actions above; all code gates are green
