# Progress/profile integration — October 16, 2026

Local milestone 4 adds authenticated `GET /me/progress` (1–180 days, validated IANA timezone), scoped bulk reads of meals/weight/water/steps/workouts, null-aware daily grouping, and profile validation/concurrency protection. No scoring or calorie-target formulas changed. No new migration; retain pending M2/M3 migration compatibility before mobile distribution.

262 backend tests passed (30 suites). Six disposable local PostgreSQL/HTTP scenarios passed via `scripts/test-progress-integrity.js`, including eight concurrent profile saves yielding one weight entry, unit-only save yielding none, validation, timezone grouping, account isolation and missing-versus-zero records. HTTP fixture assigns a test identity; this is not a live authentication probe. Only UUID fixture records in `fitness_ux_m2_20261016` on localhost were modified and cleaned up.

New read models do not repair historical water/step date attribution, infer full-day completeness or reinterpret legacy fiber zeros. Details, mobile files, 173 mobile tests and native acceptance limits are in `fitness-app-mobile/docs/UX_MILESTONE_4.md`.

No production deployment, data change or TestFlight build/submission performed.
