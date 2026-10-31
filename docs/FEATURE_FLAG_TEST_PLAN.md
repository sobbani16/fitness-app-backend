# Feature Flag Test Plan

## Automated (implemented)

**Backend — `tests/featureFlags.test.js` (10 tests):**
registry invariants (manual flags core/fail-open/outside AI group); env override beats default; `AI_EMERGENCY_SHUTDOWN` env kills group:ai while leaving manual on; `ai_emergency_shutdown` flag same; `dependsOn` enforcement; unknown keys fail closed; per-user caching.

**Backend — `tests/featureFlags.route.test.js` (6 tests):**
`/config/features` shape (`configVersion`, `refreshAfterSeconds`, `Cache-Control: private`, camelCase keys, no PostHog internals); `requireFeature` 403 `FEATURE_DISABLED` on `/chat`, `/chat/status`, `/meals/detect`; kill switch blocks AI endpoints with flags enabled; `requireAnyFeature` on `/health-data`; trainer router gate.

**Mobile — `src/components/__tests__/FeatureGate.test.js` (5 tests):**
`DEFAULT_FLAGS` fail-closed/open split; `betaSafeMode` build gate forces AI off; `FeatureGate` show/fallback; `gateScreen` any-of + `FeatureUnavailable` rendering.

**Regression:** full suites pass — backend 661/661, mobile 379/380 (1 pre-existing timezone-dependent `reminderPlan` failure, unrelated — fails on unmodified checkout too).

## Mandatory manual-logging regression (staging, synthetic account)

| Test | Setup | Expected |
|---|---|---|
| A — all AI off | Every group:ai flag off | Manual food + exercise logging, history, edit, delete all work |
| B — AI provider down | Invalid `OPENAI_API_KEY` | Same as A; AI endpoints 503, manual unaffected |
| C — kill switch | `AI_EMERGENCY_SHUTDOWN=true` or PostHog flag on | Manual logging works; `/meals/detect`, `/chat`, `/voice/*`, `/personal-plans/draft`, `/label-scanner/extract` → 403 FEATURE_DISABLED; `/weekly-plan/generate`, `/menu-analysis`, `/voice/interpret` return deterministic results |
| D — reactivation | Flags back on | AI features return ≤60s, no rebuild, data intact |
| E — data integrity | Toggle every flag | Food/workout records never deleted or corrupted |
| F — shared screens | AI off | LogMeal/LogExercise manual controls all work; only AI tiles disabled |

## Failure-mode matrix

| Scenario | Defined behavior |
|---|---|
| PostHog down | Backend: `FF_*` env + registry defaults (AI closed, manual open) |
| Config API error | Mobile: last-known-good cache → registry defaults; manual always visible |
| App offline | Same — cached flags; manual logging never depends on flags |
| Stale cache | ≤60s server + ≤refresh+jitter client staleness bound |
| Logout / account switch | Account-keyed storage — new user's flags fetched fresh |
| Flag flips mid-session | Screen re-renders to `FeatureUnavailable` on next context refresh; no crash |
| Unknown flag key | Client: default-false unless core; Server: `isEnabled` → false |
| Flag changes mid-request | Request in flight completes; next request sees new value |
| AI provider fails | `askJSON` error mapping (429→503, timeout→504, else→502); graceful endpoints fall back |

## Propagation test (run in staging before launch)

1. Flip PostHog flag → time first 403/new-403 removal on backend (expect ≤ `FF_CACHE_TTL_MS`).
2. Time mobile UI update: background→foreground forces refresh (expect ≤ `refreshAfterSeconds` + fetch).
3. `AI_EMERGENCY_SHUTDOWN=true` + restart → confirm AI 403s immediately post-boot.
4. Record results in FEATURE_FLAG_ACCEPTANCE_REPORT.md.

## Not covered yet (Stage 6+)

- PostHog percentage-rollout stability across sessions (needs dashboard flags + real users)
- Admin permissioning/MFA on the PostHog project itself
- Mobile deep-link-to-disabled-route (no URL linking exists; notification taps allowlist tabs only)
