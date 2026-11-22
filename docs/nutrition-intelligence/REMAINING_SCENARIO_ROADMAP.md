# REMAINING_SCENARIO_ROADMAP — 52 blocked → executable, in dependency order

**Status snapshot:** 68 pass / 0 fail / 52 blocked (all P1/P2). Nothing below is clinically activated by building it — every clinically sensitive output stays behind the new `medical`-group flags until reviewer approval.

## Build order (from `P1_P2_PRIORITY_MATRIX.md` Tier 1)

### Sprint A — Multi-day trend layer (unlocks ~20 scenarios)
Engineering: `src/services/trends/` — coverage-aware 7/14/30d aggregation over food logs, weights, workout history, daily scores. Pure aggregation; no thresholds, no claims.
Unblocks: A08, A09, F07, L01, L03, L04, L05, E05, E06, L09 + inputs for D02–D09, G-series, B05.

### Sprint B — Symptom/context association (unlocks ~9)
Link reported symptoms to recent logged foods/meals; cautious association language only; persistent → existing review escalation. Reuses symptom capture from activity-safety.
Unblocks: H01–H07, D02, E04, G04; feeds G01/G03/G07/G09 copy.

### Sprint C — Food-data confidence + meal-time analytics (unlocks ~7)
Propagate estimate ranges/provenance end-to-end; aggregate intake by local-day clock time via `dayRangeUtc`; boundary audit for TZ/midnight.
Unblocks: C03, C04, L06, E01, E03, E09, E10, K10.

### Sprint D — Micronutrient breadth (unlocks ~6; thresholds gated)
Extend nutrient coverage (B12, iron, calcium, vitD, omega-3) from catalog; adequacy *reporting* is eng-safe, thresholds need dietitian sign-off.
Unblocks: D03–D06, D08, D09 (variety metric is eng-definable).

### Sprint E — Fueling/explanation features (unlocks ~6)
Activity×intake adequacy framing for training days; divergence explainers using `detectOutcomeDivergence`.
Unblocks: B05, F02, F03, F06, F07, E05/E06 completion.

### Sprint F — Social/behavioral (unlocks ~4)
Substitution suggestions, budget-aware guidance, travel/missed-day tolerance.
Unblocks: L07, L08, B08 partially, C07.

### Sprint G — Clinically restricted wiring (requires approvals, not eng alone)
`condition_rules` → I03/I04/I06/I09; `supplement_safety`/`medication_interaction` → J02/J03; `allergen_warnings` → consumer surfaces for I07/I08 (currently capability-tested only).

## Checkpoint protocol per sprint
1. Implement pure capability + wire to the real consumer (per `NUTRITION_ENGINE_INTEGRATION_STATUS.md` matrix).
2. Flip fixture rows `blocked → executable`; record PASS/FAIL honestly — never soften `expectedVerbatim`.
3. Re-run `tests/scenarioFixtures.test.js` + touched suites; append to `SCENARIO_VALIDATION_FINAL.md`.
4. Update `AUDIT_STATE.json` + this roadmap.
