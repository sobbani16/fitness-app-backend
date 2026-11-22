# REMEDIATION_STATUS — safety, scoring & data-integrity phase

**Checkpoint:** 2026-11-21 · independently re-verified (DB probes + test runs), not taken from prior report.

## Prior-session claims — verification result

| Claim | Verified |
|---|---|
| Score-v2 route fixes (field names, foodQuality wiring, MacroGoal targets) | ✔ `tests/scoreV2.route.test.js` 8/8 |
| DRAFT ConditionRule enforcement across 5 consumers | ✔ `scripts/verify-rule-gating.js` ok:true, 0 unapproved visible |
| Junk cleanup + seed-foods scrub | ✔ DB re-probe: 0 `ms*` ingredients/allergies/conditions/recipes, 0 `dummy-*` fdcIds |
| PIPELINE.md + checkpoint docs | ✔ present |
| Migrations up to date / prisma validate | ✔ re-run this session |
| "255 tests / 19 suites" | superseded — full suite re-run this session: **106 suites / 1,160 tests / 0 failures** (3 skipped) |

## Workstream findings (VERIFIED_FIXED / OPEN / BLOCKED / REQUIRES_PROFESSIONAL_REVIEW)

| # | Workstream | Status | Evidence |
|---|---|---|---|
| 1 | v1 `/health-score` audit + correction | **VERIFIED_FIXED** | TZ-aware windows via `localDay.dayRangeUtc`, FDA-DV fallback, supplement separated, no rest-day penalty, no double-penalty, honest wording — `tests/healthScore.test.js` 25/25. Kept API contract. Impact/rollback in `HEALTH_SCORE_V1_V2_COMPARISON.md` |
| 2 | G4 calorie safety policy | **REQUIRES_PROFESSIONAL_REVIEW** | `calorieSafety.js` pure module, 12 fixture tests; intentionally inactive — `CALORIE_SAFETY_POLICY_PROPOSAL.md` |
| 3 | Clinical rule validation | **OPEN (review needed)** | gating VERIFIED_FIXED; inventory in `CLINICAL_RULE_REVIEW_QUEUE.md` — 14 nutrient rules lack thresholds, 31 legacy DRAFTs lack evidence |
| 4 | 120-scenario validation | **BLOCKED on spec completeness** | 12/120 `executed_pass`; 108 `pending_specification` — registry carries only one-line `expected` prose, no inputs/values → `SCENARIO_VALIDATION_MATRIX.md` |
| 5 | Ingredient data quality | **OPEN (backlog delivered)** | 484 ingredients: 18 verified / 145 proxy / 321 estimate / 0 missing; 229 used by recipes/logs → `INGREDIENT_VERIFICATION_BACKLOG.md` |
| 6 | Test-user cleanup | **OPEN (impact report only)** | 1,829 `@test.dev` users, ~500 owned rows, 0 cross-boundary meal plans → `TEST_USER_CLEANUP_IMPACT.md`; no deletion |
| 7 | v1↔v2 consistency | **VERIFIED_FIXED (documented)** | `tests/scoreComparison.test.js` 11/11 — matrix in `HEALTH_SCORE_V1_V2_COMPARISON.md`; v2 stays flag-off |
| 8 | Deliverables | **VERIFIED_FIXED** | this file + 8 docs in `docs/nutrition-intelligence/` |

## Test status this session

- **Full backend suite: 106 suites / 1,160 tests passed / 0 failures / 3 skipped** (`npx jest --runInBand`).
- Touched-area: `scoreV2.route` 8 · `healthScore` 25 · `mealSuggest` 13 · `calorieSafety` 12 · `scoreComparison` 11 (new) = 69.
- `npx prisma validate` clean · `npx prisma migrate status` up to date.

## Not claimed

- No clinical certification, no production readiness — scenario coverage is 10% (12/120), calorie floor inactive, 466 ingredients unverified.

## Known residue / leaks

- `mealSuggest.test.js` fixture cleanup still misses `RuleEvidence` rows (~21 accumulated).
- Test-user generation is ongoing — suites create ~10s of `@test.dev` users per run.
