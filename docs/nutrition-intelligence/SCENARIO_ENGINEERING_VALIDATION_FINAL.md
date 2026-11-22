# SCENARIO_ENGINEERING_VALIDATION_FINAL — H8

**72/120 executed_pass** (was 68). Newly unlocked via real deterministic engine (`ingredientImpact` re-exported through `scenarioCapabilities`, zero duplication):

| ID | Expectation | Evidence |
|---|---|---|
| C03 | estimated portion data; added-sugar guidance when supported | `evaluatePortion` — WHO evidence + verdict |
| C04 | cooking method/oil/fat/energy density | `evaluatePortion` cooking_fat — kcal/g evidence + oil-quantity note |
| C07 | fat quality + calories counted | `evaluatePortion` nuts_seeds — calories counted, small_portion verdict, no harmful label |
| L06 | uncertain portions w/o discouraging | `evaluatePortion` → INCOMPLETE_DATA honest state |

**48 blocked remain**, split by real dependency:
- **Needs async DB-backed fixture runner** (infra exists, ~16): A08, A09 (trends), H01–H07, D02, E04, G04 (symptomContext), L03–L05 (outcome-divergence), B05
- **Needs clinical review/spec-fixture translation** (D9): D03–D06, D08–D09, E01, E03, E05–E06, E09–E10, F02–F03, F06–F07, G01, G03, G07, G09, I03–I04, I06, I09, J02–J03, K10, L01, L07–L09, B08
No expectations modified; no clinical rules activated.
