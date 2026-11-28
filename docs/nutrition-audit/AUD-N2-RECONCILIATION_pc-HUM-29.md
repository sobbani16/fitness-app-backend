# AUD-N2 reconciliation + integrity evidence — pc-HUM-29 (2026-11-26)

## §11 commit reconciliation
- Commit `2287e14bbe7d7297b647c3a9e45cc6d9a61b1ed8` — **located in fitness-app-mobile, merged into mobile origin/main** (not backend — verified absent from backend object store entirely). "fix(nutrition): AUD-N2 applied to dev DB — 5 orphans deleted, 8 refs remapped, 2 dead-user rows deleted".
- Remediation script version-controlled: `automation/database/aud-n2-remediation.js` (mobile main) — dry-run default, `--apply` requires `AUD_N2_APPLY=YES` two-factor, single transaction with rollback, pre/post validation, documented pg_dump backup/restore procedure. All required safety properties present.
- Regression version-controlled **and merged in backend main**: `tests/ingredientCanonical.test.js` (commit `f572eb1`, 124 lines, verified ancestor of backend origin/main).
- Not rerun; no DB dumps committed anywhere. Seed-shadowing check confirms the dev fix holds: **0 seed-shadowed rows** on dev DB today.

## §11.2 read-only integrity findings (dev DB fitness_app, `scripts/audit-n2-integrity-checks.js` — reproducible, SELECT-only)
| check | count | verdict |
|---|---|---|
| seed-shadowing (canonicalization regression) | **0** | clean — AUD-N2 fix holds |
| orphan RecipeIngredient→Ingredient | **17** | ⚠ finding N2-F1 |
| orphan RecipeIngredient→Recipe | 0 | clean |
| orphan IngredientAttribute→Ingredient | 0 | clean |
| orphan UserIngredient→User | **1664** | ⚠ finding N2-F2 |
| orphan FoodLog→Ingredient | 0 | clean |
| orphan IngredientServing→Ingredient | 0 | clean |
| duplicate (normalizedName, source) pairs | **10** | ⚠ finding N2-F3 |
| servings missing provenance | 0 | clean |
| catalog missing provenance | 0 | clean |
| catalog rows with preparation markers | 228/228 | clean |
| servings grams≤0 / >2000g / weight-unit labels | 0/0/0 | clean |
| recipes w/ ingredients but null calories / zero servings | 0/0 | clean |
| FoodLog historical refs | 323 total, 19 ingredient-linked, 0 seed | informational |

### Finding notes (read-only; remediation needs separate approval — never auto-applied)
- **N2-F1 (17 orphan RecipeIngredient rows)**: recipes referencing deleted ingredients — likely residue of ingredient cleanup lanes. No nutrient values may be guessed; the correct remediation is owner-adjudicated repoint-or-archive per row.
- **N2-F2 (1664 orphan UserIngredient rows)**: dead-user references — same class as the original AUD-N2 dead-user disposition (delete). Dev DB accumulates these from multi-agent fixture lanes; a cascade or periodic sweep policy is the durable fix. Historical production significance unknown — requires the production dry-run before any conclusion.
- **N2-F3 (10 duplicate normalizedName+source pairs)**: violates the canonical-identity invariant; needs merge-adjudication per pair with FoodLog reference preservation (never delete rows referenced by history without compat strategy).

## §11.3 production readiness package (prepared artifact — NOT auto-applied)
1. **Exact target identity required**: production Railway Postgres `DATABASE_URL` host+database name must be confirmed in writing by the owner before any step beyond read-only dry-run. The script must print the target host/db and require typed confirmation matching it.
2. **Read-only dry run first**: run `scripts/audit-n2-integrity-checks.js` against production with a read-only credential; capture counts; compare against expectations. **Abort if counts are unexpected** (e.g. orphan counts orders-of-magnitude different from dev).
3. **Backup + restore verification**: `pg_dump --data-only` of affected tables (`Ingredient`, `UserIngredient`, `IngredientAttribute`, `RecipeIngredient`, `IngredientServing`, `FoodLog`) immediately before apply; restore-verify into a scratch database BEFORE the apply proceeds — an unrestored backup is not a backup.
4. **Transaction + rollback**: remediation runs inside ONE transaction; any step failure rolls back everything. Apply-twice protection: idempotency pre-check verifies expected pre-state; if already-remediated state detected, the script exits without writes.
5. **Two-factor apply**: `--apply` + `AUD_N2_APPLY=YES` + typed target-identity confirmation — three independent signals, matching the existing dev remediation pattern.
6. **Never apply twice**: post-apply validation re-runs the integrity checks; zero orphans expected for remediated classes.
7. Production apply is a **human release operation** — this package is the prepared artifact; the owner confirmation step is mandatory and has NOT been given.
