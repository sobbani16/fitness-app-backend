# Fiber Intelligence — Test Results

Recorded: end of implementation session. All results are actual runs, not claims.

## Backend (fitness-app-backend)

| Suite | Scope | Result |
|---|---|---|
| `tests/fiber.targets.test.js` | Target resolution: adult 14g/1000kcal (2000→28g), minor AI table, pregnancy/lactation, restricted conditions → conservative + review flag, clinician/custom overrides, unknown-vs-default provenance | 16/16 pass |
| `tests/fiber.sequencing.test.js` | Component roles, veg→protein→starch order, fruit not mislabeled as vegetable, mixed dishes (biryani/khichdi/pizza) not sequenced, low-fiber meal → optional addition, disclaimer copy | 9/9 pass |
| `tests/fiber.reminders.test.js` | Reminder body copy (food-first, no supplements), planning dedupe/priority, flag-off → `feature_disabled`, no target → `no_fiber_target`, closed gap → `already_completed`, send-time body | 9/9 pass |
| `tests/fiber.supplementCheck.test.js` | Label verification (unverified→suppressed_unverified, no fiber line→unknown), verified label verbatim, review_only suppressed, swallowing/obstruction/IBD/stricture/under-12/psyllium-allergy suppression, pregnancy+fluid warnings, medications_not_evaluated, same-day supplement note, hydration/dry/bedtime directions, audit persistence, no dose emitted, confirm flow | 18/18 pass |
| `tests/fiber.routes.test.js` | All 7 flags off → 403 FEATURE_DISABLED on every endpoint; parent-on/sub-off still 403; foodLogId scoped to caller; unknown user 404; daily taxonomy fields; target PUT provenance + clear; validation 400s; trend rows | 15/15 pass |
| `tests/fiber.assistant.test.js` | Chat/voice grounding: daily totals from engine, unknown≠0, ingredient per-100g verbatim, unknown ingredient honest, food-first suggestions, sequence routing, no supplement dose ever, hydration rule present, non-fiber → unhandled | 11/11 pass |
| Existing: `tests/reminders*.test.js`, `tests/scheduling.test.js`, feature-flag suites | Regression after adding `fiber` category + scheduler changes | pass |
| **Full backend suite** | `npx jest --runInBand` | **148/148 suites, 5796 tests pass** (2 skipped, 48 todo) |

Note on test-DB state: the isolated `fitness_test` DB was missing this migration's
columns (causing 81 unrelated-suite failures) and lacked RBAC/module seeds
(pre-existing gap). The migration SQL was applied to the test DB and
`seed-rbac.js` + `seed-modules.js` were run against it — all suites then pass.

## Mobile (fitness-app-mobile)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint` on touched files | 0 errors (1 pre-existing-style `exhaustive-deps` warning on DashboardScreen, same class as existing SmartRemindersScreen warning) |
| `npx jest` full suite | 77/78 suites, 464 tests pass; `DashboardScreen.test.js` passes standalone (10/10) after reverting an `isEnabled` dep that caused a focus-effect loop |

## Verified manually against the real local DB

- `GET /fiber/daily` shape: default 30 g target for an unpersonalized user,
  0 confirmed/estimated/planned/supplement, remaining 30, completeness `none`,
  4 suggestions, safety `ok`.
- Personalized user: target 31 g (=14×2200/1000) on `/fiber/trend` for all days.
- `groundFiberAnswer` on real data: dal→17 g/100g, broccoli→2.6 g/100g,
  oats→10.1 g/100g, supplement questions → label-check routing with hydration rule.
- `sequenceMeal` manual runs: chicken+rice → protein then starch + broccoli
  suggestion; veg+chicken+rice ordered correctly; biryani → `separable:false`.

## Coverage map vs required scenarios

