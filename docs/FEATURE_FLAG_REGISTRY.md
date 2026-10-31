# Feature Flag Registry

Single source of truth: `src/config/featureRegistry.js` (backend, snake_case keys)
↔ `src/config/featureKeys.ts` (mobile, camelCase clientKeys).

## Precedence (enforced by `src/services/featureFlags/service.js`)

1. `AI_EMERGENCY_SHUTDOWN` env → all `group:'ai'` flags = false
2. `ai_emergency_shutdown` flag (PostHog or `FF_AI_EMERGENCY_SHUTDOWN`) → same
3. `environments` restriction → false outside listed NODE_ENVs
4. `dependsOn` unmet → false (structural invariant, cannot be overridden)
5. `FF_<KEY>` env override → its value (beats provider — instant admin control)
6. PostHog flag enabled for user → its value (targeting/rollout applied by PostHog)
7. Registry `default`

Provider outage → steps 3–5 + registry defaults only (AI/costly = closed, core/manual = open).

## Flags

| Key (PostHog / FF_ env) | clientKey | Class | AI group | Default | Backend enforcement | Mobile surface |
|---|---|---|---|---|---|---|
| `manual_food_logging` | manualFoodLogging | core | no | **on** | Ungated — documents `/food-logs`, `/ingredients`, `/summary`, `/daily-stats`, `/recipes` | Search/Manual/Repeat/Recipes entries, QuickAdd, diary |
| `manual_exercise_logging` | manualExerciseLogging | core | no | **on** | Ungated — `/exercises/*` | LogExercise manual entry, sets, history |
| `food_photo_scanning` | foodPhotoScanning | ai | **yes** | off (fail closed) | `POST /meals/detect`, `/meals/analyze` | FoodEntry photo mode, LogMeal Photo tile, `detectFood`/`analyzeMeal` |
| `nutrition_label_scanning` | nutritionLabelScanning | mixed | **yes** (extract only) | off | `POST /label-scanner/extract` | LabelScanner route+entries (LogMeal Scan, QuickAdd link). OCR/classify/save stay deterministic server-side |
| `menu_scanning` | menuScanning | mixed | **yes** | off | AI path inside `analyzeMenu` (deterministic OCR parse stays open) | MenuScan route, LabelScanner Menu tab |
| `ai_coach` | aiCoach | ai | **yes** | off | `POST /chat`, `GET /chat/status` | Chat tab, LeoHelp route, in-screen guards |
| `ai_food_recommendations` | aiFoodRecommendations | ai | **yes** | off | none today — current `/recommendations` + `/food-logs/intelligence` are deterministic | reserved for AI suggestion surfaces |
| `ai_workout_recommendations` | aiWorkoutRecommendations | ai | **yes** | off | `POST /personal-plans/draft` | WorkoutPlan "Generate my draft plan" action |
| `voice_food_logging` | voiceFoodLogging | ai | **yes** | off | `POST /voice/transcribe`, `/voice/interpret` (`requireAnyFeature` with exercise) | LogMeal Voice tile, GlobalVoice FAB |
| `voice_exercise_logging` | voiceExerciseLogging | ai | **yes** | off | same `/voice/*` endpoints | LogExercise VoiceInput, GlobalVoice FAB |
| `pose_detection` | poseDetection | on-device | **no** | on | none (fully on-device MediaPipe) | "Camera rep count and form" action |
| `weekly_meal_plans` | weeklyMealPlans | mixed | no | off | `router.use` on `/weekly-plan/*` | WeeklyPlan route, dashboard action |
| `weekly_plan_ai_generation` | weeklyPlanAiGeneration | ai | **yes** | off | AI path inside `generateWeeklyPlan` (dependsOn weekly_meal_plans) | — (server-only distinction) |
| `apple_health_sync` | appleHealthSync | server | no | off | `/health-data/*` (`requireAnyFeature`) | ConnectedHealth route + Summary entry |
| `android_health_sync` | androidHealthSync | server | no | off | `/health-data/*` | same |
| `trainer_dashboard` | trainerDashboard | server+rbac | no | off | `router.use` on `/trainers/*` (RBAC still applies) | Clients tab, 7 trainer routes, Summary coaching card |
| `smart_reminder_suggestions` | smartReminderSuggestions | server | no | **on** | `/reminders/suggestions`, `/suggestions/generate` | SmartReminders suggestions card + fetch |
| `supplements` | supplements | server | no | off | `router.use` on `/supplements/*` | Dashboard supplements card + daily-stats join |
| `video_search` | videoSearch | server | no | off | `router.use` on `/videos/*` | VideoSearch/VideoCompare routes (orphaned UI) |
| `ai_emergency_shutdown` | aiEmergencyShutdown | control | — | off | `aiProvider.askJSON` choke point + all group:ai flag resolution | hides all AI UI via resolved flags |

## In-flight/degradation behavior

- `/weekly-plan/generate`: kill switch ON ⇒ deterministic USDA-catalog plan still generated (flag only kills the AI path).
- `/voice/interpret`: kill switch ON ⇒ deterministic parser only; AI fill skipped (errors swallowed as today).
- `/menu-analysis`: stays reachable; only the AI layout-extraction path is gated (OCR parse + enrichment remain).
- `/label-scanner/extract`: flag OFF ⇒ 403 `FEATURE_DISABLED` (endpoint unavailable); flag ON + provider error ⇒ existing regex fallback.
- Clients already on a gated screen when a flag flips: mobile renders `FeatureUnavailable` on next refresh — no crash, no dead nav state.

## Manual-logging independence guarantee

`manual_food_logging`/`manual_exercise_logging` are `class:'core'`, `group:'manual'`, `default:true`, `failOpen:true` — no kill-switch path can reach them, no backend endpoint they depend on is flag-gated, and `isEnabled` for them survives provider outages and eval errors.
