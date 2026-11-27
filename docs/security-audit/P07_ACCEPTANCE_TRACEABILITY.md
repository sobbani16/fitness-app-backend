# SEC-P07 Acceptance Traceability Matrix (2026-11-27)

Every P07 requirement phrase mapped to implementation and pinning test.
Distinguishes code-complete (test-pinned) from human-gated items.

| # | Requirement phrase | Implementation | Pinning test | Status |
|---|---|---|---|---|
| a | No predictable prod secrets / no dev fallbacks in production | `src/lib/env.js` `requiredSecret` — production throw, predictable-value rejection incl. master-derived path | `tests/securityHardening.test.js` "throws in production when neither secret is set", "rejects a predictable secret explicitly set in production", "falls back to the dev value outside production"; `tests/envValidation.test.js` "production predictable values are rejected by name not value" | **code-complete** |
| b | Explicit env classification | `SECRET_RULES` with per-rule `enabled()` scoping (required / capability-scoped / derivable); readiness rows carry feature + action classification | `tests/configReadiness.test.js` (7 tests — row shape, classification, action copy); `tests/envValidation.test.js` capability-warning tests | **code-complete** |
| c | Contradictory config fails safe | `validateCors` — wildcard-in-production invalid, malformed rejected, empty = documented safe default (no browser cross-origin, native unaffected) | `tests/envValidation.test.js` CORS describe block (4 tests) | **code-complete** |
| d | Test-only overrides impossible in production | Boot guard `src/index.js` — throws if AUTH_TEST_BYPASS configured in production; middleware double-gate `NODE_ENV==='test' && bypass && !isProduction()` — Railway-aware veto added this increment (previously raw NODE_ENV only: a production deploy misconfigured with NODE_ENV=test could have activated the bypass) | `tests/bootChain.test.js` — child-process boot refusal; middleware inertness under RAILWAY_ENVIRONMENT_NAME=production even with NODE_ENV=test; pure-test regression control; requireVerifiedEmail prisma-consultation proof | **code-complete** |
| e | Disabled commerce doesn't break fitness | capability secrets never in `missing` — `SECRET_RULES` enabled() false for inactive features surfaces warnings only | `tests/envValidation.test.js` "disabled-capability secrets surface as warnings, never block startup"; readiness optional-absent rows exit-0 in non-production | **code-complete** |
| f | Crypto domain separation | `requiredSecret` HMAC-SHA256(master, "humai:<purpose>") — per-purpose independent keys | `tests/securityHardening.test.js` "derives per-purpose key from a master secret" — derived ≠ master, purpose-bound (VIEW_AS ≠ DOC_URL), deterministic; forged-token rejection test | **code-complete** |
| g | Errors name variables, never values | validation output carries names only; malformed input never echoed | `tests/envValidation.test.js` ("never the value" assertion), CORS malformed-no-echo test; `tests/configReadiness.test.js` no-echo proof incl. deliberately malformed values | **code-complete** |
| h | Startup validation before serving traffic | `src/index.js` boot chain — validateConfig + throw before prisma connect / app.listen; production deployment readiness assertion after connect | `tests/bootChain.test.js` — child-process spawn: missing-required exits 1 naming variables, "Backend listening" never printed; positive control: valid config passes the gate (failure moves downstream to prisma) | **code-complete** |
| i | Readiness command output contract | `scripts/config-readiness.js` — name/present/valid/feature/action only | `tests/configReadiness.test.js` (7 tests incl. serialized-output no-echo proof) | **code-complete** |

## Human-gated items (organizational, not code)

| Item | Exact ask | Status |
|---|---|---|
| Rotation execution | Authorization to execute rotation runbook for secrets historically exposed pre-remediation | needs-human |
| Full git-history deep scan | Approval for exhaustive history scan beyond tracked-file reconciliation | needs-human |
| MFA verification on owner accounts | Organizational verification, outside code scope | needs-human |
| Live provider sandbox credentials | FORM_CHECK consumer wiring verification when feature lands | conditional/needs-human |

## This increment's security-relevant change

The middleware bypass gate previously keyed on raw `NODE_ENV === 'test'`. A production
deployment misconfigured with `NODE_ENV=test` would have activated `AUTH_TEST_BYPASS` —
a real (if narrow) hole, since Railway sets `RAILWAY_ENVIRONMENT_NAME=production`
independently. Both `authenticate.js` and `requireVerifiedEmail.js` now additionally
require `!isProduction()` (Railway-aware). Verified: bypass fully functional in pure
test environments (93/93 middleware-consumer smoke green), inert under production
Railway env regardless of NODE_ENV.
