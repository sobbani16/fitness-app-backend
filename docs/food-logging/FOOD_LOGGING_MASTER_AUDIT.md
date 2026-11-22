# Food Logging — Master Audit

Scope: end-to-end food logging across mobile, backend, Postgres, USDA data, and non-manual entry flows. Status legend per Phase 0 rules.

## Environment baseline (verified 2026-11-22)

- Backend `feat/activity-safety-engine` @ `e799525`/`0ee70ca`, `node src/index.js` on :4000, local Postgres.
- Mobile `main` @ `22994ad`, Expo dev client `com.sobbani.fitnessappmobile`, Metro :8081, iPhone 17 Pro sim.
- Feature flags observed: AI estimates unavailable on device (`AI estimates are unavailable` banner), `voice_food_logging` gated, `foodPhotoScanning` gated, barcode via `/food-intel`.
- Synthetic account `fl-device-verify@syn.local` for all device tests; owner account signed out via UI.

## Confirmed root causes (Phase 1)

| ID | Root cause | Status |
|---|---|---|
| FL-001 | `IngredientServing` had 0 rows; curated `bread_wholewheat` sourceRecord is GENERIC_RESEARCH_DRAFT with no household measure. Prior fix (mobile `f137189`) built UI but no data was ever imported. | VERIFIED-FIXED (device) |
| FL-001b | USDA import pulled weight-unit pseudo-portions (`1 oz`, `4 oz`); `servings[0]` displaced the household unit. | VERIFIED-FIXED (device) |
| FL-002 | Literal duplicated copy in `FoodEntryScreen.tsx` per-100g line. | VERIFIED-FIXED (device) |
| FL-003 | `first?.grams ?? 100` fires only when servings absent; never labels 100 g as a household serving, never overrides verified servings. | VERIFIED (compliant — no defect) |
| RT-001 | Repeat-mode preview rebuilt from `quantityG` only; saved serving unit lost on reopen. | VERIFIED-FIXED (device) |

## Entry-point map (Phase 2)

