# Fiber Intelligence — Release Engineering (pc-HUM-24)

Consolidates the five release-eng concerns against what actually exists in-repo.
Scope docs it builds on (do not duplicate): `INTERNAL_ROLLOUT.md` (stages, flag
mechanics, rollback), `RELEASE_READINESS.md` (feature inventory), `PHASE6_PILOT_READINESS.md`,
`SUPPLEMENT_SAFETY_REVIEW.md` (clinical gate on `fiber_supplement_suggestions_enabled`).

## 1. CI

| Check | Where | Evidence |
|---|---|---|
| Fiber unit/integration tests | `tests/fiber.*.test.js` — 7 suites, run by the backend `test.yml` jest step (`npx jest --runInBand`) | **Verified green on `origin/main` base:** 7 suites / 135 tests, ~2 s |
| API contract includes `/fiber/*` | `contracts/api-contract.json` (pc-HUM-63) + `contract:check` gate in `test.yml` | `/fiber/target`, `/daily`, `/trend`, `/sequence`, `/suggestions`, `/supplement-check*` emitted; `npm run contract:check` → in sync |
| Mobile E2E flows | `maestro/fiber-stage{1..4}-verify.yaml`, `fiber-p6-android.yaml` — run via `.github/workflows/android-e2e.yml` (dispatch + nightly) | **Configured, unproven** — first CI run still pending secrets (`E2E_STAGING_*`); see `automation/E2E_TOOL_DECISION.md` in mobile |
| Mobile unit lane | `mobile-ci.yml` jest step covers `fiber.ts` client + components | Pre-existing |

Gap: fiber Maestro flows are not in the workflow's default `flows` input — add
`fiber-stage1-verify` (or a p6 flow) to the critical set once the first run proves the lane.

## 2. Migrations

- Single migration `20261224000000_fiber_intelligence`, already on `main`.
- **Additive-only (verified):** the only match for destructive keywords is the
  `updatedAt` column name — no `DROP`/`DELETE`/`TRUNCATE`/`UPDATE` statements.
  New tables `FiberDailyRecommendation`, `FiberSupplementCheck`; added columns
  `MacroGoal.fiberTargetBasis/fiberTargetNote`, `RecipeIngredient.fiberG`.
- `deploy:check`'s migration manifest covers every directory under
  `prisma/migrations/` automatically — no wiring needed. `deploy-prepare` runs
  `prisma migrate deploy` pre-deploy.
- Rollback: schema never needs reverting (additive); code revert is safe with
  tables in place (`INTERNAL_ROLLOUT.md` §Rollback item 4).

## 3. Monitoring

Existing signals — **no dedicated fiber alerts/dashboards exist; treat as a gap**:

- `requestContext` middleware logs `api_failure` JSON warn for every `/fiber/*`
  4xx/5xx with route, status, code, correlationId (grep `event:"api_failure"`).
- Stage-exit criteria in `INTERNAL_ROLLOUT.md` require "zero 5xx on `/fiber/*`"
  over ≥3 days — today this means log review, not a metric.
- Product telemetry: `FiberDailyRecommendation`/`FiberSupplementCheck` audit
  rows give per-user traceability; PostHog flag evaluation is the usage signal.
- Recommended minimal monitoring before Stage 2+: daily check that
  `/fiber/*` requests show `x-api-contract` + no `api_failure` 5xx entries;
  one `fiber` reminder-plan tick log review per cohort week.

## 4. Rollback

Fully specified in `INTERNAL_ROLLOUT.md` §Rollback — layered: PostHog flag-off
(instant, per-user) → `ai_emergency_shutdown` (AI/voice paths) →
`FF_FIBER_INTELLIGENCE_ENABLED=false` (instance-wide) → code revert `ee50f62`
(backend) + `ff742c0` (mobile), no schema rollback needed → post-checks
(`/fiber/*`→403, dashboard clean, no fiber reminders planned).
**Outstanding:** the "flag-off drill executed once" stage-exit criterion is a
cohort action, not yet evidenced — run it during the first internal stage.

## 5. PR / branch coordination

| Repo | Branch | Unmerged vs `origin/main` | Disposition |
|---|---|---|---|
| backend | `feat/fiber-stage34` | 0 | Merged — branch deletable |
| backend | `humai/dev-01/hum-19-fiber-backend` | 0 | Merged — branch deletable |
| backend | `humai/dev-03-pc-HUM-3-fiber-validation` | **8** | Validation evidence: deterministic suite, catalog audit, consolidated matrix, plus one stray pc-HUM-4 commit — **propose merge PR** (docs+tests only, additive) |
| mobile | `chore/fiber-p6-android-flow` | **1** | Android p6 Maestro flow — **propose merge PR** |
| mobile | `humai/dev-03-pc-HUM-3-fiber-validation` | **7** | Validation docs/flows — **propose merge PR** |

Merge order suggestion: backend validation first (it retains the deterministic
test suite + evidence manifest the pilot sign-off will cite), then the mobile
validation + p6 flow branches so the flow exists where `android-e2e.yml` runs.

## Verdict

Release mechanics are **wired and safe**: flag-gated routes, additive migration,
layered rollback, contract gate, green fiber CI lane. Remaining blockers are
operational, not code: first `android-e2e.yml` run (secrets), PostHog targeting
for the internal cohort (credentials), the flag-off drill (device), clinical
sign-off for supplement suggestions (already gated OFF), and three small merge
PRs for validation branches.
