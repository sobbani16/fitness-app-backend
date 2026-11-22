# Phase 19 Progress

- **Backend**: `feat/activity-safety-engine`, entry `fb5b147` → latest in log
- **Mobile**: `main` `32c3e2e` (unchanged this phase — no mobile work needed)
- **Regression**: backend 135/135 suites, 5,509 tests, 0 failures · safety 4,141 · mobile 74/74, 426 tests, tsc clean, eslint 0 errors

## Workstreams

| # | Status | Evidence |
|---|---|---|
| A taxonomy | ✅ DONE | `activity-safety-taxonomy-remediation.md` — 10 strength gaps patched w/ provenance (patch json + importer hook), 0 remaining; guard scoped to strength; upstream nulls confirmed identical (no restorable data); 8 neck exercises remain review-required |
| B staging | ✅ **DEPLOYED** | Railway project `fitness-app-backend`, env `staging` (duplicated from production): isolated Postgres (`postgres.railway.internal`, fresh DB — zero customer data), backend at https://fitness-app-backend-staging.up.railway.app, `/health/ready`→ready, all 71 rules seeded DRAFT via public URL, all migrations applied. `AUTH_PUBLIC_URL` corrected to staging domain. **Caveat**: deploys `main` — safety-engine code lives on this feature branch (unmerged/unpushed); safety-route E2E on staging requires the branch to be deployed (human decision). Auth enforced (401s) |
| C reviewer ops | ✅ | `activity-safety-reviewer-operations.md` — export command, decision workflow, SoD enforcement, version pinning, open items |
| D monitoring | ✅ | `safety.exercise.review` event added; alert contract complete for all listed categories |
| E regression | ✅ | numbers above |

## Human-owned blockers (unchanged)

- Clinical review of 71 DRAFT rules (ops docs ready)
- Deploy `feat/activity-safety-engine` to staging for safety-route E2E (or merge decision)
- Regulatory counsel; CPCB `DATA_GOV_IN_API_KEY`
