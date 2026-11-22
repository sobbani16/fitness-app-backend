# Food Logging — Test Matrix

Status legend: PASS (verified, evidence cited), PARTIAL, FAIL, N/A. Verified 2026-11-22 s8 unless noted.

| ID | Category | Test | Status | Evidence |
|---|---|---|---|---|
| DB-001 | integrity | IngredientServing rows have grams>0, label, sourceRecord | PASS | 58 rows, USDA fdcId in every sourceRecord |
| DB-002 | integrity | no orphaned FoodLogs, no negative/implausible nutrients | PASS | DB quality report |
| DB-003 | integrity | serving rows ordered household-first | PASS | derivedServings sort + device |
| SR-001 | serving resolution | search 'Whole wheat bread, ready' → `1 slice` = 32 g verified first | PASS | API + device |
| SR-002 | serving resolution | toDto emits catalog servings; USDA label-serving fallback intact | PASS | 14-check #5 |
| SR-003 | serving resolution | weight-unit labels (1 oz) never outrank household units | PASS | deleted 3 rows; sort enforced; device unit sheet order |
| NC-001 | conversion | 1 slice=32 g → 79.04 kcal; 2 slices → 158.08 (247/100g) | PASS | 14-check #6-7 + device 158 kcal |
| NC-002 | conversion | unit switch preserves grams; round-trip no drift | PASS | device: g↔slice sheet |
| NC-003 | conversion | missing nutrient stays null, not 0 | PASS (catalog) / FAIL (voice+barcode — `?? 0`) | nutrition.js:13 vs voice.js:268, foodIntel.js:379 |
| NC-004 | conversion | invalid/cross-ingredient servingId → 400 | PASS | sec probes |
| NC-005 | conversion | servingCount bounds: ≤0 coerces, >1000 → 400 | PASS w/ note | sec probes |
| UI-001 | state | portion edit updates all macros; unit sheet lists serving+g/oz | PASS | device screenshots 06-09 |
| UI-002 | regression | dup 'kcal / 100g · per 100g' text removed | PASS | device: `Per 100 g: 247 kcal · …` |
| UI-003 | state | reopen restores serving unit + count | PASS | device screenshots 10-11 |
| UI-004 | labels | AI-estimate vs catalog source labels shown | PASS | FoodEntryScreen.tsx:508 |
| PL-001 | persistence | save→retrieve keeps quantity, unit label, snapshot | PASS | 14-check #8-12 + Postgres row |
| PL-002 | persistence | idempotent re-POST same id → no-op | PASS | foodLogs.js:56-57 |
| PL-003 | persistence | outbox offline queue → flush order, poison-drop on 4xx | PASS (code+tests) | mealSync flushAt + 426 mobile tests |
| SEC-001 | isolation | unauth 401; cross-user GET 404; same-id cross-user 409 | PASS | sec probes |
| SEC-002 | isolation | injection in q/date params safe | PASS | sec probes |
| SEC-003 | validation | foodName 5000→300; quantityG bounds; loggedAt future-bound | PASS | sec probes |
| VOICE | voice | household-unit voice entry resolves serving | FAIL | VOICE-001 — grams-only execute |
| VOICE | voice | unknown nutrients null | FAIL | VOICE-002 |
| BC | barcode | scanned product keeps serving label on reopen | FAIL | BC-001 |
| BC | barcode | unknown macros null not 0 | FAIL | BC-002 |
| FLOW | recipes | recipe → food log keeps per-serving nutrition | PARTIAL | code exists; not device-verified |
| FLOW | photo | photo → ingredients → review → save | PARTIAL | flag-gated OFF on device |
| FLOW | label scan | label serving basis → portion adjust → save | PARTIAL | code exists; not device-verified |
| FLOW | menu scan | reported vs estimated nutrition honest labels | PARTIAL | code exists; not device-verified |
| FLOW | quick add | "2 slices" text parse | PARTIAL | grams/macros parser; unit parse unverified |
| E2E-001 | exact record | bread: search→slices→kcal→save→reopen | PASS | Maestro flow exit 0 |
| ENV | prod | production env + post-deploy verify | NOT DONE | local-only so far |
| COV | coverage | ≥60% catalog with household serving | FAIL | 7.9% — gate in serving coverage report |

## Failing/blocked summary

- VOICE-001/002, BC-001/002: real defects, fixes scoped in master audit.
- COV: 92% catalog uncovered — the same user-visible defect recurs on unimported foods.
- ENV: production deployment + verify outstanding.
- FLOW rows: code-complete, need device verification passes per flow.
