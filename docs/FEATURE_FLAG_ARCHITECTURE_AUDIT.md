# Feature Flag Architecture Audit

**Status:** Stage 1 deliverable — discovery only. No code changes made.
**Scope:** `fitness-app-backend` (Node.js/Express/Prisma) + `fitness-app-mobile` (Expo RN/TypeScript)
**Date:** 2026-03-10

---

## 1. Existing feature flag implementations

### Mobile — build-time only

`src/config/betaFeatures.ts` (entire file):

```ts
export const betaSafeMode = process.env.EXPO_PUBLIC_BETA_SAFE_MODE === 'true';
export const betaFeatures = { ai: !betaSafeMode, weeklyPlans: !betaSafeMode, supplements: !betaSafeMode };
```

- One env var fans out to **3 coarse booleans** — no per-feature granularity, no runtime/remote evaluation, no targeting.
- `eas.json`: `preview`/dev → all ON; `production` + `testflight` → `EXPO_PUBLIC_BETA_SAFE_MODE: "true"` → all OFF.
- `app.json` `updates.enabled: false` → **OTA disabled**; every flag change today requires a full native rebuild + reinstall.

**All consumption sites (12):**

| Site | Flag | Gating style |
|---|---|---|
| `navigation/RootNavigator.tsx:120` | `weeklyPlans` | Route not registered (`WeeklyPlan`) |
| `navigation/MainTabs.tsx:76` | `ai` | Tab not registered (`Chat`) |
| `screens/DashboardScreen.tsx:36,272` | `supplements` | Fetch-skip + hide card |
| `screens/DashboardScreen.tsx:304` | `weeklyPlans` | Hide entry button |
| `screens/FoodEntryScreen.tsx:231,465,475` | `ai` | Call-guard + hide button + fallback text |
| `screens/LogMealScreen.tsx:56` | `ai` | Photo tile disabled (not hidden) |
| `screens/ChatScreen.tsx:26,39,59,65,71` | `ai` | Fetch-skip + call-guard + notice |

### Backend — env flag only

- `AI_ENABLED` read per-request in `services/aiProvider.js:4` → gates `askJSON()` → 503.
- `OPENAI_API_KEY` presence is a second gate (503 "not configured").
- **No flag model, no admin endpoint, no `/config` endpoint, no PostHog** anywhere in either repo.
- `config/rbac.js:53` seeds a `MANAGE_FEATURE_FLAGS` permission (SUPER_ADMIN only) — **already reserved but unimplemented**. `deploymentReadiness.js` asserts the RBAC catalog at prod boot, so this will stay consistent automatically.

---

## 2. AI call sites — complete inventory

`services/aiProvider.js` `askJSON()` is the intended choke point (72 lines: flag check → quota → OpenAI `responses.create` → error mapping). **Three call sites bypass it partially or fully:**

| Endpoint | AI call | Gate today | Behavior when off |
|---|---|---|---|
| `POST /meals/detect`, `POST /meals/analyze` | `askJSON('food_estimate')` via `foodDetector.js:7` | `AI_ENABLED` + `OPENAI_API_KEY` + foodQuota (per-user `FOOD_AI_USER_DAILY_LIMIT` + global `FOOD_AI_GLOBAL_DAILY_LIMIT`, persistent) | 503 / 429. **Wart:** `meals.js:10` consumes persistent quota *before* the flag check — flag-off requests burn daily budget. |
| `POST /chat` | `askJSON('fitness_reply')` | `AI_ENABLED` + key + persistent `chat` limiter (`CHAT_DAILY_LIMIT`) | 503 / 429 |
| `POST /menu-analysis` | `askJSON('menu_extraction')` (`menuAnalysis.js:101`) | flag checked inline | **Graceful**: deterministic OCR-parse path still works; AI only fills gaps |
| `POST /voice/transcribe` | **direct `new OpenAI()` `audio.transcriptions.create`** (`voice.js:59-65`) | `AI_ENABLED` checked; **no key-presence check, no quota** | 503 if flag off; **unhandled SDK failure if flag on but key missing** |
| `POST /voice/interpret` | `askJSON('voice_intents')` (`voice.js:136`) | flag checked inline | **Graceful**: deterministic intent parser always runs; AI only fills `UNKNOWN_INTENT`s; errors swallowed |
| `POST /personal-plans/draft` | `askJSON('workout_plan')` (`workoutPlanner.js:96`) | full `askJSON` gate | 503 — no fallback |
| `POST /weekly-plan/generate` | `askJSON('weekly_meal_plan')` (`weeklyDietGenerator.js:84`) | `AI_ENABLED && key` checked inline | **Graceful**: deterministic USDA-catalog fallback |
| `POST /label-scanner/extract` | **direct `chat.completions.create`** (`labelScannerService.js:100`) | **⚠ checks only `OPENAI_API_KEY` — ignores `AI_ENABLED` entirely** | Reachable with flag off. Regex fallback on failure. **Must be fixed for any kill switch to be real.** |

