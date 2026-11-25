# Platform Infrastructure Status — pc-HUM-97 (2026-11-25)

Consolidated audit of cross-cutting platform infrastructure for the
health-outcomes (LEO) workstream: observability, feature flags, offline queue,
and build/deploy validation. Verified against repo state on `origin/main`
(`3650bbb`); credential-dependent items marked explicitly. Companion records:
`docs/deployment/SAFETY_DEVOPS_STATUS.md` (pc-HUM-45, staging/safety lane),
`docs/fiber-intelligence/RELEASE_ENGINEERING.md` (pc-HUM-24, fiber rollout),
`automation/reports/CI_RELIABILITY_AUDIT_2026-11-25.md` (pc-HUM-38, flake data).

## 1. Observability

| Item | Status | Evidence |
|---|---|---|
| Correlation ID end-to-end | **verified** | `src/middleware/requestContext.js` — validates incoming `x-correlation-id` (`^[A-Za-z0-9._-]{8,64}$`), else mints `randomUUID`; every ≥400 error body gets `code` + `correlationId` injected via `res.json` wrap |
| Server failure signal | **verified** | `api_failure` JSON warn per 4xx/5xx on `res.finish` — route label, status, `failureCategory`, error code, correlationId, `durationMs`, sanitized `x-client-build` |
| Mobile failure classification | **verified** | `src/services/apiDiagnostics.ts` — 12 `FailureCategory` values, correlationId capture, path-template scrubbing (ID segments → `:id`), 50-entry ring buffer + change listeners; `mealSync` consumes `classifyFailure`/`isTransient` |
| Contract negotiation telemetry | **verified** | `x-api-contract`/`x-min-client-contract` headers on every response; `x-client-contract` below min → `426 CLIENT_UPGRADE_REQUIRED`; mobile `ApiFailure.serverContract` records served version |
| PostHog analytics (mobile) | **absent by design** | no `posthog-*` package in `package.json`; PostHog is used server-side only (flag provider, below) — no mobile event pipeline exists |
| Dashboards / alerts | **missing** | no Grafana/Datadog/Sentry wiring; `api_failure` stdout JSON is the only emitted signal — Railway log search is the de facto UI |

Gap: production failure-rate alerting. Minimum viable = Railway log alert on
`"event":"api_failure"` rate + `/health/ready` uptime probe; `prod-smoke.js`
provides the probe once `PROD_SMOKE_TOKEN` exists (OPS-001).

## 2. Feature flags

| Item | Status | Evidence |
|---|---|---|
| Registry | **verified** | `src/config/featureRegistry.js` — 116 flags, single source of truth (keys, defaults, `dependsOn`) |
| Provider abstraction | **verified** | `src/services/featureFlags/provider.js` — `posthog` (remote `/decide`, `posthog-node`, geoip off) / `env` (registry defaults + `FF_*` overrides; **automatic when `POSTHOG_API_KEY` unset** — documented rollback) / `off` |
| Enforcement (backend) | **verified** | `src/middleware/requireFeature.js` + `src/routes/config.js` serving flag map to clients |
| Enforcement (mobile) | **verified** | `FeatureFlagsContext` — 60s poll, `Retry-After` honored (≤5min), exponential backoff, 10s attempt floor, session-epoch staleness drop, cached config in `storage/featureConfig`; `gateScreen(key, …)` in `RootNavigator` |
| Flag count consistency | **needs periodic check** | mobile `config/featureKeys.ts` `FeatureKey` union vs backend registry — drift surfaces only as disabled features, not errors. Contract manifest covers endpoints, not flag keys (candidate contract-test extension) |
| Kill-switch posture | **verified** | all rollout flags default-off in registry; `FEATURE_FLAGS_PROVIDER=env`/`off` is the instant-rollback path (no PostHog dependency) |

## 3. Offline queue infra

| Item | Status | Evidence |
|---|---|---|
| Mutation queue | **verified** | `src/services/mealSync.ts` — AsyncStorage-persisted per-account ops, serial `locked()` chain (no concurrent flushes), `assertAccount` guard (cross-account writes paused) |
| Failure semantics | **verified** | item-level (400/409/422) → per-op `failure` record, waits for user correction; service-level (401/403/404/5xx/network) → whole-flush pause; edit replaces pending op and clears failure |
| Coverage | **partial** | meals/food-logs only — `queueAt`/`flushAt` are generic over op shape but only instantiated for `/food-logs` POST/DELETE. Workout logs, check-ins, dose marks are direct-call (no offline persistence) |
| Tests | **verified** | `src/services/__tests__/mealSync.test.ts` + `apiDiagnostics.test.ts` — queue ordering, failure categories, account-guard |

Gap: generalizing the queue is a product decision (which mutations are
safe to replay — check-ins and dose-marks have server-side dedupe keys and
are the natural next candidates; check-in payloads are already idempotent).

## 4. Build / deploy validation

| Layer | Status | Evidence |
|---|---|---|
| Deploy gate | **verified + hardened** | `scripts/check-deployment.js` (`deploy:check`) — env-secret validation first (pc-HUM-77: prod hard-fails on missing/predictable secrets, `authLifecycle.validateConfig()`), then `assertDeploymentReady` (migration manifest + RBAC catalog) |
| Staging preflight | **exists + parses** | `scripts/staging-preflight.js` — secrets, flag defaults, migrate status, rule inventory, external reachability probes |
| Contract gate | **verified** | `scripts/emit-api-contract.js` → 570-endpoint manifest; `contract:check` in `test.yml`; mobile-side literal-scan test (pc-HUM-63) |
| Release invariants (mobile) | **verified** | `verify-release.cjs` — bundleId/package, EAS projectId, remote `appVersionSource`, store-distribution profile gates; pose-model sha256 provenance in both E2E lanes (pc-HUM-70) |
| CI unit lanes | **verified stable** | mobile 93 suites/673 tests ×5 clean; backend FLK-class suites ×5 isolated (pc-HUM-38) |
| E2E lanes | **configured, unproven** | `android-e2e.yml` (nightly+dispatch), `ios-e2e.yml` (dispatch, sim-build) — **zero runs**; blocked on `E2E_STAGING_*`/`EXPO_TOKEN`/`EAS_APK_URL` secrets |
| Prod smoke | **scripted, blocked** | `automation/api/prod-smoke.js` GET-only probe — needs `PROD_SMOKE_TOKEN` (OPS-001) |

## Verdict

All four pillars have real, tested infrastructure — the platform is not
missing scaffolding. Residual gaps are (a) **credentials-only**: E2E secrets,
`PROD_SMOKE_TOKEN`, staging DB access; (b) **two honest engineering gaps**:
no production failure alerting beyond stdout JSON, and offline queue coverage
limited to food logs; (c) **one drift class unguarded**: mobile `FeatureKey`
union vs backend registry has no automated consistency check.

## Next actions (require credentials or product decisions)

1. Add `E2E_STAGING_*`, `EXPO_TOKEN`, `EAS_APK_URL`, `PROD_SMOKE_TOKEN` repo
   secrets, then run each E2E lane once (dispatch).
2. Provision a Railway log alert on `api_failure` rate + uptime probe on
   `/health/ready` (or wire `prod-smoke.js` into a scheduled workflow).
3. Decide whether check-ins / dose-marks / workout logs get offline-queue
   persistence (server already dedupes; client-side replay semantics are the
   open design question).
4. Optional: extend the contract manifest with `FEATURES` key list and assert
   mobile `FeatureKey` union ⊆ registry keys in `apiContract` tests.
