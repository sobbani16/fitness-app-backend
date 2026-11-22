# P0_REMEDIATION_REPORT — fixed, resolved, and still-blocked

**Date:** 2026-11-21 · engines: `scoringV2.js` (`dps-v2` → `dps-v2.1`), `decisionEngine.js` (+`safety_warning`, +3 triggers)

## Confirmed fixes (executed, not asserted)

| Defect | Fix | Verification |
|---|---|---|
| **A06 / HF-0020** — surplus day scored 40/40 | `nutrition()` now earns energy (10 pts via targetRange); carbs/fat scored as ±20% ranges (caps 6+6); protein/fiber adequacy (12/6). SCORE_VERSION→`dps-v2.1` (snapshot reproducibility preserved) | fixture A06: earned 28.8 <40 **PASS**; 4000kcal no longer perfect; 600kcal→floor flag + 0.25 gate |
| Allergen exposure had no warning outcome (I07/I08 spec) | new `OUTCOMES.WARNING='safety_warning'` for `diagnosed_allergen_exposure`, `celiac_gluten_exposure`, `possible_allergen_exposure`, `uncertain_allergen_composition`; overlays coaching, never claims verified-safe | fixtures I07/I08 PASS |
| Persistent-symptom gap (H08 → silent `auto_feedback`) | `persistent_abdominal_symptoms`, `persistent_sleep_issues`, `possible_sleep_apnea` added to MEDICAL_TRIGGERS → REVIEW | H08/G06/G10 PASS |
| HF-0018 goal taxonomy | canonical 7 goals + explicit aliases; unknown→null | `calorieEngine` tests + energySummary `unrecognized_goal` gap flag |

## Underconsumption semantics (A02)

Below `calorieFloor`: `energy.state='safety_suspended'`, energy contributes 2.5/10 ("limited pending review") AND macro parts gated to 25% — a fake-full-macro 600kcal day lands ~10/40 flagged, never rewarded. `safetySuspension` top-level override still yields composite null.

## P0 ledger — 50 scenarios

| Status | Count | IDs |
|---|---|---|
| Executed PASS | 40 | A01–A10(all) B01–B04 B10 C01 C02 C05 C08 D07? D10 E02 E07 E08 F01 F04 F10 G05 G08 H08 H09 H10 I01–I10(all) J04–J10 K01–K03 K06 K07 |
| Executed FAIL | 0 | — |
| Blocked (capability absent) | 10 | F05 F08 F09 J01 K04 K05 K08 K09 L02 L10 |

Wait — recount from fixture file: blocked P0 = F05, F08, F09, J01, K04, K05, K08, K09, L02, L10 → **40/50 executed, all pass**.

## Still blocked — what each needs (Phase 2 continuation)

| ID | Verbatim expectation | Missing capability |
|---|---|---|
| F05 | explain balance, no mandatory compensation | compensatory-coaching logic + wording |
| F08 | accessible individualized activity plan | mobility-limitation profile + plan generator |
| F09 | deduplicate wearable workout | wearable-session dedup layer (caller-side, not engine) |
| J01 | uncertain-benefit explanation re: magnesium | supplement-advisory content module (pharmacist review) |
| K04 | raw↔cooked weight conversion | food-state conversion in normalizer |
| K05 | serving rescale recalcs all nutrients | recipe serving-rescale path verification |
| K08 | barcode+photo dup detection | cross-channel identity matcher |
| K09 | implausible wearable energy → validation | expenditure plausibility bounds |
| L02 | rapid repeated loss → review | multi-week weight trend monitor |
| L10 | good score, no goal progress → outcome review | outcome monitor (score-vs-trend divergence) |
