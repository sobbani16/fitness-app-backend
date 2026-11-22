# Phase 23 — Staging Validation

Staging service: `activity-safety-staging` (Railway, dedicated env + isolated Postgres).
Deployed commit verified via deployment metadata: **`9259ea4`** (branch head
after merging 6 concurrent CI commits; runtime identical to `4650908`,
which carried the PATCH fixes — deployment `5b6ba751`, `commitHash` confirmed).
Prior deploy attempt `0df238b7` CRASHED: committed `fiber/sequencing.js` required
untracked `src/services/ingredientImpact.js` — file committed as `4650908`, redeploy
succeeded. A committed-requires audit confirmed no other missing modules.

## Deployment verification

| Check | Result |
|---|---|
| Health | PASS — `{"status":"ok"}` |
| Deployed SHA | PASS — `9259ea4` via Railway `commitHash` (PATCH tests ran on `4650908`, identical runtime) |
| Migration status | PASS — deploy log: "68 migrations and 11 required roles verified" |
| DB isolation | PASS — 0 non-synthetic users in staging Postgres |
| Auth | PASS — unauthenticated `/activity-safety/profile` → 401 |
| Clinical rules | PASS — 71/71 `DRAFT`, 0 approved (DB query) |
| Flags staging-scoped | PASS — `FF_*` env vars set on staging service only; production untouched |
| Safety behavior unchanged | PASS — suite 14/14, 4,163 tests; verdict contract identical |

## Injury PATCH — live HTTP verification (deployed code @ `4650908`)

Account A: `p20-nwb-ankle-…@staging.test`; Account B: `p20-shoulder-…@staging.test`.

| Case | Expected | Actual |
|---|---|---|
| Unauthenticated PATCH | 401 | PASS — 401 |
| Cross-user PATCH (B → A's injury) | denied | PASS — 404 `not_found` (no existence leak) |
| Unknown fields `diagnosis`,`bogusField` | 400 | PASS — `unsupported_fields` listing both + editable set |
| Invalid `status:"banana"` | 400 | PASS — `invalid_field` with allowed enum |
| `clinician_documented` injury: self-edit `weightBearingRestriction`,`prohibitedCategories` | 409 | PASS — `clinician_fields_locked` naming both fields |
| Same clinician injury: editable `painLevel` | allowed | PASS — `updated:true` |
| `status:"resolved"` | persisted | PASS — DB: `status=resolved`, `resolvedAt` NOT NULL |
| Safety-relevant update invalidates advice | staleAt | PASS — prior `Recommendation` row: `staleAt` set, `staleReason=injury_updated` (DB-verified) |

## Regression state

- Backend full suite: 148/150 suites passed; **2 suite-level failures are
  cross-suite pollution from uncommitted `tests/setup.js` pool-limiting WIP**
  (`connection_limit=2&pool_timeout=20` — flag checks time out under 152-suite
  load → `403`/`404` instead of expected `401`/`200`). Both suites
  (`authSweep`, `trainerNutrition`) pass in isolation: 124/124. Not a
  Phase 22/23 regression — the dirty-tree test-infra change is the user's
  documented in-progress flake fix (AUTH_RBAC_FLAKE_INVESTIGATION.md).
- Safety suites: 14/14, 4,163 tests — green.
- Mobile: 82/82 suites, 521 tests — green. tsc + eslint clean.
