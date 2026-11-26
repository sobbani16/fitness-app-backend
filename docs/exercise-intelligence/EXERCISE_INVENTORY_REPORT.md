# Exercise Inventory + Intelligence Profile Report — pc-HUM-101

Generated: 2026-11-25T14:40:43.755Z · catalog rows: **884** · profile version: `exercise-intel-v1`

## Coverage comparison
| surface | count |
|---|---|
| database exercises | 884 |
| free-exercise-db source | 876 |
| other sources (test/dev fixtures) | 8 |
| intelligence profiles generated | 884 |
| exercises missing instructions | 5 (iron-cross, one-arm-kettlebell-swings, push-press, side-bridge, side-jackknife) |
| exercises without primary muscle | 0 |
| duplicate ids | 0 |

## Movement-family classification
Classified: **796/884 (90.0%)** across 36 families (taxonomy defines 37).
Unclassified: **88** — honest residue; the program forbids forcing inaccurate families. Every unclassified exercise still receives a full Level-0 profile.

| family | exercises |
|---|---|
| horizontal_push | 98 |
| static_stretching | 94 |
| jumping_landing | 61 |
| elbow_flexion | 50 |
| horizontal_pull | 47 |
| olympic_lifting | 45 |
| squat | 45 |
| vertical_push | 42 |
| trunk_flexion | 38 |
| elbow_extension | 33 |
| dynamic_stretching | 29 |
| hip_hinge | 29 |
| vertical_pull | 20 |
| ankle_plantarflexion | 17 |
| wrist_flexion | 16 |
| locomotion | 14 |
| explosive_movements | 13 |
| carrying | 13 |
| scapular_movement | 13 |
| lunge | 13 |
| shoulder_abduction | 10 |
| shoulder_rotation | 8 |
| knee_flexion | 8 |
| trunk_rotation | 7 |
| isometric_hold | 7 |
| lateral_flexion | 4 |
| leg_press | 4 |
| trunk_extension | 4 |
| hip_adduction | 3 |
| step_up | 3 |
| anti_extension | 2 |
| knee_extension | 2 |
| single_leg_balance | 1 |
| hip_extension | 1 |
| kettlebell_movements | 1 |
| hip_abduction | 1 |

## Capability classification (evidence-derived, §6)
| level | label | exercises |
|---|---|---|
| 0 | manual_tracking | 884 |

No exercise is marked ML/camera validated: there is no pose pipeline, no validated rep counter, and no training dataset in this codebase. Profiles record pose/engine/model fields as explicitly absent rather than aspirational.

## Known gaps (documented, not hidden)
- 88-ish unclassified exercises are mostly odd/named variants (e.g. "Cable Judo Flip", "Body-Up") — candidates for taxonomy v2 rules after human review.
- Per-exercise movement restriction mapping (safety section) is unmapped — flagged pending review, no contraindications invented.
- 5 exercises lack instructions.
