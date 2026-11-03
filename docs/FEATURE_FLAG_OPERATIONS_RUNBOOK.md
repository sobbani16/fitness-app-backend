# Feature Flag Operations Runbook

## One-time setup

### 1. PostHog project (admin)

In the PostHog project (**US Cloud, project 701405**), create feature flags whose keys match the registry exactly (snake_case). Suggested initial set:

| Flag | Rollout | Notes |
|---|---|---|
| `ai_emergency_shutdown` | OFF | The kill switch — 0% always |
| `manual_food_logging`, `manual_exercise_logging` | 100% | Core — leave on |
| `pose_detection` | 100% | On-device |
| `smart_reminder_suggestions` | 100% | Server, deterministic |
| `food_photo_scanning` | beta cohort % | e.g. 25% of beta testers |
| `nutrition_label_scanning`, `menu_scanning` | beta cohort % | |
| `voice_food_logging`, `voice_exercise_logging` | internal users only | Target by person/user id |
| `weekly_meal_plans` | beta cohort % | |
| `weekly_plan_ai_generation` | beta cohort % | dependsOn weekly_meal_plans |
| `apple_health_sync`, `android_health_sync` | beta cohort % | |
| `supplements` | beta cohort % | |
| `ai_coach`, `ai_food_recommendations`, `ai_workout_recommendations` | OFF | Enable when ready |
| `trainer_dashboard` | OFF | Enable for the trainer pilot |
| `video_search` | OFF | Orphaned — consider removal |

PostHog evaluates targeting/rollout per user — the backend just reads the resolved value. **Absent flags resolve to registry defaults** (AI = off, manual = on), so an unconfigured PostHog is a safe state.

### 2. Railway variables (backend service)

```
POSTHOG_API_KEY=<phc_... project token>     # server-side only, never EXPO_PUBLIC_
POSTHOG_HOST=https://us.i.posthog.com
# optional:
FEATURE_FLAGS_PROVIDER=posthog             # default when key present
FF_CACHE_TTL_MS=60000
AI_EMERGENCY_SHUTDOWN=false
```

## Everyday operations

**Enable a feature for everyone:** PostHog flag → 100% rollout. Propagates ≤60s to the backend cache, ≤`refreshAfterSeconds` (60s default) to mobile UI on next refresh trigger (foreground/poll).

**Enable for a beta tester:** PostHog flag → set rollout %, or add a person-property condition targeting the tester. Users keep consistent rollout buckets between sessions (PostHog hashes the distinct_id = our userId).

**Disable a feature fast:** PostHog flag → off. Or instantly via Railway: `FF_<SCREAMING_KEY>=false` + restart (beats PostHog entirely).

**Kill switch (all AI):**
- *Fast path:* PostHog `ai_emergency_shutdown` → on. Backend applies ≤60s (cache TTL); mobile hides AI UI on its next refresh.
- *Guaranteed path:* Railway var `AI_EMERGENCY_SHUTDOWN=true` + restart. Works even if PostHog is down or misconfigured. **This is the documented max propagation: one restart.**
- Scope: every `group:'ai'` flag — photo scan, label extract, menu AI, Leo chat, voice transcribe/interpret, workout-draft gen, weekly-plan AI gen. Manual logging untouched. `/weekly-plan/generate`, `/voice/interpret`, `/menu-analysis` degrade to deterministic paths instead of erroring.
- Restore: turn the flag off / unset the env var. Features return ≤60s, no rebuild.

**Provider outage:** nothing to do — evaluation falls back to `FF_*` overrides + registry defaults (AI off, manual on). Set `FEATURE_FLAGS_PROVIDER=env` to run provider-free permanently.

**Rollback the whole system:** `FEATURE_FLAGS_PROVIDER=off` → registry defaults everywhere. Or remove the `/config` mount — mobile keeps last-known-good cache, then defaults.

## Monitoring

- `GET /config/features` — spot-check your own resolved map.
- Backend `[featureFlags] provider evaluation failed` warnings → PostHog connectivity.
- `requireFeature` rejections → HTTP 403 + `error.code = 'FEATURE_DISABLED'` (grep Railway logs).
- `services/featureFlags/service.diagnostics()` — provider mode, cache size, last provider error (wire into an admin endpoint later if needed).

## Troubleshooting

| Symptom | Check |
|---|---|
| Feature won't enable | PostHog flag name matches registry exactly? Env `FF_*` override present? Build gate (`EXPO_PUBLIC_BETA_SAFE_MODE` in TestFlight builds) blocks AI keys — dev/preview build needed |
| Kill switch not taking effect | ≤60s server cache; env backstop needs a restart; check `AI_EMERGENCY_SHUTDOWN` spelling |
| All AI off unexpectedly | PostHog flag off or absent → registry default is OFF for AI — create the flags |
| 403 FEATURE_DISABLED surprises | A `router.use(requireFeature)` gate — check the flag + its `dependsOn` (e.g. `weekly_plan_ai_generation` needs `weekly_meal_plans` too) |
| Mobile shows stale config | Cache is per-account, ≤60s + jitter poll; logout/login forces re-fetch |


## knowledge_academy_enabled / modular_entitlements_enabled (2026-11)

- `knowledge_academy_enabled` gates /academy (member read), /editorial,
  /super-admin. Off = FEATURE_DISABLED 403 on all surfaces.
- `modular_entitlements_enabled` flags the module catalog; actual gating is
  controlled by ENTITLEMENT_MODE=shadow|enforce (env, not PostHog).
- Bootstrap: node prisma/seed-rbac.js (new roles+perms), scripts/seed-modules.js
  (module catalog), scripts/grant-super-admin.js <email> --confirm (the only
  SUPER_ADMIN grant path — no HTTP route exists).
- Weekly publisher: Railway cron → node scripts/weekly-publish.js (idempotent
  via EditorialSchedule.publishKey + PublicationEvent.scheduleId unique).
