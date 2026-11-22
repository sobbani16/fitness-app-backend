# Fiber Feature Flag Validation — PASS

| Flag | Default | Gate | Group | Kill-switch |
|---|---|---|---|---|
| fiber_intelligence_enabled | OFF | router.use — whole /fiber mount | manual | yes |
| fiber_daily_goal_enabled | OFF | per-endpoint | manual | yes (depends parent) |
| fiber_meal_sequencing_enabled | OFF | per-endpoint | manual | yes |
| fiber_reminders_enabled | OFF | planner + send-time double check | manual | yes |
| fiber_supplement_suggestions_enabled | OFF | per-endpoint | **medical** | yes — stays OFF pending clinical review |
| fiber_ai_enabled | OFF | chat pre-check | **ai** | yes — in AI kill group |
| fiber_voice_enabled | OFF | interpret + execute re-check | **ai** | yes |

Verified live: OFF → 403/404; no client-side bypass (server-side requireFeature); cache invalidation irrelevant (env overrides honored per-eval, test TTL=0). dependsOn chains correct (`ai_coach` now spelled correctly post-owner-fix).
