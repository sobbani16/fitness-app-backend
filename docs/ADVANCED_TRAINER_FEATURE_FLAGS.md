# Advanced Trainer — Feature Flags

Date: 2026-10-31 · Source: `src/config/featureRegistry.js` (lines 173–328), `src/middleware/requireFeature.js`, `src/services/featureFlags/`. Mobile mirror: `fitness-app-mobile/src/config/featureKeys.ts`.

## 1. Registry entries (all trainer_* keys)

| Flag key | clientKey | class | dependsOn | default | Gates (registry `endpoints`) |
|---|---|---|---|---|---|
| `trainer_dashboard` | `trainerDashboard` | server | — | **false** | `/trainers` (master — entire suite) |
| `trainer_registration` | `trainerRegistration` | server | `trainer_dashboard` | false | `POST /trainers/signup`, `/trainers/applications` |
| `trainer_discovery` | `trainerDiscovery` | server | `trainer_dashboard` | false | `GET /trainers`, `GET /trainers/:id` |
| `trainer_coaching` | `trainerCoaching` | server | `trainer_dashboard` | false | `/trainer-requests`, `/trainer-relationships`, `POST /trainers/:id/subscribe` |
| `trainer_insights` | `trainerInsights` | server | `trainer_dashboard` | false | `GET /trainers/clients/:id/progress`, `GET /trainer/dashboard` ⚠¹ |
| `trainer_advanced_features_enabled` | `trainerAdvancedFeaturesEnabled` | **control** | `trainer_dashboard` | false | parent — all modules below |
| `trainer_workout_plans_enabled` | `trainerWorkoutPlansEnabled` | server | `trainer_advanced_features_enabled` | false | `/trainer/workout-plans`, `/me/workout-plans` |
| `trainer_nutrition_guidance_enabled` | `trainerNutritionGuidanceEnabled` | server | `trainer_advanced_features_enabled` | false | `/trainer/nutrition-plans`, `/me/nutrition-plans` |
| `trainer_messaging_enabled` | `trainerMessagingEnabled` | server | `trainer_advanced_features_enabled` | false | `/conversations` |
| `trainer_scheduling_enabled` | `trainerSchedulingEnabled` | server | `trainer_advanced_features_enabled` | false | `/trainer/schedule`, `/me/bookings`, `/trainer/bookings` |
| `trainer_paid_coaching_enabled` | `trainerPaidCoachingEnabled` | server | `trainer_advanced_features_enabled` | false | `/trainer/commerce`, `/me/purchases`, `/me/entitlements` — **stays OFF until store/legal review** |
| `trainer_workout_plan_ai_enabled` | `trainerWorkoutPlanAiEnabled` | **ai** | `trainer_workout_plans_enabled` | false | no endpoints — dormant placeholder |
| `trainer_nutrition_ai_enabled` | `trainerNutritionAiEnabled` | **ai** | `trainer_nutrition_guidance_enabled` | false | no endpoints — dormant placeholder |

⚠¹ `GET /trainer/dashboard` is listed in the registry but was never implemented.

All flags: `group:'manual'` (the two AI flags use `group:'ai'` → also killed by `ai_emergency_shutdown`), `failOpen:false`.

## 2. Dependency chain

```
trainer_dashboard (master)
├── trainer_registration
├── trainer_discovery
├── trainer_coaching
├── trainer_insights
└── trainer_advanced_features_enabled (control)
    ├── trainer_workout_plans_enabled
    │   └── trainer_workout_plan_ai_enabled  (ai group → ai_emergency_shutdown)
    ├── trainer_nutrition_guidance_enabled
    │   └── trainer_nutrition_ai_enabled     (ai group → ai_emergency_shutdown)
    ├── trainer_messaging_enabled
    ├── trainer_scheduling_enabled
    └── trainer_paid_coaching_enabled
```

`dependsOn` semantics (evaluator-verified): a child resolves **false** whenever any parent is off, regardless of the child's own targeting/env. Verified by tests: `trainer_dashboard master off → everything 403`, `parent flag off => child resolves off even when env-enabled`, `advanced parent flag off forces messaging off`.

## 3. Resolution order & env overrides

| Layer | Behavior |
|---|---|
| Provider | `FEATURE_FLAGS_PROVIDER` (`env` in tests) → PostHog in production |
| Env override | `FF_<KEY_SNAKE_UPPER>` beats provider per flag (e.g. `FF_TRAINER_MESSAGING_ENABLED=true`); `envOverrideName()` derives it |
| `/config/features` | client-facing resolution endpoint (existing system) |
| `requireFeature` | 403 `{error:{code:'FEATURE_DISABLED'}}` when resolved false; `failOpen` only on eval error for registered failOpen flags — every trainer flag is `failOpen:false` |
| Tests | `tests/setup.js` sets every non-`control` `FF_*` to true so pre-existing suites keep working; `control` flags are NOT auto-enabled (advanced parent must be explicitly set) |

## 4. PostHog setup instructions

1. Create a PostHog flag per registry key — **name must equal the snake_case key exactly** (`trainer_messaging_enabled`, etc.).
2. Leave every flag at 0% / off initially; release order recommended: `trainer_dashboard` → `trainer_registration` + `trainer_discovery` → `trainer_coaching` + `trainer_insights` → `trainer_advanced_features_enabled` → one module flag at a time.
3. `trainer_paid_coaching_enabled` — do not enable without counsel sign-off (see TRAINER_PAYMENTS_ARCHITECTURE.md §store-policy).
4. `trainer_advanced_features_enabled` is a control flag: enabling it alone exposes nothing — each module flag must also be on. Disabling it kills all 5 modules at once (children force-false).
5. The two `_ai_` flags gate nothing today; create them only when AI assist lands (they're already in the AI kill group).
6. Mobile reads `clientKey` values from `/config/features`; keys already synced in `featureKeys.ts`.

## 5. Shutdown semantics per module

| Module flag off → | Data | In-flight behavior |
|---|---|---|
| `trainer_workout_plans_enabled` | plans/days/exercises/assignments/feedback **preserved** | every route 403 FEATURE_DISABLED; `WorkoutSession.planAssignmentId` links remain valid but unreadable via API |
| `trainer_nutrition_guidance_enabled` | plans/meals/items/targets/assignments preserved; client `FoodLog` rows written via /log are ordinary logs — **unaffected** | 403 on all plan routes |
| `trainer_messaging_enabled` | conversations + messages preserved (read-only archive is a *relation-end* concept; flag-off blocks even reads) | 403 on all `/conversations` routes; push tokens untouched (`/me/push-tokens` is unflagged); Notification inbox rows already written stay |
| `trainer_scheduling_enabled` | availability, session types, bookings, events preserved | 403 on `/trainer/schedule`, `/me/bookings`, `/me/available-slots`; existing bookings remain rows — no auto-cancel (ops must decide whether to cancel/notify on flag-off) |
| `trainer_paid_coaching_enabled` | packages/purchases/entitlements/transactions preserved | 403 on commerce + `/me` routes; **`/webhooks/payments/:provider` is NOT flag-gated** — signature-verified events keep applying (purchases can still transition paid/refunded while the UI/API is off; intentional so webhook retry state machines don't wedge) |
| `trainer_dashboard` (master) | all trainer data preserved | every `/trainers*` + `/trainer-*` + advanced route 403 (children force-off); `requireFeature` on the router rejects before role checks |

General rule: **disable ≠ delete**. No flag-off path drops tables, revokes entitlements, or cancels bookings — those are operational decisions requiring explicit action.
