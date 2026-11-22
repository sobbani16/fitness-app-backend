# Food Logging — Test Matrix

Status legend: PASS (verified, evidence cited), PARTIAL, FAIL, N/A. Verified 2026-11-22 final pass unless noted.

| ID | Category | Test | Status | Evidence |
|---|---|---|---|---|
| DB-001 | integrity | IngredientServing rows have grams>0, label, sourceRecord | PASS | 431 rows, USDA fdcId/sourceRecord provenance |
| DB-002 | integrity | no orphaned FoodLogs, no negative/implausible nutrients | PASS | DB quality report |
| DB-003 | integrity | serving rows ordered household-first | PASS | derivedServings sort + device |
| SR-001 | serving resolution | search 'Whole wheat bread, ready' → `1 slice` = 32 g verified first | PASS | API + device |
| SR-002 | serving resolution | toDto emits catalog servings; USDA label-serving fallback intact | PASS | 14-check #5 |
| SR-003 | serving resolution | weight-unit labels (1 oz) never outrank household units | PASS | leaked rows deleted; filter fixed; device unit sheet order |
| NC-001 | conversion | 1 slice=32 g → 79.04 kcal; 2 slices → 158.08 (247/100g) | PASS | 14-check #6-7 + device 158 kcal |
| NC-002 | conversion | unit switch preserves grams; round-trip no drift | PASS | device: g↔slice sheet |
| NC-003 | conversion | missing nutrient stays null, not 0 | PASS | `nutrientUnknowns` on all 4 write paths; non-macro nulls preserved in snapshot |
| NC-004 | conversion | invalid/cross-ingredient servingId → 400 | PASS | sec probes |
| NC-005 | conversion | servingCount bounds: ≤0 coerces, >1000 → 400 | PASS w/ note | sec probes |
| UI-001 | state | portion edit updates all macros; unit sheet lists serving+g/oz | PASS | device screenshots 06-09 |
| UI-002 | regression | dup 'kcal / 100g · per 100g' text removed | PASS | device: `Per 100 g: 247 kcal · …` |
| UI-003 | state | reopen restores serving unit + count | PASS | device: "1 slice" + "1 portion (330 ml)" restored |
| UI-004 | labels | AI-estimate vs catalog source labels shown | PASS | FoodEntryScreen.tsx |
| UI-005 | regression | no float artifacts in kcal/gram display | PASS | fmtKcal/fmtG + 4 jest cases (`1846.2399999999998` fixed) |
| PL-001 | persistence | save→retrieve keeps quantity, unit label, snapshot | PASS | 14-check #8-12 + Postgres row |
| PL-002 | persistence | idempotent re-POST same id → no-op | PASS | foodLogs.js |
| PL-003 | persistence | outbox offline queue → flush order, poison-drop on 4xx | PASS (code+tests) | mealSync flushAt + 426 mobile tests |
| SEC-001 | isolation | unauth 401; cross-user GET 404; same-id cross-user 409 | PASS | sec probes |
| SEC-002 | isolation | injection in q/date params safe | PASS | sec probes |
| SEC-003 | validation | foodName 5000→300; quantityG bounds; loggedAt future-bound | PASS | sec probes |
| VOICE | voice | household-unit voice entry resolves serving | PASS | `resolveHouseholdServing` at interpret+execute; snapshot keeps `servingId`/`selectedServing`/`servingCount`; device exit 0 |
| VOICE | voice | unknown nutrients null | PASS | `nutrientUnknowns: []` on full-measure; nulls preserved in `calculated` |
| BC | barcode | scanned product keeps serving label on reopen | PASS | `snap:` pseudo-unit restore; device "1 portion (330 ml)" exit 0 |
| BC | barcode | unknown macros null not 0 | PASS | `nutrientUnknowns: ["fiberG"]` on Coca-Cola; provenance whitelist |
| BC | barcode | volume declarations never treated as mass | PASS | `servingUnit`/`servingSizeMl`/`servingSizeG` split; Coca-Cola `servingSizeG: null`, `servingSizeMl: 330`; 16 jest cases |
| FLOW | photo (desc) | description → AI detect → review gate → save | PASS (desc path) / PARTIAL (camera) | device exit 0; `fiberG` null → `nutrientUnknowns`; physical camera untested on sim |
| FLOW | label (typed) | typed text → extract → review → portion → save | PASS (typed path) / PARTIAL (camera OCR) | device exit 0; 240 g / 230 kcal logged; sugar/sodium nulls preserved; `reviewed: true` |
| FLOW | menu scan | library photo → items → select → save; honest labels | RUNNING | photo-library fallback; PARTIAL until complete |
| FLOW | quick add | "+250 ml water" + typed "drank 500 ml" | RUNNING | deterministic parser; water/weight only |
| FLOW | recent foods | list → heart → repeat → save | RUNNING | |
| FLOW | favorites | toggle → Favorite foods list → repeat → save | RUNNING | |
| FLOW | recipes | recipe search → select → review → save | RUNNING | |
| E2E-001 | exact record | bread: search→slices→kcal→save→reopen | PASS | Maestro flow exit 0 |
| E2E-002 | repeat meal | recent repeat → review → save | RUNNING | part of recent-favorites flow |
| ENV | prod | production env + post-deploy verify | NOT DONE | local-only so far |
| COV | coverage | ≥60% catalog with household serving | PASS | **83.3%** (190/228); 38-item unresolved queue documented |

## Known limits

- Camera capture (photo/label/menu camera paths) cannot be exercised on a simulator — typed-text/photo-library fallbacks were used. Marked PARTIAL for the camera leg; the post-capture pipeline is fully verified.
- Quick-add food parsing is intentionally limited to water + weight ("never guessed") — food phrases route to search/voice paths instead.
- Test environment: parallel Maestro/XCTest sessions on the same simulator UDID cause driver-port contention and mid-run kills. All device flows must run serialized with no competing automation.
