# Stage 2 — Smart Fiber Meal Sequencing: Completion Report

Scope: `fiber_meal_sequencing_enabled`, **development-only**, internal testing.
Baseline: backend `ece687a` (Stage 1 live), mobile `1c09f73`.

## 1. Flag state & environment scope

| Flag | Dev `.env` | Resolves in dev | Resolves in prod |
|---|---|---|---|
| `fiber_intelligence_enabled` | true | ✅ true | ❌ false (env guard) |
| `fiber_daily_goal_enabled` | true | ✅ true | ❌ false (env guard) |
| `fiber_meal_sequencing_enabled` | true | ✅ true | ❌ false (env guard added this stage) |
| `fiber_reminders_enabled` | — | false | false |
| `fiber_supplement_suggestions_enabled` | — | false | false |
| `fiber_ai_enabled` / `fiber_voice_enabled` | — | false | false |

- `environments: ['development','test']` added to `fiber_meal_sequencing_enabled` — the same structural guard as Stage 1. Verified: `NODE_ENV=production` + `FF_*=true` → still false.
- Dependency chain verified: sequencing depends on `fiber_intelligence_enabled`; parent-off cascades (fail-closed). Supplement suggestions remain OFF as required.

## 2. Preflight

- Migrations: 68/68 applied, schema up to date. No schema changes this stage.
- Stage 1 unaffected: `/fiber/target`, `/daily`, `/weekly` still 200 on the flag-on instance.
- Unrelated working-tree changes preserved (scenario fixtures, activity-safety, flag-cache TTL fix, etc. — none staged).

## 3. Real-meal validation (live HTTP, dev DB)

Run against `POST /fiber/sequence` on the flag-on test instance (`:4100`).

| Meal | Outcome |
|---|---|
| Chicken + white rice | `separable:true`, no meaningful fiber → broccoli suggestion, honest copy |
| Rice + dal (toor) | `separable:true`; dal → `legume`, `fiberBasis:'dry_weight'`, `fiberG:null` |
| Roti + chickpea curry (chole) | chole → `legume`, starch last |
| Rice + vegetables (bhindi) | `non_starchy_veg` first |
| Quinoa + chicken | quinoa stays **starch** slot — not promoted first |
| Biryani | `separable:false`, `reason:'mixed_dish_single'` — no fake split |
| Khichdi | `separable:false` (mixed) |
| Sandwich / wrap / pizza / fried rice | `separable:false` (mixed-dish class) |
| No-fiber meal | `hasMeaningfulFiber:false` + food-first suggestion, no invented grams |
| Unknown-fiber item | `fiberG:null`, `knownFiber:false` — never 0 |

**High-fiber starches are not auto-first** — verified quinoa/brown-rice rank last; only `non_starchy_veg` with meaningful fiber takes slot 1.

## 4. Defects found & fixed this stage (root-caused, regression-tested)

1. **Rajma mislabeled `non_starchy_veg`** — the beans regex used a lookahead that only excluded legume terms *after* "beans"; "rajma kidney beans" matched the vegetable path and would display as "fiber-rich vegetable". Fix: explicit `(green|french|string|snap) beans?` pattern; legume terms detected regardless of position.
2. **Dry-basis fiber invented portion grams** — dry catalog entries (toor dal 15 g/100 g *dry*) were multiplied into eaten-portion `fiberG`, overstating cooked fiber ~2–3×. Fix: dry-basis components now report `fiberG:null`, `knownFiber:false`, `fiberBasis:'dry_weight'` and an honest explanation string; `fiberPer100g` kept as provenance.
3. **`hasMeaningfulFiber` ignored fiber density** — dal meals with honestly-unknown portion grams reported "no meaningful fiber + add broccoli". Fix: per-100 g density ≥ threshold also counts as a fiber-bearing component.

## 5. Nutrition accuracy

- Raw vs cooked: dry-basis rows no longer project portion fiber (defect 2); cooked rajma fixture uses actual portion grams.
- Provenance: every component keeps `fiberPer100g` + `ingredientId`; dry entries additionally expose `fiberBasis`.
- Unknown stays unknown (`null`, never 0); allergies/preferences filter `suggestedAddition`.
- No output claims ordering prevents glucose spikes — explanations are evidence-framed ("fiber first is associated with…", optional card).

## 6. Mobile integration

- `PhotoMealScreen`: confirm stage renders `MealOrderCard` from reviewed components (pre-existing, verified wiring).
- `FoodEntryScreen`: expanded meal-details now fetches `sequenceFoodLog(id)` for meals with `nutritionSnapshot.components` and renders `MealOrderCard` with loading/error states — **new this stage** (previously card only existed in the photo flow).
- `src/api/fiber.ts`: `SequenceStep.fiberBasis` typed.
- `tsc --noEmit` clean.
- `MealOrderCard` component tests (20) already cover roles, unknown≠0, non-separable copy, flag-off.

### Device evidence

- iOS (iPhone 17 Pro sim, iOS 26.4): Stage-2 maestro flow `maestro/fiber-stage2-verify.yaml` authored and iteratively corrected (tab-bar point tap, sheet navigation, quick-add detour). Runs repeatedly reached FoodEntry navigation; **the host then became resource-starved — sims crashed and the XCTest driver stopped starting before the card assertion could complete.** Flow is committed for re-run on a stable host.
- Android: emulator was already unstable in Stage 1 (ADB socket failures); not re-attempted this stage. Backend contract verified over HTTP on the same responses the app consumes.
- **Physical devices: none attached** — simulator/emulator only, as honestly recorded in Stage 1.

## 7. Test results

| Suite | Result |
|---|---|
| `tests/fiber.sequencing.test.js` (incl. 3 new regression cases) | 13/13 ✅ |
| `tests/fiber.e2e.test.js` (incl. Stage-2 audit cases + dal/rajma fixtures) | 24/24 ✅ |
| Flag + fiber focused suites (after env guard) | 63/63 ✅ |

## 8. Recipe data consistency

`scripts/fiber-recipe-reconcile.js` (committed): read-only dry-run printing stored vs computed `Σ(amountG×fiberPer100g)/servings`, line-level provenance, `UPDATE` + rollback SQL per recipe. Proposals unchanged from Stage-1 audit (e.g. Overnight oats 8→16.2 g; Salmon-quinoa 5→2.8 g — the only *over*stated row). **Not applied** — requires owner/clinical review before `--apply`.

## 9. Remaining blockers / risks

1. **Device visual verification of MealOrderCard pending** — host sim instability; flow committed. Backend payload + component tests + wiring verified.
2. `ingredientCatalog.findMany({})` loads the full catalog per request (~430 rows today) — fine now, worth an in-memory cache before broad rollout.
3. PostHog per-account targeting still unconfigured (Stage-1 deviation carries over) — dev-instance env provider only.
4. Physical-device testing never possible on this host.

## 10. Rollback verification

- `FF_FIBER_MEAL_SEQUENCING_ENABLED=false` + restart → `POST /fiber/sequence` returns `403 FEATURE_DISABLED`; mobile card simply doesn't render (flag-gated fetch).
- Parent-off (`fiber_intelligence_enabled=false`) cascades — sequencing resolves false even with its own override true (verified Stage 1 mechanics).
- Production: env guard → false regardless of overrides/PostHog.

## 11. Verdict: **CONDITIONAL PASS**

Sequencing is enabled dev-only, real-meal behavior verified over HTTP, three genuine defects fixed with regression coverage, mobile surfaces wired, supplement/AI/voice/reminders all remain OFF. Conditions: complete the iOS device assertion on a stable host; Android unverified. **Do not proceed to Stage 3 without explicit approval.**