| Required | Covered by |
|---|---|
| Goal calculations | fiber.targets.test.js |
| Missing/incomplete nutrient values | assistant test + routes test (unknownMeals, completeness) |
| Mixed meals / not separable | sequencing tests + routes test |
| Indian + international foods | sequencing tests (biryani, khichdi) + live dal/oats answers |
| Low-fiber meal → food addition | sequencing tests |
| Reminder timing/dedup/suppression | fiber.reminders.test.js + existing reminder suite |
| Incomplete logging not treated as deficit | engine copy + assistant test |
| Supplement label variations / unknown tsp conversions | supplementCheck tests |
| Medication interactions not evaluated | supplementCheck test |
| Swallowing/GI restrictions | supplementCheck tests |
| Hydration requirements | supplementCheck + assistant tests |
| Duplicate supplement logging | supplementCheck `fiber_supplement_already_logged` info |
| Recommendation invalidation | inputsHash incl. allergies/dislikes; persisted record |
| Feature flag enforcement | routes tests (all endpoints, parent+sub) |
| AI/voice consistency | shared `assistant.js` module used by both; tests |
| Authorization/privacy | routes tests (cross-user foodLogId 404) |

## Not covered yet (gaps)

- Raw vs cooked serving conversions (relies on existing `ingredientNutrition`
  per-100g + serving system — no new code added there).
- Reminder firing against a live worker tick (unit-tested at `runTick` level).
- Mobile component rendering tests for the three new fiber components.
- E2E: real scanned photo → sequence card (component flow tested at API level).
- Clinical safety review — explicitly NOT done; see SUPPLEMENT_SAFETY_REVIEW.md.

---

## Follow-up task results (this session)

| Check | Result |
|---|---|
| `tests/fiber.e2e.test.js` — REAL-DB scenario suite (sequencing, daily engine, psyllium eligibility, weekly review, assistant copy) | **21/21 pass** on isolated `fitness_test` DB |
| `tests/fiber.assistant.test.js` after dry-basis fix | 17/17 pass (incl. new dry-range test) |
| Mobile `FiberCards.test.js` — render/interaction for all 3 components | 20/20 pass |
| Mobile full suite `npx jest` | **79/79 suites, 492 tests pass** — DashboardScreen now passes inline (previous OOM was the dep-array regression, resolved) |
| Mobile `tsc --noEmit` | clean |
| Mobile eslint (touched files) | 0 errors; the documented `isEnabled` exhaustive-deps warning stands intentionally (adding it caused a focus-effect render loop — comment in code) |

### Scenario matrix verification (E2E, real DB)

| Required scenario | Verified outcome |
|---|---|
| No meaningful fiber (chicken+rice) | `hasMeaningfulFiber:false` + food addition suggestion; protein→starch order |
| Fiber-rich starch (chicken+quinoa) | starch stays last; no veg-first claim |
| Mixed dishes (biryani, khichdi, pulao) | `separable:false`, no forced order |
| Missing fiber nutrition | `knownFiber:false`, role `unknown`, fiberG null — never 0 |
| Allergies | allergen excluded from suggested additions; exhaustively avoid-listed → no invented suggestion |
| Incomplete daily logging | unknown ≠ deficit; "actual intake may be higher" |
| GI condition (IBD) | `restricted_reference` target + `reviewRequired` + `professional_review_required` verdict — surfaced at BOTH target and safety levels (payload gap fixed this session) |
| Psyllium: swallowing condition | `suppressed_safety` + persisted audit row |
| Psyllium: unverified label | `suppressed_unverified`, fiber null not 0 |
| Psyllium: verified label | `labelFiberG` verbatim + hydration directions, never a dose |
| Medication timing | `medications_not_evaluated` — reported as not evaluated, never "safe" |
| Weekly review | no_data / mostly_incomplete / on_track / below_on_logged_days verdicts verified; pattern suggestions food-first, no supplements, no catch-up language |
| Copy contracts | no `will prevent/lower/reduce`, `guaranteed`, `proven to`; no `take N g/tsp` anywhere |
