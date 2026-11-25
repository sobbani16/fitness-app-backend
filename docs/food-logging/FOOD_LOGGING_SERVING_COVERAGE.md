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

## 2026-11-22 expansion run (release-blocker closure Phase 1)

`import-ingredient-servings.js --all --apply`: 178 catalog items imported → **422 serving rows, 190/228 = 83.3% coverage** (was 7.9%). Every row carries USDA `fdcId + dataType + description + gramWeight` provenance; 400 SR Legacy/Foundation/FNDDS rows, 22 branded-label rows (manufacturer-declared serving for that product).

Quality fixes during expansion: branded `householdServingFullText` path now passes the same weight-unit filter (`2 ONZ`, `4 GRM` rejected); duplicate AVOID key removed; wrong-food matches wiped (palak paneer ≠ paneer, made-with-oil/butter rice, soy vermicelli, ramen-as-soup); re-imports applied corrected records (paneer→'Cheese, paneer' 1 cup, rice→plain SR 1 cup 158g/202g).

### Unresolved queue — 38 foods needing human verification

| Food | Reason |
|---|---|
| atta, baking_powder, cashew, cocoa_powder, ground_beef_raw, imitation_crab, lamb_raw, potato_boiled, prawns_raw, rice_basmati_cooked, rice_noodles_dry, soba_noodles_dry, tofu_firm, turmeric_powder, dill | USDA record exists but only unlabeled gram-weights (1 oz/4 oz equivalents) — no honest household label |
| arborio_rice_dry, glutinous_rice_dry, dumpling_wrappers, lasagna_sheets_dry, vermicelli_dry | No sane USDA record with portions (branded variants lack serving declarations) |
| hummus, cream_cheese | Only branded records declaring weight-unit servings |
| espresso_coffee | Only fl-oz servings (weight-unit filtered) |
| jaggery | Only branded record declaring '4 GRM' weight serving |
| berbere_spice, curry_leaves, curry_paste_red, gongura_raw, jerk_seasoning, methi_raw, mutton_raw (goat), poha_dry, ragi_flour, ridgegourd_raw, soy_chunks_dry, taco_seasoning, tindora_raw | No trustworthy USDA record — Indian/proxy/specialty items needing alternate source or manual measurement |
| paneer_lowfat | 'Cheese, paneer' record covers full-fat; reduced-fat paneer needs its own record |
| water | Volume-based; grams suffice |

Gate re-check: coverage **83.3% ≥ 60%** → PASS. Verified conversions 422. Unresolved 38 (16.7%).

## 2026-11-25 — coverage gate retained as reproducible check

`scripts/check-serving-coverage.js` (new, read-only) recomputes the release gate: coverage ≥60% of usable catalog, all serving rows grams>0, no pure weight/volume-unit labels, all rows carry `sourceRecord`. Re-run on dev `fitness_app`: **83.3% (190/228), 422 rows, 0 violations — PASS**. Against the empty `fitness_test` it correctly exits 1 (gate fails closed). Remaining gap is the documented 38-item unresolved queue (16.7%) — human source verification required per item; barcode coverage remains a separate FAIL gate (0 BarcodeProduct rows, product decision pending).
