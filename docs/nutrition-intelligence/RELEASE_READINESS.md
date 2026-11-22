
## 2026-11-21 update — flags + integration status

- 5 medical flags registered OFF/fail-closed; governance contract test green (11 tests). Zero consumers wired — activation requires the full eligibility chain in `FEATURE_FLAG_GOVERNANCE.md`.
- Integration honesty matrix: `NUTRITION_ENGINE_INTEGRATION_STATUS.md` — 11 capability functions exist + pass pure tests; **none are wired into production call paths yet**; `dailyScore`/`decisionEngine`/`healthScoreEngine` are the only wired engines.
- Full suite: **119 suites / 1,458 tests / 0 failures** (incl. merged activity-safety work); 52 todo = blocked scenario fixtures.
- Release gates unchanged: no clinical activation without named-reviewer approval; see `RELEASE_GATE_STATUS.md`.

# RELEASE_READINESS — canary/rollback gate check

**As of:** 2026-11-21

## Currently live behavior

| Surface | Flag | State |
|---|---|---|
| `/health-score` (v1) | none — live to all users | corrected defects; regressions covered (25 tests) |
| `/daily-progress/score-v2` | `health_score_v2` | OFF by default; 403 verified. Route functional when enabled |
| `/food-intel` barcode/suitability | `food_intel` | gated, unchanged |
| condition-rule consumers | n/a | APPROVED-only (fail-closed) |
| `calorieSafety.js` | n/a — not wired | inert module |
| calorieFloor in v2 | n/a — passed `null` | safety-suspend path unreachable until G4 approved |

## Rollback plan

- **v2 disable:** set `health_score_v2` flag off → route 403s; no data written. Mobile unaffected (no v2 consumer).
- **v1 engine revert:** defects fixed are pure code changes in `healthScoreEngine.js` — `git revert` restores old behavior; no schema/migration dependence this session.
- **Rule gating:** reverting the 5 query filters would re-expose DRAFT rules to consumers — do **not** revert; treat as permanent safety posture.
- **Junk cleanup:** deletions are one-way; `junk-data-report.json` + git history hold the record. Seed file scrub prevents re-creation.
- **DB:** no new migrations this session; the 10 applied migrations are additive.

## Gates NOT yet met for v2 rollout

1. 120-scenario executable coverage: 12/120 (see SCENARIO_VALIDATION_MATRIX) — gate: ≥ all P0.
2. Calorie floor: G4 policy unapproved → `calorieFloor` null → severe underconsumption can't suspend the score.
3. Consumer contract education: composite=0 vs no_data distinction must be respected by any future mobile consumer.
4. Canary cohort mechanics exist (`featureFlagOverride` per-user) but untested end-to-end for score-v2.
5. Privacy/performance validation from the original objective not yet exercised.

## Recommendation

Keep v2 flag OFF. v1 is the production score. Next releasable increment is the 120-scenario fixture program + G4 clinical sign-off.

## 2026-11-21 addendum

- `dps-v2.1` is the current score version (HF-0020 resolved); snapshots carry version for rollback reproducibility. `health_score_v2` remains OFF.
- New `safety_warning` outcome in decisionEngine is flag-gated code; no consumer displays it yet — activation requires `allergen_warnings` flag + wording review.
- Full suite: 1,218 passing; only failure during transition was the pre-fix A06 fixture (now green). photoScan/exerciseLibrary intermittent shared-DB flakes documented in TEST_ISOLATION_REPORT.
