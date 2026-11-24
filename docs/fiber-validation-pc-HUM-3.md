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

## Independent re-verification (increment 2)

Method column key: **inspect** = code reading · **service** = direct call into the real calculation path on the disposable DB · **pure** = pure-function call, no DB · **live-API** = earlier HTTP run · **real-data** = existing catalog rows (USDA copies), not synthetic values.

| Check | Method | Evidence |
|---|---|---|
| `fiberPer100g × grams/100` = 6.45 @150 g | service (`ingredientNutrition.calculate`, real-data ingredient `8f6a…f235`) | 6.45 exact |
| Serving conversion | service (labeled `n3v` `IngredientServing` 30 g ×2 → 60 g) | 60 g, fiber 2.58 exact; fixture deleted after |
| Zero vs null | service on real-data rows: `fiberPer100g=0`→`0`; `null`→`null` + `nutrientUnknowns['fiberG']` | distinguishes correctly |
| Negative / NaN fiber, negative grams | pure (`scale`/`quantity`) | 400 "Invalid nutrient fiberG" / "Invalid quantity in grams" — rejected before write |
| Daily split + rounding | service (`dailyFiber`, 3 synthetic logs on synthetic account) | confirmed 6.5, unknown 1, remaining 24.6, partial |
| Suggestion threshold boundary | service — custom target 10 vs 11 (gap 3.55 vs 4.55, `GAP_SUGGESTION_THRESHOLD_G=4`) | 0 vs ≥1 suggestions, exact boundary |
| Target formula/age/sex boundaries | pure (`resolveFiberTarget`) | 2200 kcal→31; custom 28; 18F→26; 19→formula; 50F→25, 51F→21 (`>50` cutoff verified both sides); pregnancy→28; clinician→stored |
| Restriction trigger + boundary | pure | "IBD"/"Gastroparesis"→`restricted_reference` 14 g + reviewRequired; misspelled "gastroparisis"→**not caught** (falls through to formula) — concrete F-3 boundary |
| `/macro-score/goals` fiber target | service (`getGoals`) | returns raw stored 30 vs engine 31 — F-1 confirmed below HTTP layer |
| Macro-score fiber intake | service (`calculateScore` + inspect `macroScoreService.js:193`) | `acc.fiberG += l.fiberG \|\| 0` — NULL scored as measured 0; `breakdown.fiber={actual:6.5,target:30,score:27,status:'low',tip:'24g below fiber target…'}` — no coverage signal — **F-4** |
| Mobile strip semantics | inspect `todaySummary.ts:6-9` + jest `todaySummary.test.ts`, `FiberCards.test.js` (23 pass) | `sumKnown`→null on any unknown → `—`; card shows confirmed+coverage |
| Device e2e | — | **still not verified** — needs build+device against a flagged-on backend |

**Correction to earlier expectation**: one boundary probe initially expected 25 g for a DOB that was actually age 51 on the run date; corrected inputs show age 50 → 25 g and age 51 → 21 g — the engine's `>50` cutoff is correct, not off-by-one.

### F-4 — Macro score conflates unknown/estimated fiber AND scores against the wrong target (needs fixing)
`macroScoreService.calculateScore` sums `l.fiberG || 0` (line ~193) — a log with unmeasured fiber contributes `0` as if confirmed, and an estimate-sourced log contributes its value as if confirmed — then scores that sum against `goals.fiberTarget` (raw stored 30, not the resolved 31). On the 3-log synthetic day it produced `score:27, status:'low', tip:'24g below fiber target'`; with a 4th estimated log it reports `actual:11.5` while the fiber engine on the same data reports confirmed 6.5 g + estimated 5 g separately + unknown 1 + partial coverage + target 31. This is the same class of defect as the NUTR-004-era zero-vs-unknown conflation, on a scoring surface.
*Smallest fix*: sum only `fiberStateOf(log)==='confirmed'` values (reuse `unknownsFor`/snapshot unknowns), attach a coverage marker to the breakdown, and resolve the fiber target via `resolveFiberTarget` — a read-path change, no schema or clinical-rule change. Any scoring change needs a data-quality validation step: recompute a fixture day with known/unknown/zero logs before and after and diff `breakdown.fiber`.

## Retained deterministic validation (increment 3)

The earlier ad-hoc script is now a retained artifact: **`tests/fiberValidation.test.js`** (21 checks, `npx jest tests/fiberValidation.test.js --runInBand`, exit 0). It exercises production code paths only — `ingredientNutrition.calculate`, `dailyFiber`, `resolveFiberTarget`, `getGoals`, `calculateScore` — against the disposable test DB with `n3v3`-scoped fixtures (deleted in `afterAll`; residue verified 0 across users/logs/servings/goals/recommendations). Age fixtures are computed relative to run time (`dob(years)`), eliminating the prior 50/51 fixture error.

