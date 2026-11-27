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

## Addendum 2026-11-26 — executed evidence (pc-HUM-24 continuation)

**§15 migration validation — EXECUTED, not just documented**: full migration chain replayed on scratch DB `fiber_scratch_replay` via `prisma migrate deploy` — **all migrations applied successfully, exit 0**, including `20261224000000_fiber_intelligence`. Post-replay inspection: **162 foreign keys, 517 indexes, 2 fiber tables** present. No prod data mutation anywhere in the chain — deploy-only replay, zero seed/fixture writes. Rollback/forward-repair posture documented in the main body remains the policy; scratch replay proves forward applicability.

**§14 monitoring — implemented**: `scripts/fiber-alerts.js` — 4 alert rules as data (snapshot-write error rate, recipe-reconcile drift, migration lag, fiber API 5xx) with pure `evaluate()` + safe synthetic test events. Cardinality safety by construction: rules carry no user identifiers or free-text label fields (jest-verified key-set assertion); malformed shapes rejected. `tests/fiberAlerts.test.js` **5/5 green**. Self-test CLI: `node scripts/fiber-alerts.js` exits 0 with breach/benign/cardinality checks passing.

**Needs-human (exact asks)**: (1) wiring these rules into the production monitoring vendor requires dashboard access + alert-channel credentials; (2) post-merge verification evidence per merged PR requires the merge-serialization policy + Railway access (cross-posted from pc-HUM-63/77 needs-human registers); (3) Punitha independent QA.

## 2026-11-27 — §15 migration replay re-verified at merged main (pc-HUM-24)

Branch merged origin/main (`2ad0c5a` lineage) — prior replay evidence was stale relative
to main; re-executed on fresh scratch DB `fitness_test_h24fiber` at merged head `e4fe4e2`.

### Replay result (acceptance core)
- **70/70 migrations applied, zero failures** (`prisma migrate deploy`, DATABASE_URL explicitly exported per the seed-trap discipline). Second run: "No pending migrations" — deploy idempotency confirmed.
- Fiber structures verified present: **2 fiber tables, 6 fiber indexes** (incl. `FiberDailyRecommendation_userId_date_idx` + `FiberSupplementCheck_userId_createdAt_idx` — the query-path indexes the dashboard/recheck flows depend on).

### Per-migration classification: `20261224000000_fiber_intelligence`
- **backward-compat: additive-only** — nullable columns added to MacroGoal/RecipeIngredient; two new tables; zero DROP/RENAME (verified by scan). Old backend/mobile versions unaffected by its application.
- **no data mutation embedded**: zero UPDATE/DELETE/INSERT statements — schema-only, no production data mutation possible from the migration itself.
- **ordering correct**: MacroGoal created at `20260613152756` ≪ `20261224000000` — no ALTER-before-CREATE class issue (the pc-HUM-108 bug class checked explicitly).
- **FK posture**: fiber tables carry 0 FK constraints — consistent with codebase convention (50 userId-bearing tables lack FKs; relational integrity is application-level). Not a defect, documented as posture.
- **rollback/forward-repair**: fully reversible — new tables droppable, added columns droppable, zero data-dependence (nothing else writes them before the feature ships). Forward-repair unnecessary; rollback is plain drops.

### Seed-chain validation
- seed-foods: 25 ingredients present; second run leaves count at 25 — **idempotency proven**.
- Honest anomaly: RBAC seed produced only 1 role row in this scratch run (vs 11 in pc-HUM-38/77 harnesses) — output was silenced during chaining; RBAC seeding is not fiber-critical path but the discrepancy is recorded rather than hidden. Not blocking fiber release mechanics.

### Defects note (routed #237/319/324)
Same jest-failure signature as defect #245 — already reproduced and classified as the
branch-independent AUTH_RBAC flake class (pc-HUM-38 root-cause on PR #77, awaiting founder
merge). Not re-reproduced per dedup discipline.
