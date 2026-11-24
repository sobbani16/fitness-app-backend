# Security Findings — Humai Master Security Audit

Legend: severity = exploit impact in a realistic deployed configuration; status uses the
audit's required vocabulary.

| ID | Category | Severity | Title | Status |
|----|----------|----------|-------|--------|
| SEC-F-001 | SEC-006 | CRITICAL | Mock payment provider + `'mock-secret'` default signing secret forgeable on public webhook route; `:provider` URL param selects it regardless of configured provider | CONFIRMED — fix in progress |
| SEC-F-002 | SEC-006 | HIGH | `payment.succeeded` webhook events activate entitlements without verifying amount/currency against the purchase record | CONFIRMED — fix in progress |
| SEC-F-003 | SEC-006 | MEDIUM | Public webhook endpoint mounted before the IP rate limiter — unauthenticated DB-work amplification; no event freshness/timestamp checks | CONFIRMED — fix in progress |
| SEC-F-004 | SEC-003/018 | MEDIUM | Capability-token secrets fall back to public dev values (`'dev-doc-secret'`, `'dev-video-secret'`, `'dev-view-as-secret'`, `'dev-formcheck-secret'`) when env unset — forged signed URLs/tokens if a deployment skips `deploy:prepare` | CONFIRMED — fix in progress |
| SEC-F-005 | SEC-001 | LOW | `verifyViewAsToken` throws on signature length mismatch (`timingSafeEqual` TypeError → 500) instead of a clean 403 | CONFIRMED — fix in progress |
| SEC-F-006 | SEC-002 | LOW | `req.body.userId` identity fallbacks in personalPlans.js, menuAnalysis.js, exerciseController.js — unreachable today (authenticate always rewrites the header) but a dangerous latent pattern | CONFIRMED — fix in progress |
| SEC-F-007 | SEC-013 | LOW | `.env` git-tracked in fitness-app-mobile and fitness-app-admin — contents are public URLs only (EXPO_PUBLIC_API_URL=localhost, VITE_API_URL); still violates policy and invites future leaks | CONFIRMED — fix in progress |
| SEC-F-008 | SEC-001 | INFO | fitness-app-admin (single-commit Vite stub) authenticates with a raw `x-user-id` header and no session token — backend ignores the header, so the app is non-functional, not an exploit path | CONFIRMED — documented; no backend change required |

## Categories assessed NOT FOUND / clean within verified scope

- **SEC-001 admin routes**: all `/admin`, `/super-admin`, view-as, audit-logs, communication-admin routes sit behind global `authenticate` + `requirePermission`; role changes re-authorize inside the transaction, revoke sessions, audit, and protect the last super-admin. No bypass found.
- **SEC-002 IDOR**: sampled ~25 route families; consistent fetch-then-compare-`userId` (404) or query-scoped-`userId` ownership enforcement; trainer paths require approved profile + active relation + per-category consent.
- **SEC-004 price manipulation**: server derives price/currency from the package row at checkout; client totals never used (aside from F-002 webhook amount check gap).
- **SEC-005 quantity validation**: global `validateInput` + per-route integer/range checks; commerce uses integer cents with bounds.
- **SEC-007 coupons/referrals**: **NOT APPLICABLE** — no coupon/referral code exists anywhere in the schema or routes.
- **SEC-008 mass assignment**: register forces MEMBER; trainer/nutritionist applications use explicit pick-list field allowlists and force `verified:false`/`unverified`; OIDC provisioning disabled; legacy migration is operator-grant + password re-auth only.
- **SEC-009 auth/OTP/session**: scrypt+salt, 32-byte random tokens hashed at rest, atomic single-use actions, session revocation on reset/role-change/delete, atomic DB rate buckets, enumeration-resistant messages, PKCE OIDC behind a flag.
- **SEC-010 AI**: structured-output only; no tool/function execution; user content marked untrusted; deterministic engines handle numbers/safety; AI kill-switch + quotas + flag gates; post-generation safety suppression for restricted users.
- **SEC-011 XSS**: no `dangerouslySetInnerHTML`/innerHTML/eval in web/admin; auth-action page uses `textContent` + fragment tokens only.
- **SEC-012 uploads**: magic-byte checks (PDF, video ftyp/EBML, JPEG/PNG/WebP), size caps, generated keys, private storage, signed user-bound URLs, optional AV scanner hook, consent-required video capture.
- **SEC-014 SQL injection**: all `$queryRaw`/`$executeRaw` uses are parameterized tagged templates; no `*Unsafe` variants; dynamic sort fields not user-derived.
- **SEC-017 feature flags**: server-authoritative registry; fail-closed unknown keys; env/dependency/allowlist precedence; AI kill-switch; flags enforced in middleware, not just UI.
- **SEC-018 test fixtures**: safetyFixtures throws at require-time in production, requires env opt-in + synthetic-domain membership per request; AUTH_TEST_BYPASS limited to NODE_ENV=test.
- **SEC-021 SSRF**: no user-controlled URL fetching found; OIDC token_uri is env-configured.
- **SEC-022 CORS/CSRF/headers**: helmet + origin allowlist; web BFF has SameSite=Lax + Origin check + custom-header requirement on mutations.
- **SEC-024 races**: advisory/row locks, unique idempotency anchors, atomic consume updates, serialized transactions throughout commerce/auth/roles.
- **SEC-026 audit logging**: privileged actions logged with allowlisted metadata snapshots.