Scope of the verified claims — read the rows above with this split:
- **Verified at service/unit level** (real code path + disposable DB): per-100g math, serving conversion, zero-vs-null-vs-estimated distinction **in the fiber engine path**, daily split/rounding, suggestion threshold, target boundaries, guard rails, F-1/F-4 defect reproduction.
- **Verified at HTTP level in increment 1** (live server, test auth bypass, disposable DB): `/fiber/target`, `/fiber/daily`, `/food-logs`, `/macro-score/goals` responses.
- **NOT verified**: device/app e2e; catalog fiber accuracy beyond probed rows; production-flag behavior (flags are dev/test-gated); any non-fiber engine path. The zero-vs-unknown guarantee does **not** extend to `macroScoreService` (F-4) — no blanket claim is made.

New check coverage beyond the original 28: estimated-source log (`estimatedG=5`, excluded from confirmed), suggestion threshold at nominal-exact 4 g — **observed float edge**: `10.45−6.45 = 3.999…` → the nominal-at case behaves as "below" (no suggestions); strictly-above (4.01) fires. Documented boundary quirk, not a defect.

**Defect tracking**: F-1/F-4 have no issue-tracker reference found in the repo — **routing unconfirmed**; they are recorded only here. `FIBER_RESTRICTION_PATTERNS` and all target rules remain **heuristics pending clinical decision #57** (needs_human clinical review) — no clinical authority is claimed.

## Catalog provenance audit (increment 4)

Read-only audit of the **dev catalog** (`fitness_app`, `Ingredient` table) — real imported dataset, not synthetic. Retained artifact: **`scripts/audit-fiber-data.js`** (read-only by construction; `node scripts/audit-fiber-data.js`). Fixtures (`source='test-fixture'`/'test' or `ms*`-prefixed) are excluded from all counts and labeled separately — the 10 NUTR-004 fixture rows remain ambiguous-ownership residue, not catalog data.

**Dataset**: 426 rows total → **416 catalog rows** audited (10 fixtures excluded). Provenance fields: `fdcId`, `sourceMetadata.nutrients[]` (full USDA nutrient array on 187 rows), `IngredientCatalog.sourceRecord` + `verificationLevel` + `importBatch` (228 rows), `IngredientServing.grams/estimated`.

**Census (n=416)**: `fiberPer100g` null **20** (4.8%) · zero **89** · positive **307** · negative **0** · non-finite **0**. Sources (all 426): usda 178, humai-catalog 228, seed 10, test-fixture 10 (excluded) → audited catalog = usda 178 + humai-catalog 228 + seed 10 = 416.

**Review flags** (flags only, never corrections): `fiberPer100g>100` — none; `fiber>carbs` — none; serving grams ≤0 or >2000 — none; `fiber>50` — **2**, both verified against their own provenance as genuine dense dry goods: Cinnamon powder 53 (import record 53, `GENERIC_COMPOSITION` — unverified level) and Spices, curry powder 53.2 (USDA nutrient 1079 = 53.2 exactly, fdcId 170924).

**Sample evidence (12 rows, stratified; tolerance ±0.05 g/100g for documented ≤2dp import rounding)**:

| Stored | Source value | Basis / ref | Name | Verdict |
|---|---|---|---|---|
| 0.2 | 0.2 | USDA 1079 G/100g · fdcId 2708958 FNDDS | Adobo, with rice | matches source |
| 1.2 | 1.2 | USDA 1079 · fdcId 2706797 FNDDS | Almond chicken | matches source |
| 10 | 10 | USDA 1079 · fdcId 590906 Branded | PANEER BUTTER MASALA | matches source |
| 10.6 | 10.6 | USDA 1079 · fdcId 168911 SR Legacy | Spaghetti, spinach, dry | matches source |
| 0 | 0 | USDA 1079 · fdcId 173417 SR Legacy | Cheese, cottage, lowfat | matches source |
| 0 | 0 | USDA 1079 · fdcId 2705740 FNDDS | Cheese, paneer | matches source |
| null | — | no provenance extractable | GLUCOSE | unverifiable |
| 12.5 | 12.5 | import record · expansion-v1 | Almonds, raw | internally consistent |
| 2.1 | 2.1 | import record · expansion-v1 | Amaranth leaves thotakura | internally consistent |
| 0 | 0 | import record · expansion-v1 | Bacon, pan-fried | internally consistent |
| 2.6 | — | `sourceMetadata:null`, no fdcId | Banana (seed) | unverifiable |
| 1.8 | — | `sourceMetadata:null`, no fdcId | Brown rice, cooked (seed) | unverifiable |

