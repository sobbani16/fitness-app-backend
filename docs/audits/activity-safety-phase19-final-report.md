# Phase 19 Final Report — Staging, Taxonomy, Reviewer Ops

**Repos**: backend `feat/activity-safety-engine` (entry `fb5b147`) · mobile `main` `32c3e2e`

## Workstream results

| WS | Outcome |
|---|---|
| **A — Exercise taxonomy** | Audited all 164 review-flagged. Confirmed upstream `free-exercise-db` genuinely lacks the fields (importer faithful; upstream HEAD identical). Found the real risk set: **10 strength rows** whose null `mechanic`/`equipment` silently skipped weight-bearing/Valsalva derivation. Remediated via `data/exercise-metadata-patch.json` — provenance-tracked (`basis`+`confidence` per entry, inferred from source-internal conventions; upstream-pristine). Also corrected Phase-18's over-broad guard to `strength`-scoped. **0 strength gaps remain.** 8 neck-isolation exercises remain review-required by design. |
| **B — Staging** | **DEPLOYED.** Railway `fitness-app-backend` project, `staging` env duplicated from production: separate Postgres instance (fresh DB — zero customer data), backend live at `https://fitness-app-backend-staging.up.railway.app` (`/health/ready`→`ready`). All migrations applied; 71 rules seeded — all DRAFT. `AUTH_PUBLIC_URL` repointed; all endpoints correctly 401. **Known caveat**: the Railway service builds `main`; the safety engine is on `feat/activity-safety-engine` — staging validates the deploy pipeline + isolated DB, but safety-route E2E needs that branch deployed (merge/push is a human decision). |
| **C — Reviewer operations** | `activity-safety-reviewer-operations.md` — export command, decision classes, version-hash pinning, SoD enforcement, open items for reviewers (incl. the 10 patch inferences reviewers may veto). |
| **D — Monitoring** | Added `safety.exercise.review` event; alert contract now covers every required category (untyped-notification bypass, gate errors, env outage, suppression spike, invalidation miss, metadata coverage). |
| **E — Regression** | Backend **135/135 suites, 5,509 tests, 0 failures** · safety suites 4,141 · mobile **74/74, 426 tests**, tsc clean, eslint 0 errors (60 pre-existing warnings). |

## Staging facts (deployment evidence)

- Env ID `855025fd-ece0-4031-b27e-1fb106aad7ff`; services: `fitness-app-backend` + `Postgres` — both online.
- `DATABASE_URL`→`postgres.railway.internal` (env-scoped) — no prod data reachable.
- `RAILWAY_PUBLIC_DOMAIN=fitness-app-backend-staging.up.railway.app`; `AUTH_PUBLIC_URL` fixed to match.
- Rules: `seeded: 71 created, 0 updated (all DRAFT)` via `DATABASE_PUBLIC_URL` + `--apply`.
- Rollback: `railway environment delete staging` removes the whole env; or `railway down` per service. No shared state.

## Matrix

| Area | Verdict |
|---|---|
| Taxonomy remediation | **PASS** — evidence-backed, provenance-recorded, tested |
| Staging deployment | **PASS (pipeline)** — deployed + healthy + isolated; safety-route E2E pending branch deploy |
| Reviewer operations | **PASS** — usable now; SoD enforced; no customer data in exports |
| Monitoring | **PASS** — all required event categories + alerts defined |
| Regression | **PASS** — green both repos |
| Clinical approvals | **BLOCKED** — 0/71; qualified humans required |
| Regulatory | **BLOCKED** — counsel; claims inventory + suppression list ready |
| Production readiness | **NOT READY** — clinical + regulatory + staging-safety-E2E gates open |

## Commits this phase

- `data/exercise-metadata-patch.json` + `import-exercises.js` overlay + `gate.js` scoping + regression tests
- `observe.js`/`gate.js` `safety.exercise.review` event
- `activity-safety-reviewer-operations.md`, `activity-safety-taxonomy-remediation.md`, progress + this report

## Next human actions

1. Decide whether `feat/activity-safety-engine` should deploy to staging (merge or point the service's source branch) — then run safety-route E2E against `https://fitness-app-backend-staging.up.railway.app` with a real-email synthetic account (Resend is configured; `AUTH_TEST_BYPASS` is correctly inert outside `NODE_ENV=test`).
2. Route the reviewer package to qualified clinicians (29 physician-tier rules first).
3. Regulatory counsel for the claims inventory.
