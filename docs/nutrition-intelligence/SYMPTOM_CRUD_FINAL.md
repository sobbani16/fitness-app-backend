# SYMPTOM CRUD — FINAL (Phase 1)

## Backend (`src/routes/activitySafety.js`)

| Route | Behavior |
|---|---|
| POST `/activity-safety/symptoms` | Creates report; urgent codes → `urgent_escalation` + deterministic emergency copy; always `suppressesActivitySuggestions` + `noDiagnosis`; invalidates safety advice. |
| GET `/activity-safety/symptoms` | Owner-scoped, newest-first, `take ≤ 200`, explicit column select. |
| PATCH `/activity-safety/symptoms/:id` | **New this cycle.** Owner-scoped `updateMany`. Editable: `symptoms` (non-empty validated code list), `severity` (mild/moderate/severe), `context`, `persistence`. Immutable: `userId`, `reportedAt` (asserted). Empty payload → 400; unknown/cross-user id → 404; invalid enum → field null. Re-invalidates safety advice. |
| DELETE `/activity-safety/symptoms/:id` | Owner-scoped `deleteMany`; 404 on miss; re-invalidates. |

All routes gated `requireFeature('activity_safety_engine')` — flag OFF returns 401/403/404 (tested).

## Mobile

- `updateSymptom()` API added (`src/api/activitySafety.ts`).
- `SymptomHistoryScreen`: per-row Edit opens inline `Segmented` severity + course editors → PATCH → local state update + `invalidateSafetyRecommendations()`. Delete unchanged (Alert-confirmed). Non-causal pattern card, privacy notice, professional-review notice, coverage line preserved.
- `SymptomReport` type corrected — `notes` field removed (does not exist in schema; GET selecting it caused a real-DB 500).

## Verified

- Route tests: PATCH owner-scope, validation, enum-drop, 404, immutable fields, DELETE — `activitySafety.routes.test.js` 22/22.
- API tests: cross-user 404, list isolation, full create→patch→delete journey — `asyncScenarios.api.test.js` 7/7.
- Mobile: `tsc` clean, jest 426/426.

## Honest limits

- Edits/deletes update safety invalidation immediately; historical trend windows recompute on next read (no cached associations persist — verified via direct recompute path).
- No `notes` field exists on `UserSymptomReport` — free-text notes are not supported (schema change would be a new decision).
- Deletion is hard-delete for user reports (consistent with the model's role as user-owned diary; clinician-documented *restrictions* supersede instead — different table, preserved audit).
