# Safety DevOps Status — pc-HUM-45 (2026-11-25)

Audit of staging sync / Actions / EAS / rollback / monitoring for the
activity-safety workstream. Verified against repo state; creds-dependent items
marked explicitly. Primary runbook: `docs/deployment/activity-safety-staging-runbook.md`.

## 1. Staging sync

| Item | Status | Evidence |
|---|---|---|
| Staging backend exists | **configured** | `activity-safety-staging-staging.up.railway.app` — referenced by `eas.json` staging profile + both E2E workflows |
| Preflight gate | **exists + parses** | `scripts/staging-preflight.js` — verifies DATABASE_URL/secrets, all 4 safety flags default-off, `migrate status`, 71-rule inventory, Open-Meteo/NWS reachability, Delhi gov-CA probe |
| Flag keys registered | **verified** | `activity_safety_engine`, `weather_intelligence_v2`, `health_aware_recommendations`, `activity_safety_shadow_mode` — `src/config/featureRegistry.js:312-327` |
| Migration order | **verified additive** | `20261221000000_activity_safety_v1` → `20261222000000_activity_safety_input_status`; runbook notes the recorded-but-not-run drift class preflight catches |
| Schema parity staging↔prod | **NOT VERIFIABLE locally** — needs staging DB access (migrate status on staging) |

## 2. GitHub Actions

| Workflow | Status |
|---|---|
| `test.yml` (backend) | jest + postgres service + migrate deploy + RBAC seed + contract gate — green pattern; nightly cron |
| `security.yml` | gitleaks + npm-audit gate + fail-closed config guards |
| `mobile-ci.yml` | unit lane green locally (93/673 ×5 — pc-HUM-38 audit) |
| `android-e2e.yml` | configured; **zero runs** — secrets (`E2E_STAGING_*`) unconfirmed |
| `ios-e2e.yml` | new (pc-HUM-32 branch) — configured, unproven |
| `testflight.yml` | dispatch-only behind `EXPO_TOKEN` |

## 3. EAS

- `staging` profile exists (`eas.json`): Android APK pre-pointed at staging backend — usable as the `android-e2e.yml` `build_source=eas` alternative to `EAS_APK_URL`.
- No `ios.simulator:true` profile anywhere → iOS E2E is local/CI-xcodebuild only (`ios-e2e.yml` builds the sim binary itself).
- `testflight`/`testflight-internal` profiles exist with `autoIncrement` + remote version source (`verify-release.cjs` gates these invariants).

## 4. Rollback

- Documented in runbook §2: **flag-reversal is the rollback** (all 4 safety flags off-by-default; reversal loses no data — injury/restriction rows persist).
- Code rollback safe: migrations additive-only; `deploy:check` verifies manifest+RBAC before healthcheck.
- **Outstanding drill:** flag-reversal executed once on staging against a synthetic account — not yet evidenced.

## 5. Monitoring

- `requestContext` emits `api_failure` JSON warn per 4xx/5xx with route+code+correlationId — the only automated signal; **no dashboards/alerts exist**.
- `/health`, `/health/ready` endpoints for uptime probes; `automation/api/prod-smoke.js` ready but blocked on `PROD_SMOKE_TOKEN` (OPS-001).
- Runbook stage gates use log-review ("zero 5xx"), matching the safety-critical posture.

## Verdict

DevOps scaffolding is complete and internally consistent; the gaps are all
**credential/human**: staging DB access for schema-parity check, `E2E_STAGING_*`
secrets for first E2E runs, `PROD_SMOKE_TOKEN` for smoke, `EXPO_TOKEN` for
TestFlight, and one flag-reversal drill on staging.
