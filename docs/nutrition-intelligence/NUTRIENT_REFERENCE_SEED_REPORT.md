# Nutrient Reference Seed — fitness_test

- Dev `Nutrient` table: 27 reference rows (name/code/unit/category) — pure reference data, no user records.
- Required by preview batch: **26** (`SUGAR_ADDED` unused — no added-sugar values present in sources).
- Test table currently: 0 rows. Seed = exact copy of needed codes from dev reference (non-sensitive), keyed on unique `code` → upsert-idempotent.
