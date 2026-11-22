# Exercise Taxonomy Remediation (Phase 19 Workstream A)

## Audit of 164 review-flagged exercises

Breakdown of the ~164 Phase-18 review rows: **8 unmapped** (neck isolation) + **~134 partial** + overlaps. Root cause by source: `free-exercise-db` (129 null-field rows) + `test` (8).

## Verified facts

1. The importer (`scripts/import-exercises.js`) is a **faithful passthrough** — no fields dropped. Upstream `data/exercises.json` genuinely lacks `mechanic` on 87 rows and `equipment` on 77 rows.
2. Upstream HEAD (`yuhonas/free-exercise-db` dist) has **identical nulls** — no restorable data exists at the source.
3. `mechanic`/`equipment` only feed safety derivation (`WEIGHT_BEARING_LOWER`, `VALSALVA`) when `category==='strength'`. Of the 87 mechanic-nulls, 83 are stretching/cardio/plyometrics — **inapplicable, not incomplete**.
4. Real safety-relevant gaps: **10 strength rows** (4 mechanic-null + 6 equipment-null).

## Remediation — provenance-tracked patch

`data/exercise-metadata-patch.json` — applied by `import-exercises.js` before upsert; source JSON stays pristine; every entry carries `basis` + `confidence` + provenance `inferred-from-source-convention`:

| Exercise | Field | Value | Basis | Confidence |
|---|---|---|---|---|
| Bodyweight Walking Lunge | equipment | `body only` | name+instructions; source encodes all unweighted moves `body only` | high |
| Decline Push-Up | equipment | `body only` | push-up family convention | high |
| Inverted Row | equipment | `body only` | same convention as Pullups/Chin-Up | high |
| Scapular Pull-Up | equipment | `body only` | same as Pullups | high |
| Floor Glute-Ham Raise | equipment | `body only` | floor/partner variant, no machine | medium |
| Prone Manual Hamstring | equipment | `other` | partner-applied manual resistance | medium |
| Double Kettlebell Windmill | mechanic | `compound` | sibling `Kettlebell Windmill`=compound (upstream inconsistent vs Advanced=isolation — noted) | medium |
| Kettlebell Figure 8 | mechanic | `compound` | dynamic multi-joint | medium |
| Reverse Hyperextension | mechanic | `isolation` | sibling `Hyperextensions (Back Extensions)`=isolation | medium |
| Side Bridge | mechanic | `isolation` | siblings `Plank`/`Butt Lift (Bridge)`=isolation | high |

**Before/after**: strength-category exercises with null mechanic/equipment: **10 → 0**. Safety-derivable coverage: every strength exercise now produces full demand categories (e.g., lunge → `weight_bearing_lower` — verified by regression test: conflicts under NWB restriction).

## Guard correction

Phase-18 partial-metadata review verdict was **over-broad** (`!mechanic || !equipment` on any category). Now scoped to `category==='strength' && (!mechanic || !equipment)` — the only case where missing fields silently under-classify.

## Remaining review-required

- **8 unmapped neck-isolation exercises** (`sternocleidomastoid` — no engine category) — correctly `review`, awaiting specialist taxonomy decision.
- E-1..E-6 structural gaps remain: `overhead`/`balance`/`position` demands are not derivable from muscle metadata; `Barbell Deadlift` vs `Cable Deadlifts` demand inconsistency; these are clinical-taxonomy questions, not engineering defects.
- The 10 patch entries are engineering inferences — reviewers may veto; revert = delete patch file entry + re-import.
