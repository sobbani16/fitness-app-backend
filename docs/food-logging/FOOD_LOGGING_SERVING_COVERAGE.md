# Food Logging — Serving Coverage Report & Release Gates

Generated 2026-11-22 from the configured local Postgres DB. Companion to `FOOD_LOGGING_DATABASE_QUALITY_REPORT.md`.

## Coverage by the numbers

| Band | Count | % of 228 usable catalog items |
|---|---|---|
| Verified household serving | 18 | 7.9% |
| Weight/volume only | 210 | 92.1% |
| Invalid conversion | 0 | 0% |

Verified items (USDA-sourced, `sourceRecord` carries fdcId): whole-wheat bread, white bread, egg boiled, egg raw (×2), chicken breast raw, chicken breast cooked (×2), oats, apple (×2), milk low-fat, milk whole, aata/roti flour, peanut butter, almonds, pita bread (2 rows), yogurt.

## Release gates

| Gate | Threshold | Current | Status |
|---|---|---|---|
| Serving conversion correctness | 100% of serving rows have grams>0, no pure-weight-unit labels displacing household units | 58 rows, ordering enforced in `derivedServings` | PASS |
| Bread canonical record | `1 slice` first for `bread_wholewheat` | verified device + API | PASS |
| Round-trip serving identity | servingId+count survive save→reopen | verified device | PASS |
| Catalog serving coverage (blocking) | ≥60% of usable catalog has ≥1 household serving | 7.9% | **FAIL** |
| Branded/barcode food coverage | BarcodeProduct populated + serving preservation | 0 rows | **FAIL** |
| Nutrition completeness | no negatives, no implausible macros | clean | PASS |
| Log integrity | 0 orphaned FoodLogs | clean | PASS |
| Snapshot provenance | new writes include source+revision | verified | PASS |
| Legacy log compat | 260 logs w/o snapshot render as weight entries | code path exists | PASS (manual verify pending on device) |

## Gap remediation plan

1. Extend `import-ingredient-servings.js` PRIORITY map or add catalog-wide USDA name-matching mode to close the 210-item gap. Dry-run default is already in place; match-sanity guard exists.
2. Populate `BarcodeProduct` (barcode service wiring or import) — currently every barcode scan resolves to nothing.
3. Promote `verificationLevel` for USDA-sourced items after review.
4. Deduplicate the 14 non-test normalized-name groups (glucose tablets ×5, pad thai ×4, chicken curry ×3, etc.).
5. Optional backfill decision for 260 snapshot-less logs — recommend leaving as weight entries (honest: no serving was ever recorded).

## Verdict on serving data

Serving identity, ordering, provenance, and round-trip persistence are **implemented and device-verified** for the foods that have serving rows. Coverage is the blocker: 92% of the catalog still exposes weight-only logging, which reproduces the original user-visible gap for any unimported food. Production readiness requires closing the coverage gate or scoping a launch food list.
