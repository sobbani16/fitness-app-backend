# Activity Safety — Real Database Quality Audit (Phase 16.1)

Environment: **development** `fitness_app` @ localhost:5432 (app `.env` DATABASE_URL). Read-only inspection; no customer health data modified. Counts are aggregated; no user-identifying fields exported.

## Table inventory

| Table | Rows | Notes |
|---|---|---|
| User | 2,308 | dev/seed accounts |
| Exercise / ExerciseMuscle | 884 / 3,735 | imported library — see defect below |
| HealthCondition (catalog) | 22 | name-keyed; `code` column does NOT exist — see finding D-3 |
| UserHealthCondition | 0 | `active:Boolean` + `severity` fields (no `status` string) |
| UserInjury / UserSurgery / UserSymptomReport / UserActivityRestriction | 0 / 0 / 0 / 0 | no user safety data yet — consistent with flags-off |
| UserActivityProfile | 0 | |
| ActivitySafetyRule | 71 | 71 DRAFT / 0 APPROVED / 2 unsupported_input ✓ |
| ActivitySafetyEvaluation / Feedback | 0 / 0 | |
| WorkoutSession / ExerciseSet / DailySteps / SleepLog | 25 / 68 / 42 / 42 | |
| Recommendation | 0 | no cached recommendations exist — invalidation path untested by live data (covered by E2E mocks) |
| WorkoutPlan / TrainerWorkoutAssignment | 0 / 0 | |
| TrainerClient / TrainerClientConsent | 58 / 464 | consent rows = 58×8 (pre-`safety_restrictions`) — see D-4 |

## Findings

- **D-1 (FIXED) Exercise-muscle vocabulary mismatch — silent safety gap.** `dbExerciseCategories` mapped generic names (`biceps`, `chest`, `calves`) while the DB stores latin codes (`biceps-brachii`, `pectoralis-major`, `gastrocnemius`, `erector-spinae`, `rectus-abdominis`, …). **493/884 exercises (56%) produced zero demand categories** — every upper-limb and trunk conflict check silently passed. A trainer assigning "Alternating Deltoid Raise" to a shoulder-restricted client flagged no conflict. Fixed: full 21-code DB vocab + equipment aliases (`kettlebells`→`kettlebell`, `bodyweight`→`body only`, `e-z curl bar` standing-load). Post-fix: `none`=8 (all sternocleidomastoid/neck-isolation — intentionally unmapped), lower=300, upper=456, trunk=120, wb=186, impact=61, valsalva=301.
- **D-2 Exercise metadata gaps (unfixable by code):** 77 rows null `equipment`, 87 null `mechanic`, 8 null `category`. Effect: `mechanic`-gated categories (WEIGHT_BEARING_LOWER, VALSALVA) cannot be derived → under-flagging. Mitigation exists: conflicts are advisory + free-text exercises marked `unevaluated`. Recommend a catalog-enrichment pass or `demandReview` flag for null-mechanic compounds.
- **D-3 `HealthCondition` catalog has no `code` column** — `name`-keyed. `CONDITION_KEYS` in the engine expects canonical codes (`asthma`, `t2d`, …); a user condition row stores `conditionId` (uuid → catalog name). Whether names canonicalize to engine codes is unverifiable with 0 user rows — **provenance gap**: onboarding must write catalog names that match `CONDITION_KEYS` or store a code column. Flagged for review; current derivation `conditions.map(c=>c.name||c.code)` tolerates either.
- **D-4 Consent rows predate `safety_restrictions`:** 464 rows = 58 relations × 8 categories. Existing relations lack the 9th row → `hasConsent` returns false → summary detail (safe default). No migration needed — absence = deny, correct direction.
- **D-5 Zero safety data = unproven write paths:** injuries/restrictions/symptoms/evaluations all empty. Write-path correctness is currently covered only by mocked E2E (tests/activitySafety.e2e.test.js). Staging synthetic accounts must exercise the real write path.
- **D-6 `UserHealthCondition.active:Boolean`** — resolved-condition handling is a flag not a status vocab; engine reads `active` correctly via context. No defect.
- No orphaned references found among populated tables (ExerciseMuscle→Exercise all resolve; consent→relation all resolve).

## Specific checks required by the brief

| Question | Answer |
|---|---|
| Active leg injury recognizable? | Yes — `UserInjury{status:'current'}` → `wb_non_weight_bearing` flag + structural tags; proven in E2E, not live data |
| Stored knee restriction blocks exercises? | Yes — `categories:['lower_limb_load']` → `blockedCategories`; post-D-1-fix verified vs real exercises |
| NWB propagates to walking? | Yes — `weight_bearing_lower` on outdoor_walk/indoor_walk/run |
| New symptom invalidates cached recommendation? | `Recommendation` table empty; invalidation proven via tests + mobile refetch bus — no live instance exists |
| Restrictions body-region scoped? | Yes — `bodyRegions`+`categories` both stored; `__match_activity__` intersects demands |
| Active vs resolved injury distinguished? | Yes — `status current/recovering/resolved`; resolved excluded from derivations |
| Exercise metadata sufficient? | Mostly (muscles 100%); 8.7% null mechanic, 8.7% null equipment under-flag — D-2 |
| Contradictory demand metadata? | Equipment vocab inconsistency fixed (D-1); no contradictory muscle roles found |
| Trainer exercises same safety catalog? | Yes — `exerciseId` joins Exercise; free-text flagged `unevaluated` (never assumed safe) |
| DB code silently fails to match a rule? | Was true for muscle/equipment vocab (D-1, fixed). `HealthCondition.name`-vs-code provenance remains open (D-3) |
