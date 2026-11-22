# Food Logging — Release Readiness Verdict

Date: 2026-11-22. Scope: the food-logging subsystem only (not the recipe-intelligence platform, which has its own unresolved blockers).

## Verdict: NOT production-ready

The original user-visible defect is **resolved and device-verified** for imported foods, and the serving/nutrition/persistence pipeline is correct. But two gates fail and several flows carry confirmed defects:

## VERIFIED — done and evidenced

| Item | Evidence |
|---|---|
| FL-001 `1 slice` serving | Device: unit sheet shows `1 slice, 32 grams`, default selected |
| FL-001b weight-unit ordering | `1 oz` no longer outranks household units |
| FL-002 duplicate label | Device: `Per 100 g: 247 kcal · Protein 13 g · Carbs 41 g · Fat 4.2 g` |
| Serving math | 2 slices → 64 g → 158 kcal (device + API, exact per-100g scaling) |
| Round-trip identity | Postgres row keeps `servingId/servingGrams/servingCount`; reopen restores `1 slice (32 g)` + count 2 |
| Idempotent create | same-id re-POST → no-op; cross-owner → 409 |
| Security | 401 unauth, 404 cross-user GET, 409 id-conflict, bounds on all numeric inputs, injection-safe, foodName truncated |
| Nutrition engine | `scale()` throws on invalid nutrients; nulls propagate; `catalogChangedSinceSelection` flag |
| Tests | 14/14 E2E script; all backend food/ingredient/meal suites green; mobile typecheck + 426 tests green |
| Offline | outbox queue + reconcile preserve serving identity |

## CONFIRMED DEFECTS — must fix before release

| ID | Severity | Defect | Fix sketch |
|---|---|---|---|
| VOICE-001 | High | Voice LOG_FOOD drops any food without `item.grams` — "2 slices" silently skipped | resolve `quantity+unit` against `IngredientServing` in `/voice/commands/execute` like `/food-logs` does |
| VOICE-002 | Med | Voice writes `?? 0` for missing nutrients — unknowns zeroed | carry `null` like the catalog path |
| BC-001 | Med | Barcode log loses serving label — reopens as grams | store `servingLabel`/`servingSizeG` in snapshot like `selectedServing` |
| BC-002 | Med | Barcode `?? 0` zeroes missing macros | carry `null` |
| DATA-001 | **High** | 210/228 (92%) usable catalog items have no serving — the FL-001 defect recurs for any unimported food | extend import script coverage or scope launch list |
| DATA-005 | High | `BarcodeProduct` empty — every scan misses | wire barcode source/import |

## GAPS — absent features (documented, not regressions)

- Smart Portion Memory: not implemented; always defaults to first serving/grams.
- Edit-in-place: no PUT endpoint; edits are delete+create by design (idempotent create makes this safe).

## BLOCKED / NOT DONE

- **COV gate**: ≥60% catalog serving coverage — at 7.9%.
- **ENV**: production deployment + post-deploy synthetic verification untouched; all verification is local (sim + local Postgres + dev build).
- **FLOW device passes**: barcode scan, photo meal, label scan, menu scan, quick-add, recipe→log each need their own device pass once DATA/VOICE/BC fixes land. Photo flow was flag-gated OFF during verification.
- 8 backend test suites fail on TEST_DATABASE_URL isolation (pre-existing env issue: academy, asyncScenarios, smartKitchen, trainerNutrition, photoScan, identity, exerciseLibrary) — unrelated to food-logging code but blocks a clean full-suite signal.

## Recommended order

1. VOICE-001/002 + BC-001/002 fixes (small, same null/provenance semantics as catalog path).
2. Serving coverage expansion (DATA-001) — the highest user-visible impact item left.
3. Device passes for barcode/photo/label/menu flows.
4. Prod deploy + synthetic verify, then re-run `food-logging-verify.js` + Maestro suite against prod.
