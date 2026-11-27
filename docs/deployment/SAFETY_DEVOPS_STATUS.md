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

## Live verification addendum 2026-11-26T22:10Z (pc-HUM-45 continuation)

App-level staging verification executed (not just HTTP-200): `/health` → 200 in 285ms with body `{"status":"ok","time":"2026-11-26T22:10:11Z"}` — server clock correct, app responding with real timestamps (correct behavior, not just successful deploy). `/ready` → 401 and `/auth/me` → 401 — auth enforcement verified live: unauthenticated requests properly rejected on protected surfaces. Zero mutations performed; read-only probes only; production untouched. Staging commit-vs-main drift, migration-version inspection, and Railway dashboard inspection remain blocked on Railway access (needs-human — cannot inspect dashboard without credentials; CLI/API token absent). Rollback posture: documented in main body — redeploy known-good SHA without touching staging DB; 71 DRAFT clinical rules remain inactive (no flag changes made or attempted). §7 iOS build prep: BLOCKED — no Apple signing credentials or registered-device inventory access in this environment (exact ask in PR). §18 automation: cross-posted from pc-HUM-32 — workflows hardened, secrets-preflight present, zero scheduled executions claimed operational without verified runs.

## Live staging deploy executed 2026-11-27T03:40Z (pc-HUM-45 continuation, authorized under #127)

**Drift measured first**: staging served `1c45d1d` (Nov 22) — 147 commits behind main `df477ee` (ancestor, no divergence); latest prior deployment was a same-commit redeploy, not an update.

**Pre-deploy gates (all pass)**:
- candidate `df477eea2fcc` battery-tested (pc-HUM-38: 4/5 clean runs, 6,353 tests each)
- migration diff: exactly 2 additive migrations (`pose_coaching_sessions`, `health_outcomes_p0`), zero destructive DDL in the 147-commit window
- config compatibility simulated against staging's exact 54-var key-set: `validateConfig` returns `ok:true` — missing capability secrets (DOC_URL/VIDEO_TOKEN/VIEW_AS) degrade to warnings by design, missing PAYMENTS_WEBHOOK correct with commerce inactive, empty CORS is the documented safe default
- rollback prepared: prior commit `1c45d1d` redeployable from worktree; additive migrations need no reversal
- deploy mechanism confirmed: `prisma migrate deploy` runs in the boot chain (prior deploy logs); a failed migration crash-loops, so SUCCESS+stable-health is indirect migration evidence

**Deploy execution**: `railway up` from clean worktree at exact SHA → deployment `2f3b64ee-376f-4370-b456-8ff9815c34dc` SUCCESS 2026-11-26 22:40:40 -05:00, replaced `062cf6c3`.

**Post-deploy verification (app-level, not just HTTP-200)**:
- new process `startedAt 03:41:47Z` matches deploy timing — prior process replaced
- `/health` live with correct server clock; auth enforcement live (401 on protected surfaces)
- **honest limitation 1**: `/health/version` commit field EMPTY — `railway up` upload-deploys carry no git metadata (no RAILWAY_GIT_COMMIT_SHA). Commit-specific verification through the endpoint is impossible for upload deploys. Fix path: git-connected service or CI-injected GIT_COMMIT_SHA per deploy — aligns with the pc-HUM-70 mobile provenance chain.
- **honest limitation 2**: endpoint-existence discrimination impossible unauthenticated — the global auth middleware 401s everything including nonexistent routes.
- **honest limitation 3**: direct migration-state query impossible externally — staging DATABASE_URL uses internal hostname `postgres.railway.internal`; deploy logs rotate out of the CLI buffer. Indirect evidence stands: deployment stable 5+ minutes with the migrate step in the boot chain.
- production service: zero contact — all probes targeted the staging service only.

**Environment observation**: staging reports `environment: "production"` in /health/version (NODE_ENV=production on the staging service). Consequence: production fail-closed secret behavior active on staging — arguably correct for fidelity, but telemetry/environment tagging cannot distinguish staging. Config decision for the owner, not changed unilaterally.

**Rollback state**: prior deployment REMOVED by Railway lifecycle; rollback = redeploy `1c45d1d` from a worktree (documented in runbook). Additive migrations need no reversal — old code tolerates newer additive schema.
