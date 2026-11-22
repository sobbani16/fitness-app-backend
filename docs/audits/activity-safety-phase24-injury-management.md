# Phase 24 — Injury Management

The product gap found in Phase 22/23 (`updateInjury` existed but no screen called
it) is closed: `GET /activity-safety/injuries` + `InjuriesScreen`.

## Backend — `GET /activity-safety/injuries` (`ef57443`)

- Returns the caller's own `UserInjury` rows, ordered current → recovering →
  resolved, then injuredAt desc within a status.
- Each row carries `clinicianDocumented`, `lockedFields`, `editableFields`
  computed server-side from `source` — the client never duplicates the
  clinician-lock contract.
- Live-verified on staging @ `ef57443`: clinician injury returns
  `clinicianDocumented:true` + populated `lockedFields`.
- Route tests: ordering, provenance metadata, lock partitioning, empty list —
  33/33 in `activitySafety.routes.test.js`.

## Mobile — `InjuriesScreen` (`8c1d819`)

Conventions followed: `gateScreen('activitySafetyEngine')` registration,
`ListRow` + inline edit (same pattern as `SymptomHistoryScreen`), design-system
components only.

- **List**: Active (current + recovering) and Resolved sections; each row shows
  body part + laterality, status, type, provenance (Self-reported /
  Clinician-documented / Voice / Feedback), weight-bearing and pain level.
- **Edit** (in-place per row): status, pain level 0–10 (validated client-side
  AND server-side), weight-bearing, movement limits, activities-to-avoid
  multi-toggle against the backend category vocabulary, notes, reassessment date.
- **Clinician locks**: locked fields render read-only with the explainer
  "a change requires updated clinician guidance recorded by a clinician"; a
  409 `clinician_fields_locked` surfaces as a visible Notice naming the fields —
  never silent.
- **Rejection feedback**: 400 `unsupported_fields`/`invalid_field` and network
  failures show as per-row Notices; `invalidateSafetyRecommendations()` only
  fires after a confirmed `updated:true`.
- **Recovery copy**: marking resolved shows "Other active injuries, symptoms
  and restrictions still apply" — no clearance implied. Elapsed time alone
  never resolves (unchanged backend contract).
- Entry: "Manage injuries" action on `SafetyReportScreen`.

## Invalidation (Task 3 verification)

- Successful PATCH → `invalidateSafetyRecommendations()` → every subscriber
  (dashboard `useSafetyRecommendation`, etc.) refetches from the backend.
- Server-side, the PATCH already calls `invalidateSafetyAdvice` → stored
  `Recommendation` rows get `staleAt`/`staleReason=injury_updated` (verified
  live Phase 23).
- Failed PATCH → no invalidation, row-level error shown.

## Tests

- `InjuriesScreen.test.js` 5/5: section+provenance render, locked-field
  hiding, edit→PATCH→invalidation, 409 surfaced, empty/error states.
- Backend route tests 33/33; mobile suite 83/83 (526); tsc + eslint clean.