**Result**: 6/12 match embedded authoritative source records exactly; 3/12 internally consistent with their import record (source accuracy itself unverified — `GENERIC_COMPOSITION` level); 3/12 unverifiable (no provenance: 1 USDA null-fiber row, 2 seed rows). **0 confirmed discrepancies in the sample.**

**Scope limits**: conclusions cover only the 416 catalog rows and this 12-row sample on this dev dataset — no claim on catalog-wide accuracy, production data, or fixture rows. Seed-source rows (10) carry no provenance → their fiber values are unverifiable by construction. Unit/serving-basis issues (mL-vs-g, serving coverage) belong to DEV-02/pc-HUM-5 scope — flagged here, not touched.

## What remains

- **Device/e2e pass** — not performed; needs a matching build + device against a flagged-on backend.
- F-1 fix decision + implementation (read-path resolution).
- F-4 fix (macro-score fiber conflation) — implementation tracked separately; any scoring change needs the data-quality validation step above.
- Clinical ratification of `FIBER_RESTRICTION_PATTERNS` (F-3) — heuristic name-matching; any claim of clinical authority needs a human clinical review decision.
- The 18-ingredient micro-profile coverage gap (pc-HUM-4 NUTR-001) means most catalog fiber values come from the flat `fiberPer100g` column, not verified nutrient profiles — a data-coverage limitation, not a logic bug.
- Serving coverage in the disposable DB was thin (no `IngredientServing` rows on the test items) — serving conversion verified via a labeled fixture, not catalog data.

## Increment 5 — HTTP→rendered-app validation (device run, 2026-11-24)

Environment: backend `humai/dev-03-pc-HUM-3-fiber-validation` @ `aeebb6d` run locally on `:4000` (NODE_ENV=development, `DATABASE_URL=fitness_app` dev DB, `FF_FIBER_INTELLIGENCE_ENABLED/FF_FIBER_DAILY_GOAL_ENABLED/FF_FIBER_MEAL_SEQUENCING_ENABLED/FF_SUPPLEMENTS=true` env overrides — local process only, no shared flag changes). Device: iPhone 17 Pro simulator (iOS 26.4, booted) with dev-client `com.sobbani.fitnessappmobile`; JS bundle served by Metro from the mobile checkout @ `1e4cc27` (worktree HEAD identical; serving checkout carried unrelated uncommitted weather-file edits — no fiber-file changes). Account: dedicated device-fixture user `fl-device-verify@syn.local` (macroGoal 2662 kcal / stored fiberTarget 30 / basis null; no conditions). Automation: `maestro/fiber-pchum3-verify.yaml` (mobile worktree, retained).

Scenario (posted via `POST /food-logs` as the device user, payload shape per app contract — client-echoed `fiberG` is what persists; server math lands in `nutritionSnapshot.calculated`):

| Case | Expected | Observed (API) | Observed (screen) | Verdict |
|---|---|---|---|---|
| Lentils cooked 7.9 g/100g × 150 g | 11.85 confirmed | `fiberG` 11.85 saved+calculated | — | correct |
| Milk 1% 0 g/100g × 250 g | 0 confirmed-zero | `fiberG` 0 | — | correct |
| Glucose tabs null × 30 g | null → unknown | `fiberG` null + `nutrientUnknowns:['fiberG']` | "1 logged item has no fiber data — actual intake may be higher." | correct |
| Manual estimated entry 5 g | 5 estimated (excluded from confirmed) | engine `estimatedG` 5 | "~5 g estimated" | correct |
| Mixed day | confirmed 11.9 / target 37 (14 g/1k kcal × 2662) / remaining 25.2 / partial | `/fiber/daily` exactly: 11.9 / 37 / 25.2 / `partial` / unknownMeals 1 | "11.9 g confirmed · ~5 g estimated", "Target 37 g · 25.2 g to go", "Close the gap with food" (remaining >4 g) | correct |
| F-1 on screen | tile target ≠ card target | `/macro-score/goals` fiberTarget **30** vs `/fiber/target` **37** | macro tile "Target 30 g" directly above card "Target 37 g" — same frame (`docs/pc-HUM-3-evidence/*.png`) | **F-1 confirmed reaching the UI** |
| F-4 on screen | conflated actual + wrong target | `/macro-score` `fiber.actual` **16.9** (11.85 + estimated 5 + null→0) vs `target` **30**, "13g below fiber target" | "Health score 44 · Provisional" tile reflects conflated score | **F-4 confirmed reaching the UI** |

