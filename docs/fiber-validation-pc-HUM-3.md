# Fiber Validation — pc-HUM-3 (synthetic day, end to end)

Validation only — no catalog values, clinical rules, thresholds, or schemas were changed.

## Revisions under test

| Repo | Branch | Commit | Notes |
|---|---|---|---|
| fitness-app-backend | `humai/dev-03-pc-HUM-3-fiber-validation` (worktree `fitness-app-backend-fiber`) | `5764d77` | includes supplement-platform work + pc-HUM-4 audit doc |
| fitness-app-mobile | `humai/dev-03-pc-HUM-3-fiber-validation` (worktree `fitness-app-mobile-fiber`) | `1e4cc27` | tip of `security/master-audit` |

## Environment

- **Backend instance**: `NODE_ENV=test AUTH_TEST_BYPASS=true` + `FF_FIBER_INTELLIGENCE_ENABLED=true FF_FIBER_DAILY_GOAL_ENABLED=true`, `DATABASE_URL` → **`fitness_test`** (disposable local DB), port 4173. Auth used the sanctioned test bypass (`x-user-id`), so every request ran the real route handlers and real DB; only token verification was bypassed.
- **Synthetic account**: `n3v-fiber-u1` (`n3v-fiber@test.dev`, DOB 1990-06-15 → adult, female, tz UTC) + `MacroGoal.caloriesTarget=2200`. All `n3v` rows deleted after validation.
- **Which backend the app calls**: `src/config/apiUrl.ts` — `EXPO_PUBLIC_API_URL`, defaulting to `http://localhost:4000` in `__DEV__`; store builds require public HTTPS. The app calls the real backend; **no mock-response substitution** exists outside Jest.
- **Device pass**: not run (no device/simulator in this environment). API verified over live HTTP; UI verified by code inspection + unit tests only — explicitly *not* counted as end-to-end.

## Fiber flow under test

`POST /food-logs` → `ingredientNutrition.calculate` → `scale(fromIngredient)` computes `fiberPer100g × grams/100` (NULL preserved) → `FoodLog.fiberG` column + `nutritionSnapshot.{calculated, nutrientUnknowns, loggedSource}` → `GET /fiber/daily` recomputes via `fiberStateOf` (null/unknowns→`unknown`, estimate-source→`estimated`, else `confirmed`) → `FiberDailyRecommendation` persisted with `inputsHash` (audit, recompute-on-read stays authoritative). `resolveFiberTarget` resolves the target with provenance (clinician > custom > restriction > life-stage > minor > 14 g/1,000 kcal > fallback).

## Results

| # | Case | Expected | Observed | Evidence | Verdict |
|---|---|---|---|---|---|
| 1 | Known fiber, non-100 g portion — "Bread, rice" `fiberPer100g=4.3`, log 150 g | `4.3×150/100` = **6.45 g** | `FoodLog.fiberG=6.45`; `snapshot.calculated.fiberG=6.45`; `loggedSource='catalog calculation'`; `nutrientUnknowns=[]` | `POST /food-logs` id `n3vlog-bread-01`; DB row | **correct** |
| 2 | Measured-zero — "Rice crackers" `fiberPer100g=0`, 100 g | **0 g, counted as confirmed** | `fiberG=0`, `state:'confirmed'`, `nutrientUnknowns=[]` | `n3vlog-crack-01` | **correct** |
| 3 | Unknown fiber — "GLUCOSE" `fiberPer100g=null`, 50 g | **null, excluded from confirmed, flagged** | `fiberG=null`, `nutrientUnknowns:['fiberG']`, `state:'unknown'`; `unknownMeals=1`; `completeness:'partial'`; explanation: *"1 of 3 logged items has no fiber data — actual intake may be higher than confirmed."* | `n3vlog-gluc-01`; `GET /fiber/daily` | **correct** — engine distinguishes 0 vs unknown and never presents the partial total as complete |
| 4 | Daily totals — same day | confirmed 6.45→**6.5** (display round1), remaining 31−6.45→**24.6** | `confirmedG=6.5`, `remainingG=24.6`, `mealsLogged=3` | `GET /fiber/daily` | **correct** (aggregation uses unrounded values; round1 only at presentation) |
| 5 | Target resolution — adult, 2200 kcal | 14 g/1,000 kcal → `round(30.8)` = **31 g, `formula_adult`** | `targetG=31`, `basis:'formula_adult'`, `calorieBasis:2200`, `ruleVersion:'fiber-target-v1'` | `GET /fiber/target` | **correct** |
| 6 | Warning trigger — add recorded "Gastroparesis" condition | restriction match → conservative 14 g + review flag | `targetG=14`, `basis:'restricted_reference'`, `reviewRequired=true`, note *"…a conservative reference, not a prescription"*; `safety.verdict='professional_review_required'` | `GET /fiber/daily` after linking `n3v Gastroparesis` | **correct** — see flag below |
| 7 | Non-triggering control — same profile, "Hypertension" condition instead | back to 31 g, verdict ok | `targetG=31`, `basis:'formula_adult'`, `restrictions:[]`, `verdict:'ok'` | re-read after swap | **correct** |
| 8 | Persisted audit row | recompute-on-read wins; hash tracks inputs | `FiberDailyRecommendation` updated to `targetG=31` after the condition swap — latest state, not stale | DB read | **correct** |
| 9 | Mobile daily total strip (`todaySummary.sumKnown`) | mixed known+unknown day | `summary.fiber=null` → strip renders `—`, not a misleading partial sum; `mealsWithMissingNutrition` flag set | `src/util/todaySummary.ts` | **correct** — conservative; see discrepancy F-2 |
| 10 | Mobile fiber card | engine payload | renders `6.5 g confirmed`, `Target 31 g`, unknown-meals note; supplements/estimated separate | `FiberProgressCard.tsx` inspection + `FiberCards.test.js` | **correct** |
| 11 | Same-screen target disagreement | one fiber target | macro strip reads `goals.fiberTarget` = **stored 30**; fiber card reads engine **31** | `GET /macro-score/goals` → `fiberTarget:30` vs `GET /fiber/target` → `31` | **needs fixing** (F-1) |
| 12 | Live device e2e (app ↔ backend) | — | not run — no device/build | — | **not verified** |