| # | Flow | Screen | Endpoint | Serving resolution | Nutrition calc | Persistence | Status |
|---|---|---|---|---|---|---|---|
| 1 | Manual search → detail | FoodEntryScreen(mode=search) + IngredientSearch | `GET /ingredients/search`, `GET /ingredients/:id` | `servings[]` DTO → `servingUnits()` (household first, then g/oz); first verified serving = default | per-100g × grams, `applyPortion` | outbox → `POST /food-logs` (servingId+servingCount) | VERIFIED on device |
| 2 | Recent/Favorites/Today | LogMealScreen saved lists | local + reconcile `GET /food-logs?date=` | repeat mode — restored servingId/count (RT-001 fix) | snapshot values, editable | same outbox path | VERIFIED on device |
| 3 | Copy previous meal | same as #2 (`mode:'repeat'`) | — | — | — | same | VERIFIED via repeat |
| 4 | Quick-add (text “2 slices”) | QuickAdd.tsx `parseQuickText` | local parser → add() | parser produces grams/macros only | parsed estimate | outbox → POST | implemented; serving-unit parsing UNVERIFIED |
| 5 | Meal history / HistoryDetail | HistoryDetailScreen | `GET /food-logs` | read-only | — | — | implemented |
| 6 | Recipe logging | FoodEntryScreen(mode=recipes), RecipeSearch/RecipeByIngredients | recipe nutrition endpoint | recipe serving (per-serving nutrition) | recipe-computed | outbox → POST | implemented; yield/serving audit pending |
| 7 | Barcode | FoodIntelligenceScreen | `/food-intel` scan + `POST /food-intel/log` | label servingSizeG; falls back 100 g if absent | label nutrients | direct POST (not outbox?) | implemented; flag product-serving preservation pending |
| 8 | Nutrition label scan | LabelScannerScreen → PortionAdjustScreen | OCR extract → `/food-logs` | servingSizeG basis, servings/package unit | label nutrients scaled | outbox → POST | implemented |
| 9 | Photo meal | PhotoMealScreen | photo→ingredients→nutrition calc | per-ingredient grams | server recalc | `add()` | implemented |
| 10 | AI-assisted recognition | (photo path / estimate flow) | — | — | — | — | gated OFF on device (banner) |
| 11 | Voice logging | VoiceInput → interpret/execute | `POST /voice/interpret`, `POST /voice/commands/execute` | **GAP: execute only accepts `item.grams`; household units skipped unless grams supplied** | `ingredientNutrition.calculate` grams | direct `foodLog.create` (no outbox) | implemented w/ serving gap; unknown nutrients written as `?? 0` |
| 12 | Trainer guidance | ClientMealPlanScreen | — | — | — | — | view-only, not a logger |
| 13 | Custom foods | manual entry mode | `POST /food-logs` (no ingredientId) | grams only | user-entered | outbox | implemented |
| 14 | Custom recipes | recipes path (#6) | — | — | — | — | implemented |
| 15 | Saved meal templates | saved lists repeat (#2/#3) | — | — | — | — | VERIFIED |
| 16 | Offline/cached | outbox `fitness.mealOutbox.v1` + `saveMealChange`/`flushMeals`/`reconcileMealDays` | POST/GET `/food-logs` | serving identity survives (RT-001 fix) | snapshot preserved | queue + reconcile | VERIFIED on device |
| 17 | Bluetooth scale | `useScale` → grams into preview | — | grams | per-100g | same save path | implemented (untested) |
| 18 | Menu/restaurant scan | MenuScanScreen | menu items → `add()` | restaurant-reported/estimated | reported or estimated | outbox | implemented |
| 19 | Water/quick metrics | QuickAdd (water/weight) | separate stores | — | — | not food-log path | out of scope |

## Device-verified evidence (2026-11-22)

Maestro `maestro/food-logging-verify.yaml` exit 0; screenshots at `~/.maestro/tests/2026-11-22_000628/`:
- `Serving size: 1 slice` default; unit sheet `1 slice, 32 grams` + Grams + Ounces
- `Per 100 g: 247 kcal · Protein 13 g · Carbs 41 g · Fat 4.2 g`
- qty 2 → `= 64 g total` → 158 kcal, P 8.3 / C 26.2 / F 2.7 / fiber 4.5
- `Saved on this device`; Postgres FoodLog: qty 64, kcal 158, servingId `srv_bread_wholewheat_1`, servingGrams 32, selectedServing "1 slice", servingCount 2
- Reopen: `1 slice (32 g)` + `2` servings restored

## Open defects / gaps queue

- VOICE-001 (CONFIRMED): `/voice/commands/execute` LOG_FOOD requires `item.grams`; household-unit items are skipped unless grams supplied — no servingId resolution.
- VOICE-002 (CONFIRMED): voice path writes `?? 0` for missing nutrients — silently zeroes unknowns.
- BC-001 (CONFIRMED): `logScannedFood` snapshot stores `perServing` nutrients but no serving label/id — reopening a scanned product falls back to grams.
- BC-002 (CONFIRMED): `logScannedFood` writes `?? 0` for missing macros.
- SEC-NOTE: `servingCount<=0` coerces to 1 silently rather than 400 (harmless but inconsistent).
- EDIT-NOTE: no edit-in-place anywhere — POST is idempotent create-by-id (same id → 200 no-op, cross-owner → 409). Edits = delete+create. Documented, working as designed.
- PHASE-8-NOTE: Smart Portion Memory not implemented anywhere — always defaults to first serving/grams.
- DATA-001: catalog coverage — 58 servings across 18 ingredients; 210/228 (92%) usable catalog items have no serving. See FOOD_LOGGING_SERVING_COVERAGE.md.
- DATA-005: BarcodeProduct table empty — every barcode scan misses.
- DATA-002: `rice_cooked` has no catalog/ingredient row.
- QA-001: FoodEntryScreen repeat path shows restored serving from snapshot; when serving deleted/changed upstream, fallback = grams (safe, needs test).
