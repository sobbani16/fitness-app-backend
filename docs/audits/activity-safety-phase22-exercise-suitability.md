# Phase 22 — Exercise Suitability Audit

Date: 2026-01 (Phase 22) · Branch: `feat/activity-safety-engine` · Commit: see git log

## Question audited

During Phase 21 device validation, the dashboard rendered *"…upper-body cardio
could be an option"* for a synthetic persona with a **non-weight-bearing right
ankle injury**. This audit determines whether that recommendation was a
validated specific candidate or a generic label implying clearance.

## Finding 1 — the suggestion is a specific cataloged activity, not a label

`upper-body cardio` is the user-facing label for **`upper_body_ergometer`**
(`src/services/safetySuggestion.ts:13` → `ACTIVITY_LABELS`), which is a real
entry in `src/services/activitySafety/activityCatalog.js:67` with a full demand
profile:

| Demand axis | Value |
|---|---|
| weightBearing | `none` |
| impact | `low` |
| balance | `low` |
| lower_limb region | 0 |
| upper_limb region | 1.0 |
| trunk region | 0.2 |
| categories | `upper_limb_load` |
| equipment | arm ergometer (implied by modality) |
| standing required | no — fully supported seated modality |

The suggestion text is produced by a deterministic template
(`safetySuggestion.ts` — "safety-critical wording is never generated"), so the
label cannot drift from the evaluated candidate. The engine evaluated the
**demand profile**, and under `non_weight_bearing` ankle the verdict
`ALLOW` is consistent with `weightBearing: 'none'` + `lower_limb: 0`.

**Conclusion: not a generic-category leak.** The observed suggestion was a
specific, demand-profile-evaluated candidate. The Phase 21 observation was
safety-correct behavior, not an unclassified label passing through.

## Finding 2 — regression matrix (all verified in `activitySafety.scenarios.test.js`)

| Case | Result |
|---|---|
| NWB ankle + `upper_body_ergometer` | `ALLOW` — genuinely non-weight-bearing ✓ |
| NWB knee + `strength_training` (standing, `weightBearing:'partial'`, lower_limb 0.6) | `BLOCK_ACTIVITY` ✓ |
| Shoulder impingement + `upper_body_ergometer` (upper_limb 1.0) | `MODIFY`/`BLOCK` — not `ALLOW` ✓ |
| Wrist fracture + `seated_movement` (upper_limb 0.5) | not `ALLOW` ✓ |
| Prohibited `trunk_load` + `seated_movement` (declares `TRUNK_LOAD`) | `BLOCK_ACTIVITY` ✓ |
| NWB ankle + wrist fracture + prohibited trunk_load (concurrent) | ergometer `MODIFY`, seated `BLOCK`, suggestion narrows or reports no safe candidate ✓ |

## Finding 3 — design boundary flagged for clinical review (not a code defect)

`upper_body_ergometer` has a **trunk region score of 0.2** but does **not**
declare the `trunk_load` category. Documented restrictions match on declared
`categories` (and weight-bearing body regions) — not on region scores. So a
`prohibited` `trunk_load` restriction does **not** reach the ergometer
(`ALLOW`), even though it does reach `seated_movement` (which declares
`TRUNK_LOAD`) and `strength_training`.

This is the designed restriction contract (categories are the declared-demand
vocabulary; region scores drive injury-region matching). However, a clinician
prohibiting "all trunk load" may reasonably expect it to reach a 0.2-trunk
modality. **Flagged as an outstanding reviewer question** in
`docs/clinical/activity-safety-review-assignment.md` — no code change without
clinical sign-off, since broadening restriction matching could over-restrict.

## What was NOT done

- No generic "upper-body" or "seated" label is treated as evidence of safety —
  the test suite asserts verdicts against demand profiles only.
- No exercise classification was altered; the only boundary found is a policy
  question for qualified reviewers, documented above.
- `no_safe_candidate` rendering ("No activity suggestion today…") was already
  honest — it never implies clearance.