Rendered copy matched the engine DTO verbatim (confirmed, estimated suffix, unknown-count sentence, gap suggestions, "food-first options" explanation). No restriction-review banner for this no-condition profile (control). Restriction/suggestion behavior observed remains heuristic implementation behavior pending clinical decision #57 — not clinically endorsed.

Cleanup: 4 `n3v5-*` food logs deleted (0 `n3v*` residue); no `FiberDailyRecommendation` rows persisted by the session; backend process stopped; shared flags untouched.

## Increment 6 — Add-meal UI calculation boundary (device, 2026-11-24)

Same environment as increment 5 (backend @ `aeebb6d`+`48bacb9` on `:4000`/`fitness_app`, iPhone 17 Pro sim, dev client, Metro serving mobile @ `1e4cc27`, `fl-device-verify@syn.local`, flags via process env only). UI automation retained in `maestro/fiber-pchum3-addmeal.yaml`.

**Client-echo contract (characterized, not a defect verdict):** `POST /food-logs` persists the client-sent `fiberG` into the column (`nutritionSnapshot.saved`) while the server computes `nutritionSnapshot.calculated`. Mismatch probe (isolated `n3v6-*` row): sent `fiberG:1.0` for lentils 150 g → server stored saved **1.0** vs calc **11.85**, marked `userEdited:true`/`loggedSource:'user-entered correction'` — disagreement is *flagged* but the client value wins and counts toward `confirmedG`. Small echo drift (UI display rounding 16.1 vs calc 16.05) is likewise silently accepted.

| Case (UI-driven) | Expected | Server stored | Verdict |
|---|---|---|---|
| Brown lentils (dry), serving "1 tablespoon (12 g)" × **12.5** | 10.7×1.5 = 16.05 confirmed | `quantityG` 150, saved `fiberG` **16.1** (UI display rounding), calc 16.05, serving "1 tablespoon" ×12.5 | correct — serving path + quantity change recompute verified on screen (1→12.5 servings updated fiber 1.3→16.1) |
| Milk, low-fat, "1 cup (246 g)" | 0 confirmed-zero | `fiberG` **0** saved=calc, serving "1 cup" | correct — measured zero stays a real 0 |
| GLUCOSE TABLETS, GRAPE, "0.2 ONZ (4.5 g)" | fiber null → unknown | **never reached server** — `POST /food-logs 400 "Invalid serving"` | **defect F-5** |

**F-5 (confirmed defect, new):** catalog ingredients whose servings are label-derived placeholders (`/ingredients/search` returns `{"id":"label-serving","label":"0.2 ONZ","grams":4.5,"estimated":true}`) cannot be logged via the UI. The app sends `servingId:"label-serving"`; `ingredientNutrition.calculate` matches only real `IngredientServing` rows → throws `400 "Invalid serving"`. The meal stays in the device outbox as a retryable sync issue — the user sees only "Saved on this device · Server sync runs when connected." Reproduced via isolated probe POST (same payload shape → identical 400). Consequence observed: glucose entry visible on device ("7 meals") while `/fiber/daily` showed `mealsLogged:3, completeness:"complete", unknownMeals:0` — an unknown-fiber entry silently invisible server-side. Smallest fix direction: resolve `label-serving` (or accept `selectedServing` label + grams) server-side, or make the client send weight units for placeholder servings. Affects all `label-serving` items, not just fiber-unknown foods.

**Fiber field in the form:** explicit `0` rendered for measured-zero; blank + "Unknown if blank" for missing — the UI distinguishes zero from unknown correctly. Blank → client omits `fiber_g` → sync sends `fiberG:null` (correct contract); the glucose failure is the serving path, not fiber handling.

**Coverage limits:** manual entry was exercised via API in increment 5 (estimated classification verified); the UI Manual tile path was not driven this run. Restriction-warning UI remains unobserved (no-condition profile). Serving-unit picker exercised via real catalog servings (12 g tbsp, 246 g cup, 4.5 g label); fractional serving counts verified (12.5×). Device local store retains this run's saved entries even after server-side cleanup (offline-first: server delete ≠ device forget; noted, not cleared — app data dir wasn't touched).

**Cleanup:** 3 server rows deleted (lentils `…mszy6a`, milk `…c1vhni`, probe `n3v6-probe-mismatch`); `n3v6-probe-serving` was rejected → no row. Residue 0.