## Findings

**F-1 — Two surfaces disagree on the daily fiber target (needs fixing).**
`/macro-score/goals` returns the stored `MacroGoal.fiberTarget` (legacy default **30**, basis `null`) while `/fiber/target` resolves **31** (`formula_adult`, 14 g/1,000 kcal × 2200 kcal). On the same Dashboard, the macro strip shows target 30 and `FiberProgressCard` shows 31. Any client surface reading `goals.fiberTarget` silently disagrees with the engine. A `null` `fiberTargetBasis` means "never explicitly set" (`PUT /macro-score/goals` marks user edits `custom`), so the stored 30 is not user intent.
*Smallest fix*: in the `GET /macro-score/goals` read path, when `fiberTargetBasis` is null (or `'default'`), resolve `fiberTarget` via `resolveFiberTarget` before responding — or have the Dashboard strip consume `/fiber/target`. Stored value untouched; read-path only.

**F-2 — Macro strip hides a partial total the fiber card shows (cosmetic divergence, not misleading).**
`sumKnown` returns `null` when any logged meal lacks a nutrient, so the strip shows `—` for a day with 6.45 confirmed + 1 unknown, while `FiberProgressCard` on the same screen shows "6.5 g confirmed". Both are honest; neither presents a partial total as complete. Worth a deliberate decision: show "6.5 g (partial)" on the strip for consistency, or leave as-is.
*Smallest fix (optional)*: `todaySummary` returns `{ value, partial }` so the strip can render `6.5 g *`.

**F-3 — Condition-name regex is a heuristic, not clinical authority (flag for human review).**
`FIBER_RESTRICTION_PATTERNS` matches recorded condition names against patterns (e.g. `/gastroparesis/i`, `/crohn|ulcerative colitis|ibd/i`). A free-text or differently-worded condition ("stomach paralysis", misspellings) silently fails to trigger the restriction. The design is appropriately conservative when it fires (14 g reference + `professional_review_required`, never a prescription), but the *absence* of a match is not safety. Human clinical review should ratify the pattern list and the condition-taxonomy mapping.

## Test evidence

- Backend: `npx jest tests/fiber tests/nutritionStatus tests/foodLoggingRegression --runInBand` → **9 suites / 159 tests pass** (includes `fiber.e2e.test.js`).
- Mobile: `npx jest src/components/__tests__/FiberCards.test.js src/util/__tests__/todaySummary.test.ts` → **2 suites / 23 tests pass**.
- Live API transcript: all curls in §Results, run against the disposable DB (fixture rows `n3v*` removed afterward).

## Reproduce

```bash
# 1. Server against the disposable test DB (worktree of this commit)
export DATABASE_URL=<TEST_DATABASE_URL>
NODE_ENV=test AUTH_TEST_BYPASS=true \
  FF_FIBER_INTELLIGENCE_ENABLED=true FF_FIBER_DAILY_GOAL_ENABLED=true \
  PORT=4173 node src/index.js

# 2. Synthetic user + goal: User{id:'n3v-fiber-u1', dob 1990-06-15, gender female, tz UTC},
#    MacroGoal{caloriesTarget:2200}

# 3. Log: POST /food-logs (x-user-id: n3v-fiber-u1)
#    Bread, rice  ingredientId 8f6a20bd-…f235  quantityG 150  → fiberG 6.45
#    Rice crackers 9238a58a-…fac8               quantityG 100  → fiberG 0
#    GLUCOSE       d890cf34-…1599               quantityG 50   → fiberG null

# 4. Read: GET /fiber/target, GET /fiber/daily?date=YYYY-MM-DD
#    Trigger case: link HealthCondition 'n3v Gastroparesis' (active) → restricted_reference 14 g
#    Control:      swap to 'n3v Hypertension' → formula_adult 31 g
#    Cross-surface: GET /macro-score/goals → fiberTarget 30
```

## What remains

- **Device/e2e pass** — not performed; needs a matching build + device against a flagged-on backend.
- F-1 fix decision + implementation (read-path resolution).
- Clinical ratification of `FIBER_RESTRICTION_PATTERNS` (F-3).
- The 18-ingredient micro-profile coverage gap (pc-HUM-4 NUTR-001) means most catalog fiber values come from the flat `fiberPer100g` column, not verified nutrient profiles — a data-coverage limitation, not a logic bug.