**Confirmed deterministic (NOT AI, despite names):** `GET /recommendations` (calorieEngine/recommendationEngine), all `/safety/*`, `POST /food-logs/intelligence`, `/label-scanner/{classify,menu,extract-merged,compare,insights,adjust,save}`, `/voice/commands/{execute,undo}`, `/reminders/suggestions` (server rule-learning), `/personal-plans/suggestions|catalog`, all of `/weekly-plan/*` except `/generate`.

→ **Important consequence:** the spec's `ai_food_recommendations` and `ai_workout_recommendations` keys map mostly to *deterministic* services in this codebase. The genuinely-AI food/workout surfaces are photo estimation (`/meals/detect|analyze`) and plan *generation* (`/personal-plans/draft`, `/weekly-plan/generate`). The registry will classify these honestly rather than by marketing name.

**Quota layers (fragmented — a flag system should define precedence per feature):**
1. `askJSON` in-process call/token caps (`AI_USER_DAILY_CALL_CAP`=20, `AI_USER_DAILY_TOKEN_CAP`=50k) — not durable across restarts/replicas
2. `foodQuota.js` persistent per-user + global daily (`ApiUsage` + `AuthRateBucket` tables)
3. `chat` persistent limiter (`ApiUsage`)
4. `/voice/transcribe`, `/label-scanner/extract` — **no quota at all**
5. Global express rate-limit (120 req/min)

---

## 3. Ungated AI-adjacent surfaces (mobile)

| Feature | Surface | Server dependency | Today |
|---|---|---|---|
| Voice logging | `VoiceInput.tsx` — **global FAB on every screen** (`App.tsx:22-36`) + tiles in LogMeal/LogExercise | `/voice/transcribe`, `/voice/interpret`, `/voice/commands/execute` | ❌ ungated |
| Label scan extraction | `LabelScannerScreen` → `PortionAdjustScreen`; entries from LogMeal, QuickAdd, FoodEntry | on-device OCR (iOS `FitnessOcr` / Android ML Kit) + `/label-scanner/*` | ❌ ungated (extraction path is partially AI) |
| Menu scan | `MenuScanScreen` (tab inside LabelScanner) | `/label-scanner/menu`, `/menu-analysis` | ❌ ungated |
| AI workout plans | `WorkoutPlanScreen` via `WorkoutPlan` route | `/personal-plans/draft` (AI) | ❌ ungated |
| Pose detection | `PoseCameraScreen` modal inside `LogExerciseScreen` | **none — fully on-device** (`react-native-mediapipe-posedetection`) | ❌ ungated — correctly *excluded* from AI kill group per spec §10 |
| Smart reminders | `SmartRemindersScreen`, `ReminderInboxScreen` | `/reminders/*` (suggestions = server learning, deterministic) | ❌ ungated — core UX; recommend flagging only the suggestions endpoints, if at all |
| Health sync | `ConnectedHealthScreen`, dashboard wearable kcal | `/health-data/*` | ❌ ungated. **Note: no real HealthKit/Health Connect client exists** — server stores pushed records; pedometer uses expo-sensors |
| Trainer suite | `Clients` tab (role-gated) + 7 trainer screens | `/trainers/*`, `/nutritionists/*` | ❌ ungated beyond RBAC |
| Leo chat | `Chat` tab (gated) — but `LeoHelp` route + entries in Summary/PortionAdjust | `/chat` | ⚠ partially gated — route itself ungated |

**Orphaned/dead code found (flag or remove — recommend removal):**
- `VideoSearch`/`VideoCompare` routes registered but unreachable (no `navigate()` call site)
- `MacroDetailScreen.tsx` unregistered; `VideosScreen.tsx`, `ExerciseCreateScreen.tsx` unregistered
- `api/recommendations.ts`, `api/summary.ts`, `api/history.ts` — dead client modules
- `x-user-id` header plumbing in ~7 API modules — stripped by the axios interceptor anyway; `getDeviceId()` = session user id. Dead plumbing; `body.userId` fallbacks on backend are similarly dead since the header is always overwritten server-side.

---

## 4. Manual logging workflows (must stay AI-independent)

**Food:** `LogMealScreen` hub → `FoodEntry` modes `search`/`manual`/`repeat`/`recipes`; `IngredientSearch` (`GET /ingredients/search` — Humai catalog → USDA fallback); `QuickAdd` (local regex parse, water/weight); save path = `MealsContext` local write → outbox → `POST /food-logs`. **Server deps: `/food-logs` CRUD, `/ingredients/*`, `/summary`, `/daily-stats/*`, `/recipes/{search,:id/nutrition}` — all deterministic.**

**Exercise:** `LogExerciseScreen` — catalog search/filters, set entry → `POST /exercises`, `/exercises/:id/sets`, `/exercises/:id/finish` (`persistentExerciseStore` → `WorkoutSession`/`ExerciseSet`), local draft at `fitness.workoutDraft.v1`. **Server deps: `/exercises/*` + `/exercises/library/*` — all deterministic.**

