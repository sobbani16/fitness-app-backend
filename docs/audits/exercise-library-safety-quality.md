# Exercise Library Safety-Quality Audit (Phase 16.3)

Source: dev DB `fitness_app` — Exercise (884) + ExerciseMuscle (3,735). Demand classification = `dbExerciseCategories()` (post-D-1 vocabulary fix). All exercises have ≥1 muscle + ≥1 primary role (0 orphans, 0 missing-role).

## Coverage summary

| Demand category | Exercises | Basis |
|---|---|---|
| lower_limb_load | 300 | leg-mover muscles |
| upper_limb_load | 456 | arm/chest/back/shoulder-girdle movers |
| trunk_load | 120 | abdominal/spinal movers |
| weight_bearing_lower | 186 | leg + compound + standing-class equipment |
| impact | 61 | `category=plyometrics` |
| valsalva | 301 | compound + bar/machine/kettlebell/other |
| none | 8 | neck-isolation (sternocleidomastoid) — intentionally unmapped |

Metadata gaps (cannot be derived): 87 null `mechanic`, 77 null `equipment`, 8 null `category`, **137/884 with ≥1 null field** — mechanic-gated categories (weight_bearing_lower, valsalva) under-flag on these.

## Required-example verification (live rows)

| Check | Result |
|---|---|
| Squats vs knee restriction | ✓ `Barbell Full Squat` → lower_limb + wb_lower + valsalva; `knee` limitation and `lower_limb_load` prohibition both conflict |
| Running vs NWB | ✓ via activity catalog (outdoor_walk/run carry weight_bearing_lower); DB treadmill rows map lower_limb_load |
| Push-ups vs wrist injury | ✓ `Pushups` → upper_limb_load; `wrist-pain` limitation token conflicts |
| Overhead press vs shoulder restriction | ⚠ **E-1 gap**: `Barbell Shoulder Press` → `upper_limb_load` only — `overhead` demand cannot be derived from muscle data (press vs lateral raise indistinguishable). A `shoulder` *limitation* still conflicts (upper_limb_load), but a category-only `overhead` prohibition would not. Needs a movement-pattern field or overhead flag in the catalog — flagged for enrichment |
| Seated exercise loads trunk | ✓ verified: `Cable Seated Crunch` → trunk_load; `Barbell Seated Calf Raise` → lower_limb_load. Seated ≠ safe-by-default |
| Swimming vs postop | ⚠ no swim rows in this import (`swim` search: 0 hits) — swimming lives in the activity catalog (`swimming` entry); trainer-side conflicts unaffected |
| Stationary cycling vs knee-ROM | ✓ `Bicycling, Stationary` → lower_limb_load — `knee` limitation conflicts (conservative; impact not asserted) |

## Findings

- **E-1 overhead demand underivable** (see table) — flag for catalog schema enrichment (`overheadReach:Boolean` or movement-pattern field). Interim safety: `shoulder` limitation covers presses via upper_limb_load.
- **E-2 contradictory demand sets for equivalent movements**: `Barbell Deadlift` → trunk+valsalva only; `Cable Deadlifts` → lower_limb only. Same movement, different primary-muscle recording → different restrictions apply. `Trap Bar Deadlift`-class exercises at risk of under-flagging leg restrictions. **Specialist review** — do not mechanically "fix" (clinical call on which demands a deadlift imposes).
- **E-3 primary-only muscle selection loses real secondary demands on compounds**: `Push Up to Side Plank` → upper only, though trunk load is substantial. Including secondaries would over-tag isolations (curls record core secondaries). Current behavior is conservative for restriction-matching (under-flags demand, so more conflicts possible only where the token overlaps a mapped category). Flagged; recommend `secondaryLoadThreshold` review, not a blanket change.
- **E-4 `equipment:null` misses weight-bearing**: `Bodyweight Walking Lunge` (eq=null, compound, leg) gets lower_limb but not weight_bearing_lower. 77 null-equipment rows share this class. Recommend import-time default `equipment:'body only'` for bodyweight movements after verifying the source catalog.
- **E-5 trainer-created exercises** use the same Exercise table + `exerciseId` join → same classification; free-text plan entries are flagged `unevaluated`, never assumed safe. ✓
- **E-6 no intensity/impact metadata** beyond `category=plyometrics` + `level`. Plyometrics→impact works (61 rows) but `level` is difficulty, not demand — do not repurpose. Impact on non-plyometric jumping exercises (e.g. `burpee` variants, category=strength) is **under-flagged** — `burpee` rows checked map lower/upper but no impact. Flag for enrichment.
- Recommendation: add nullable `demands Json` column to Exercise during a future catalog migration, populated by specialist review of the 137 null-field + contradiction cases; until then `unevaluated`/limitation-token fallback remains the safe path.

## Verdict

Library is **usable for restriction matching after the D-1 vocab fix** (56%→0.9% uncategorized). Remaining gaps are metadata-model limits, not code defects — E-1/E-2/E-3/E-6 are clinically consequential and require specialist review rather than engineering changes.

## Phase-17 addendum — coverage matrix + unmapped handling

| Class | Count | Definition |
|---|---|---|
| Fully mapped | 742 | categories derived + mechanic/equipment/category present |
| Partially mapped | 134 | categories derived but ≥1 null metadata field (mechanic/equipment/category) — under-flags WB/valsalva class |
| Unmapped → review-required | 8 | neck-isolation (sternocleidomastoid) — no engine category exists |
| Trainer-created | same pipeline | exerciseId join → same classifier; free-text → `unevaluated` |

Change: `planSafetyConflicts` now emits `status:'review'` for zero-category exercises — unmapped demand metadata is surfaced as "verify manually", never treated as unrestricted. The 8 neck exercises are honest `review` rows, not silent passes.
