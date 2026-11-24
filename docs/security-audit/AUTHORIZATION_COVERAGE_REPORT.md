# Authorization & Security Category Coverage — Phase 2

## Member A/B evidence

`tests/authorization.memberAB.test.js` — **68 tests, all passing** (generic
in-memory prisma mock; a handler missing `userId` scoping leaks the other
member's seeded rows and fails). Surfaces exercised with real endpoints:

health-conditions, allergies, food-logs, personal-plans, meal-plans,
coach-notes, health-score (+:id detail), daily-progress, documents (list,
cross-issued signed URL **rejected when replayed by B**), conversations,
check-ins, reminders (+preferences), supplements (schedules/doses), notifications,
purchases, entitlements, account export (service-level), trainer↔client with
**revoked relation → 403**. Findings: **no authorization holes.**

## 28-category coverage matrix

| # | Category | Modules / files inspected | Endpoints | Evidence | Tests | Result | Gaps |
|---|----------|---------------------------|-----------|----------|-------|--------|------|
| SEC-001 | Admin routes/RBAC | admin.js, rbac.js, config/rbac.js | ~40 /admin/* | all requirePermission; roles.ts predicate | route tests + memberAB | SECURED | MFA pending (manual action) |
| SEC-002 | AuthN | authService, authLifecycle, authenticate | /auth/* (9) | scrypt, sha256 sessions, atomic tokens, generic reset | auth tests + securityHardening | SECURED | — |
| SEC-003 | Identity spoofing | authenticate.js + all routes | all | header rewritten; body/query userId removed (personalPlans, menuAnalysis, exerciseController) | memberAB body-injection cases | SECURED | — |
| SEC-004 | RBAC enforcement | requirePermission/requireRole | role-gated | live RolePermission lookup; revocation immediate | admin tests | SECURED | — |
| SEC-005 | Object-level authz | every user-data route | ~120 | userId scoping verified behaviorally | memberAB 68 tests | SECURED | — |
| SEC-006 | Payments | payments/provider, trainerCommerceService, paymentWebhooks | checkout, webhook, refund | signature+amount+currency+provider binding+flag gate+rate limit+replay | trainerCommerce 24, securityHardening | SECURED (disabled) | real provider pending (design doc) |
| SEC-007 | Uploads | formChecks, communication docs | upload routes | magic-byte, size caps, private storage, short signed URLs | formChecks tests | SECURED | — |
| SEC-008 | Secrets/config | lib/env, all requiredSecret consumers | n/a | domain-separated HMAC, predictable-value rejection, fail-closed prod | securityHardening | SECURED | prod provisioning (manual) |
| SEC-009 | Rate limiting | app.js, paymentWebhooks, auth | public surface | global IP+user+login+webhook limiters | tests | SECURED | — |
| SEC-010 | AI | aiProvider, chat, foodIntel | /chat, /voice, scan routes | store:false, quotas, flag-gated, JSON-schema, server re-validation | ai/voice tests | SECURED | — |
| SEC-011 | Health-safety boundaries | allergen filters, clinical rules, calorieSafety | plan/suggestion routes | deterministic filters; allergy persistence live (HF-0001 fixed); floor policy gated on clinical approval | safety suites | SECURED (w/ noted gate) | HF-0016 floor awaits clinical sign-off (open decision G4) |
| SEC-012 | Feature flags | featureRegistry, requireFeature, flags/service | gated routes | backend-authoritative, failOpen:false on sensitive flags | flag-off tests | SECURED | — |
| SEC-013 | CORS/headers | app.js helmet+cors | all | allowlist-only; no credentials flag needed (bearer) | config | SECURED | prod CORS_ORIGINS value (manual) |
| SEC-014 | SQL injection | all $queryRaw | all | Prisma tagged templates only | grep sweep | SECURED | — |
| SEC-015 | Session/token lifecycle | authService, viewAsService | auth + x-view-as | 32B tokens, expiry, revocation, view-as TTL+length-check | securityHardening | SECURED | — |
| SEC-016 | Impersonation (view-as) | viewAs.js/service | /admin/view-as/* | SUPER_ADMIN_PANEL only, GET/HEAD only, signed+TTL | viewAs tests | SECURED | — |
| SEC-017 | Webhooks | paymentWebhooks | /webhooks/payments/:p | dedicated limiter, signature, flag gate | commerce tests | SECURED | — |
| SEC-018 | Email flows | authEmail, resend | verify/reset links | HMAC action tokens, expiry, generic responses | auth tests | SECURED | — |
| SEC-019 | Dependencies | all 4 lockfiles | n/a | overrides/upgrade; audit-gate in CI | audit-gate run | SECURED | mobile image-size (risk-accepted) |
| SEC-020 | Secret exposure | .env files all repos, git history | n/a | only public URLs ever tracked; untracked now; .easignore/.gitignore verified | ls-files check | SECURED | rotate local-dev keys (manual) |
| SEC-021 | CSRF | BFF (web), bearer (admin/mobile) | mutations | token never ambient → no CSRF surface; web BFF has Origin+X-Requested-With check | web bff review | SECURED | — |
| SEC-022 | Error handling | app.js error middleware | all | public codes, correlationId, no stack/secret leak; env errors name vars only | review | SECURED | — |
| SEC-023 | Logging/telemetry | morgan, posthog, console | all | no secret logging; provisioning util never echoes | review | SECURED | — |
| SEC-024 | Health data privacy | conditions, allergies, measurements | /me/health-* | owner-scoped, verified-email gated | memberAB | SECURED | — |
| SEC-025 | Trainer/nutritionist relation | trainerAccess, trainerClient | /trainer/* | approved+active relation required; revoked→403 | memberAB | SECURED | — |
| SEC-026 | Account lifecycle | account.js, accountData | export/delete | owner-only, re-auth on export, scoped deletion | memberAB service tests | SECURED | — |
| SEC-027 | CI/CD gates | security.yml, audit-gate.js | n/a | gitleaks+audit gate+config guards+behavioral tests; no continue-on-error | workflow review | SECURED | branch protection (manual) |
| SEC-028 | Mobile/client storage | mobile session storage | n/a | SecureStore tokens, no x-user-id spoofing | Phase-1 review | SECURED | — |

## `req.*.userId` usage sweep

Authenticated identity is exclusively `req.userId` (set by `authenticate`).
Remaining `req.params.userId`/`req.query` target-id uses are admin/trainer
paths with permission or active-relation checks (verified in the memberAB
sweep). No `req.body.userId` identity fallbacks remain (grep: 0 hits in src/).
