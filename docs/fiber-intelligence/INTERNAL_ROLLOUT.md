# Fiber Intelligence — Internal Rollout Plan

Audience: internal test accounts only. Server-side flags gate every surface;
mobile UI hiding is secondary. **`fiber_supplement_suggestions_enabled` stays
OFF for the entire internal phase** — clinical review gate is documented in
`SUPPLEMENT_SAFETY_REVIEW.md`.

## Flag mechanics (existing infrastructure)

- Resolution order: `ai_emergency_shutdown` → `dependsOn` closure → `FF_<KEY>`
  env override → PostHog per-user flag → registry default (`false`).
- Internal rollout = PostHog flag targeting by user id/email on the internal
  cohort — no deploy needed, reversible in seconds.
- Kill switches already available: PostHog flag-off (per-user, instant),
  `FF_<KEY>=false` env (instance-wide), `ai_emergency_shutdown` (drops both
  `fiber_ai_enabled` and `fiber_voice_enabled` with one flag).

## Cohort

- 3–5 internal accounts with REAL data spread: (a) active logger with dal/
  rice Indian meal pattern, (b) mixed Western meals, (c) sparse logger
  (≤2 meals/day) to exercise incomplete-data paths, (d) an account with a
  recorded GI condition for the restricted-target path, (e) a minor-age or
  life-stage profile if available for target provenance.
- Create at least one dedicated account with NO history (fresh state) to
  verify honest "no_data" weekly verdict and empty-state UI.

## Stages — each gates on the previous one being green ≥3 days

| Stage | Flags on | Surface | Verify | Rollback |
|---|---|---|---|---|
| 0 | none | Nothing | Baseline: no `/fiber/*` calls in logs | n/a |
| 1 | `fiber_intelligence_enabled` + `fiber_daily_goal_enabled` | Dashboard fiber card, `/fiber/target`, `/fiber/daily`, `/fiber/trend`, `/fiber/weekly` | Target provenance correct per account type; confirmed/unknown split honest; weekly verdict distinguishes incomplete logging; zero 5xx | PostHog off → card disappears; API 403s |
| 2 | + `fiber_meal_sequencing_enabled` | MealOrderCard in photo-meal confirm, `/fiber/sequence` | Veg→protein→starch on separable meals; biryani/khichdi NOT ordered; sequencing failure never blocks logging; fruit never mislabeled veg | Flag off → card suppressed; scan flow unaffected |
| 3 | + `fiber_reminders_enabled` | Reminder category in settings + inbox | Explicit opt-in required; send-time body; gap-closed suppression (`already_completed`); quiet hours/cap honored; no supplement text ever | Flag off → `feature_disabled` verdict; no local notifications exist to clean up (fiber is never statically scheduled) |
| 4 | + `fiber_ai_enabled`, `fiber_voice_enabled` | Chat + Hey Leo fiber answers | Deterministic answers only (no LLM in fiber path); unknown ≠ 0; no doses; identical answers chat vs voice | `ai_emergency_shutdown` drops both instantly |

Explicitly out of scope at every stage: `fiber_supplement_suggestions_enabled`
(OFF — pending clinical review), production rollout (requires explicit
approval after internal sign-off).

## Monitoring checklist (run daily during stages)

- API errors: `5xx` count on `/fiber/*` routes (expect 0); `403 FEATURE_DISABLED`
  is correct behavior for off-flag users, not an error.
- Response payloads: spot-check `GET /fiber/daily` per account — `targetG`
  plausible (14–38 g range), `confirmedG` ≤ sum of logged fiber, `unknownMeals`
  matches null-fiber logs.
- `FiberDailyRecommendation.inputsHash` changes when logs/conditions change;
  a stale hash with changed inputs = invalidation bug.
- Reminder worker logs: `fiber` verdicts — expect mostly `feature_disabled`
  (non-opt-ins) and `already_completed` when gaps close; any `supplement` word
  in a fiber reminder body = stop-ship bug.
- Assistant: sample chat/voice transcripts — every fiber answer must carry an
  honest-source answer (catalog/engine), never an LLM synthesis; flag any
  numeric fiber claim not traceable to a catalog row or engine output.
- Client: fiber-card render errors, sequencing latency >2s (it's best-effort
  and must not block confirm).

## Recommendation consistency check

Same question asked via chat and voice on the same account must return
identical numbers (shared `assistant.js` — verify in stage 4). Daily card vs
chat "how much fiber today" must agree within the same recompute window.

## Rollback procedure

1. Immediate: turn off the offending stage's flag in PostHog — all surfaces
   disappear; API returns 403; nothing else changes for the user.
2. AI/voice issue: set `ai_emergency_shutdown` — drops both AI fiber paths
   without touching stages 1–3.
3. Instance-wide kill: `FF_FIBER_INTELLIGENCE_ENABLED=false` env var —
   collapses the whole feature family (parent flag) regardless of PostHog.
4. Code rollback: revert commits `ee50f62` (backend) / `ff742c0` (mobile) and
   this task's commits — the migration is additive-only, so no schema
   rollback is required; leaving the tables is safe.
5. Post-rollback: verify `/fiber/*` → 403, dashboard renders without the
   card, no `fiber` reminder candidates are planned.

## Stage-exit criteria (per stage, all required)

- ≥3 days on with zero 5xx on `/fiber/*`.
- No instance of fabricated fiber values, glucose guarantees, or supplement
  doses in observed output.
- Flag-off drill executed once: confirm clean disappearance within one
  app relaunch.
- Cohort sign-off recorded in this file's checklist appendix before the
  next stage opens.

## Status log

| Stage | Started | Sign-off | Notes |
|---|---|---|---|
| 0 | — | — | Baseline; all flags off |
| 1–4 | pending | pending | Not started — awaiting approval to begin internal cohort |
