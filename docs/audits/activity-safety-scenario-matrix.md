# Scenario Matrix Report (Phase 16.4)

`node scripts/activity-safety-scenario-matrix.js` regenerates `tests/activitySafety.scenarioMatrix.test.js` — **3,840 distinct fixtures** (≥300 required), policy-predicate expectations (not engine snapshots), covering the A–J brief scenarios + combinatorial grids: injuries×conditions×env, pregnancy/postpartum×env, surgery clearance×activity, urgent/review symptoms×activity, restrictions×activity (over-restriction guards), env-only, age/meds/missing-data.

## Real defects found + fixed by the matrix

- **F-1 NWB under-blocking**: `overhead_lifting` (standing press, `weightBearing:full`) ALLOWed under a non-weight-bearing lower-limb injury — `!demanded` skipped the WB check because regions.lower_limb=0 (load without motion). Fixed: `wbDemanded` derived from `weightBearing` for lower-limb injuries independent of region motion. Verified: NWB ankle + overhead_lifting → BLOCK.
- **F-2 blanket clearance ignored**: `activityClearance:{general:true}`/`'*'` never matched per-activity keys → cleared recovering surgery still NEEDS_CLINICAL_REVIEW on a walk. Fixed: `general`/`'*'` keys honored (`true`→cleared).
- **S026 improvement confirmed**: two-injury suggestion now picks `floor_core_work` (supine, avoids ankle+wrist) over standing `gentle_mobility` — the F-1 fix working.

## Expectation corrections classified as spec errors (engine correct)

- AQI≥151 defers outdoor for **all** users (EPA "unhealthy" band), not only asthma.
- Asthma+heat → MODIFY not defer (respiratory ≠ thermoregulatory); pregnancy+heat → DEFER (ACOG overheating caution is pregnancy-specific; postpartum MODIFYs).
- `overhead_lifting` categories lack `lower_limb_load` → a lower_limb-only restriction legitimately doesn't intersect (weight_bearing_lower restriction does).
- `contact_sport` regions.upper_limb=0.6 but categories omit `upper_limb_load` — catalog inconsistency, noted in exercise-library audit (E-1 class).
- Recovering hip blocks run/contact (correct); cardiac recovery + gentle_mobility ALLOWs (correct — cardiac-rehab-aligned light activity).

## Result

3,840/3,840 pass. Every scenario asserts intended semantics via `EXPECT` predicates; clinically ambiguous boundaries (ADJ-003-class) remain flagged for reviewers, not resolved by tests.
