# E2E Journey Coverage Map (Phase 16.5)

Each required journey traced DB → backend → gate → recommendation → API → mobile → feedback → invalidation. Evidence cited; gaps marked honestly.

| # | Journey | Evidence | Status |
|---|---|---|---|
| 1 | New user, no conditions | `tests/activitySafety.e2e.test.js` healthy path; M-matrix env grid (healthy user) | COVERED |
| 2 | Reports new leg injury | e2e `POST /injuries` → subsequent evaluate reflects restriction; M-matrix NWB grid | COVERED |
| 3 | Injury active→resolved | e2e PATCH injuries; `resolved` excluded from derivations (M-matrix resolvedAnkle cases + H2) | COVERED |
| 4 | Symptom requiring escalation | routes test + urgent short-circuit (M-matrix urgent grid: every activity → URGENT_ESCALATION) | COVERED |
| 5 | Wearable good recovery vs documented restriction | producer tests (progressCoach/sleepRecovery overlay cannot override gate); scenario D | COVERED |
| 6 | Trainer assigns conflicting workout | `planSafetyConflicts` summary/full detail + privacy suite; scenario I | COVERED |
| 7 | AI coach unsafe suggestion | chat deflection test + producers suite; scenario J | COVERED |
| 8 | Severe-weather alert arrives | environment tests (NWS live NYC verified; IMD CAP Delhi live-verified) | COVERED |
| 9 | Env data stale/unavailable | M-matrix `stale`/`unavailable` grids → INSUFFICIENT_DATA outdoor; env tests | COVERED |
| 10 | Location change US↔India | env tests: NYC `nws-us`, Delhi `imd-cap`, Paris `unsupported` — coverage switches per geography | COVERED |
| 11 | Pain/injury via mobile feedback | mobile `SafetyReportScreen` + `SafetyFeedbackScreen` (7 mobile tests) | COVERED |
| 12 | Cached recommendations invalidated | mobile invalidation bus clears+refetches on report; `Recommendation` table empty in dev — no live instance, mocked coverage only | PARTIAL (no live data) |
| 13 | Incomplete medical information | M-matrix age70/missing-profile + `INSUFFICIENT_DATA`/`requiredData` paths; AS-CORE-003 | COVERED |
| 14 | User requests rest | `rest` = fallback marker, never suggestion; ALLOW in all 15-activity grids | COVERED |
| 15 | Notification generated before new injury | producer tests show notifications carry no clinical text; pre-injury suggestion staleness = same invalidation path as J12 | PARTIAL (same gap as 12) |

Notifications and voice: producer tests assert no symptom/injury/condition text in notification bodies; voice recommendations pass the same gate (`tests/activitySafety.voice.test.js`).

Remaining gap: journeys 12/15 need a staging write-path run with synthetic accounts (real `Recommendation` rows don't exist in dev). No user-facing surface ships flags-on, so the gap is pre-release only.
