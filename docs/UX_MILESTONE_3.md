# Workout logging integration — October 16, 2026

Local milestone 3 adds stable create/set IDs and authenticated finish. Apply `20261016190000_workout_finish` and generate Prisma client before distributing the new mobile UI. Keep prior M2 nullable-nutrient compatibility. No remote deployment or production data change performed.

Finished sessions reject new sets; identical existing-set retries still succeed. Create ownership/payload conflicts are rejected. A PostgreSQL row lock serializes append/finish. Legacy records retain null finish time. Pound storage semantics remain unchanged.

257 backend tests passed. `scripts/test-workout-integrity.js` passed eight real PostgreSQL scenarios including eight concurrent create/append retries, ownership, payload conflict and finish replay. The script refuses remote/non-UX databases and removes only its own UUID fixtures. Local database: `fitness_ux_m2_20261016` on 127.0.0.1:55432; all 21 migrations applied locally.

The mobile report `fitness-app-mobile/docs/UX_MILESTONE_3.md` documents device-local drafts/favorites/templates, single-exercise scope, pending native acceptance and required release order. No build or submission was triggered.