**Shared infra that must never be flag-disabled:** `/auth/*`, `/me/profile`, `/daily-stats/water|steps`, `MealsContext` outbox sync, account-scoped AsyncStorage.

✅ **The architecture already satisfies spec §3 structurally** — manual paths never touch `aiProvider`. The risk is only *accidental* coupling introduced by broad flag application (e.g. gating `/voice/commands/execute` routes that share a screen with manual logging). The registry will mark `manual_food_logging`/`manual_exercise_logging` as `failOpen: true` and outside the AI kill group.

---

## 5. Auth, identity & storage (reuse points)

- **Sessions:** opaque bearer tokens (256-bit, SHA-256 at rest in `AuthSession`, 30-day TTL). `middleware/authenticate.js` sets `req.userId` and **overwrites `x-user-id`** → flags can safely target `req.userId`. No JWT.
- **RBAC:** 7 roles / 41 permissions; `requireRole`/`requirePermission`/`identifyUser` middleware pattern → `requireFeature` will mirror this.
- **Mobile token storage:** `expo-secure-store` ✅; AsyncStorage is account-scoped via `accountKey()` (`${userId}:${key}`) — the flag cache slots straight into this pattern, auto-clearing on logout/account-switch.
- **Refresh patterns already in the codebase to reuse:** `useFocusEffect` per screen, `AppState 'active'` resync (`App.tsx`, reminder-sync), `RolesContext` (fetch roles per account), `ProfileContext` revision tokens.

---

## 6. Secrets audit summary (full details → SECRETS_MANAGEMENT_AUDIT.md later)

| Finding | Severity |
|---|---|
| scrypt uses **Node default N=2¹⁴** — below OWASP (2¹⁷)/RFC 7914 (2¹⁵). Format has no param field → fix needs versioned hash or rehash-on-login | Medium |
| Backend `.gitignore` covers only `.env` — not `.env.*` variants (mobile does it right) | Medium |
| 8 env vars undocumented in `.env.example` (`YOUTUBE_API_KEY`, `CORS_ORIGINS`, `TRUST_PROXY_HOPS`, `API_RATE_LIMIT`, `ENABLE_API_DOCS`, `CHAT_DAILY_LIMIT`, `VOICE_TRANSCRIBE_MODEL`, `AUTH_TEST_BYPASS`) | Low |
| Provider keys in outbound query params (Spoonacular/USDA/YouTube) — API requirement, server-side only, never logged | Info |

✅ No hardcoded secrets, no JWT, morgan skips auth paths, session tokens hashed at rest, `verify-release.cjs` blocks `EXPO_PUBLIC_*` secrets, comprehensive session-revocation paths.

---

## 7. Environment variables inventory

**Secrets (🔒):** `DATABASE_URL`, `AUTH_LINK_SECRET`, `RESEND_API_KEY`, `OPENAI_API_KEY`, `SPOONACULAR_API_KEY`, `USDA_API_KEY`, `YOUTUBE_API_KEY`.
**Config:** `PORT`, `NODE_ENV`, `AI_ENABLED`, `AI_USER_DAILY_CALL_CAP/TOKEN_CAP`, `FOOD_AI_*`, `CHAT_DAILY_LIMIT`, `OPENAI_MODEL`, `VOICE_TRANSCRIBE_MODEL`, `AUTH_PUBLIC_URL`, `AUTH_EMAIL_FROM`, `CORS_ORIGINS`, `TRUST_PROXY_HOPS`, `API_RATE_LIMIT`, `ENABLE_API_DOCS`, `AUTH_TEST_BYPASS` (test-only, prod boot fails if set).
**Mobile public:** `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_BETA_SAFE_MODE`, `EXPO_PUBLIC_SUPPORT_EMAIL`, `EXPO_PUBLIC_PRIVACY_POLICY_URL`.

---

## 8. Gaps vs. requirements — what must be built

| Requirement | Status |
|---|---|
| Remote flag evaluation | ❌ Nothing exists |
| Config endpoint for mobile | ❌ No `/config` route at all |
| Backend per-feature enforcement | ❌ Only global `AI_ENABLED`; 2 call sites bypass it |
| Emergency AI kill switch | ⚠ `AI_ENABLED` is close but incomplete (label-scanner bypass, no UI propagation, requires redeploy) |
| User targeting / beta groups / % rollout | ❌ Nothing |
| PostHog integration | ❌ Not a dependency in either repo |
| Staging/prod isolation | ⚠ env-based only (separate Railway vars exist as pattern) |
| Manual-logging independence | ✅ Structurally true; must be preserved by flag scoping |
| Fail-closed expensive features | ⚠ Partial (503s exist but inconsistent) |
| Flag observability | ❌ Only morgan + console |
| `MANAGE_FEATURE_FLAGS` permission | ✅ Seeded, unimplemented |

**Migration classification:** `betaFeatures` is the only thing to "migrate" — it can be *kept* as a build-time kill gate (defense-in-depth: store builds still can't ship AI even if remote flag misfires) **ANDed** with the remote flag. All server endpoints can adopt `requireFeature` without schema changes.
