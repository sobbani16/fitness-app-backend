# Feature Flag Implementation Plan

**Status:** Stage 1 deliverable — awaiting approval before any code changes.
**Depends on:** `FEATURE_FLAG_ARCHITECTURE_AUDIT.md` (same directory)

---

## 1. Architecture overview

```
                 ┌────────────── PostHog Cloud (admin UX: flags, cohorts, % rollout, audit log)
                 │                        ▲ evaluates per distinct_id = userId
┌────────────────┴─────────────────────────────────────────────────────────┐
│ BACKEND  src/services/featureFlags/                                      │
│  ├─ registry.js        typed keys, classes, deps, defaults, kill-group   │
│  ├─ provider.js        PostHog adapter (+ env/static fallback provider)  │
│  ├─ evaluator.js       precedence engine + bounded cache (≤60s TTL)      │
│  └─ service.js         FeatureFlagService public API                     │
│  ├─ routes/config.js   GET /config/features (per-user map)               │
│  └─ middleware/requireFeature.js  → 403 FEATURE_DISABLED                 │
│  env backstop: AI_EMERGENCY_SHUTDOWN=true (works with PostHog down)      │
└──────────────────────────────────────────────────────────────────────────┘
                 │ one authenticated JSON blob
┌────────────────▼─────────────────────────────────────────────────────────┐
│ MOBILE                                                                   │
│  api/config.ts → storage/featureConfig.ts (accountKey'd AsyncStorage)    │
│  context/FeatureFlagsContext → useFeatureFlags() + <FeatureGate>         │
│  refresh: startup · login · foreground · interval(60s+jitter, backoff)   │
│  effective = buildGate(betaFeatures) AND remoteFlag AND appVersionGate   │
└──────────────────────────────────────────────────────────────────────────┘
```

**Key decision — PostHog behind an abstraction:** admin UX (targeting, % rollout, history) comes from PostHog dashboard; all evaluation happens **in our backend** so the mobile app never sees PostHog keys and a provider outage degrades to cached/env defaults. `posthog-node` supports local evaluation or simple flag fetch — we cache the *resolved* per-user result, not the SDK, in `evaluator.js`.

**Kill switch is dual-channel:**
1. `ai_emergency_shutdown` PostHog flag → propagates ≤ flag-cache TTL (≤60s server, ≤ refresh interval client)
2. `AI_EMERGENCY_SHUTDOWN=true` Railway var → restart → immediate, works even if PostHog is down or misconfigured. **This is the guaranteed backstop.**

Both are checked at the *service* layer (`FeatureFlagService.isAiShutdown()`), which `aiProvider.askJSON` will consult — one choke point covers every compliant AI caller.

---

## 2. Flag precedence (deterministic, evaluated in evaluator.js)

1. `AI_EMERGENCY_SHUTDOWN` env → all `group: 'ai'` flags = false
2. `ai_emergency_shutdown` provider flag → all `group: 'ai'` flags = false
3. Explicit global disable (PostHog flag "off" state)
4. Environment restriction (`environments: ['production']` etc. in registry)
5. User/beta-group targeting (PostHog cohorts/person properties; `userId` as distinct_id)
6. Percentage rollout (PostHog consistent-hash — stable per user)
7. Feature dependencies (`dependsOn` — dep off ⇒ flag off)
8. Default: registry `default: false` (fail-closed) for `costly|ai|experimental`; `failOpen: true` only for `manual_*` core flags

**User overrides can never bypass 1–3.** Cached values never outlive `cacheTtlMs` (default 60s).

---

## 3. Registry preview (full file → `FEATURE_FLAG_REGISTRY.md` in Stage 2)

| Key | Class | Server endpoints gated | AI kill-group | Initial | Fail mode |
|---|---|---|---|---|---|
| `manual_food_logging` | core/manual | — (documents `/food-logs`, `/ingredients`, `/summary`, `/daily-stats`, `/recipes`) | **NO** | on | fail-open |
| `manual_exercise_logging` | core/manual | — (`/exercises/*`) | **NO** | on | fail-open |
| `food_photo_scanning` | ai | `POST /meals/detect`, `/meals/analyze` | YES | beta | closed |
| `nutrition_label_scanning` | mixed | `POST /label-scanner/extract` only (OCR/classify/save stay manual-capable) | partial (extract only) | beta | degrade: regex fallback |
| `menu_scanning` | mixed | `POST /menu-analysis`, `/label-scanner/menu` | partial (AI extraction) | beta | degrade |
| `ai_coach` | ai | `POST /chat`, `GET /chat/status` | YES | off-beta | closed |
| `ai_workout_recommendations` | ai | `POST /personal-plans/draft` | YES | off-beta | closed |
| `ai_food_recommendations` | ai | none today (current recs are deterministic — audit §2) | YES | off-beta | closed |
| `voice_food_logging` | ai-assisted | `POST /voice/transcribe`, `/voice/interpret` | YES | internal | degrade: type-instead |
| `voice_exercise_logging` | ai-assisted | same endpoints (shared `voice_logging` gate at API level) | YES | internal | degrade |
| `pose_detection` | on-device-ml | none | **NO** (spec §10) | beta | local |
| `weekly_meal_plans` | mixed | `router.use` on `/weekly-plan/*`; `/generate` degrades to deterministic | partial (AI gen → fallback) | beta | degrade |
| `apple_health_sync` | server | `/health-data/*` | NO | beta | closed |
| `android_health_sync` | server | `/health-data/*` | NO | beta | closed |
| `trainer_dashboard` | server+rbac | `/trainers/*` (RBAC still required) | NO | off | closed |
| `smart_reminder_suggestions` | server-deterministic | `/reminders/suggestions*` only | NO | on | open |
| `supplements` | server | `/supplements/*` | NO | beta | closed |
| `video_search` | server | `/videos/*` | NO | off (orphaned — recommend remove instead) | closed |
| `ai_emergency_shutdown` | control | — | — | off | — |

---

## 4. `GET /config/features` contract

```json
{
  "configVersion": "2026-03-10.1",
  "refreshAfterSeconds": 60,
  "features": { "foodPhotoScanning": true, "aiCoach": false, "...": true }
}
```

- Mounted **after** `authenticate` + `requireVerifiedEmail` in `app.js` (same chain as all routers — identity from session only).
- `Cache-Control: private, max-age=30` — shared caches can't serve another user's flags; `configVersion` lets clients cheaply no-op.
- Unknown keys never emitted; clients treat missing keys as registry-safe defaults.
- Emits **booleans only** — no rules, cohorts, or PostHog internals.
- Rate-limited by existing global limiter; response ≤1KB.

## 5. Backend enforcement

- `middleware/requireFeature('aiCoach')` → `FeatureFlagService` → `403 { error: { code: 'FEATURE_DISABLED', message: 'This feature is temporarily unavailable.' } }` (extends existing `httpError`/`code` shape — e.g. `EMAIL_NOT_VERIFIED` already uses `code`).
- Applied per spec's enforcement matrix (§3 above) — e.g. `router.use('/weekly-plan', requireFeature('weeklyMealPlans'))`, `labelScanner.js:26` `requireFeature('nutritionLabelScanning')` on the AI path only.
- `aiProvider.askJSON` consults `isAiShutdown()` first → uniform `FEATURE_DISABLED` 503 for every AI call site.
- **Gate-gap fixes (required for kill switch to be real):**
  1. `labelScannerService.js` — route extraction through `askJSON` or add flag check
  2. `voice.js:54` — add key-presence 503 + quota parity
  3. `meals.js:10` — check flag before consuming food quota
- Graceful-degradation endpoints keep their fallbacks: kill switch ON ⇒ `/weekly-plan/generate` → deterministic plan; `/voice/interpret` → parser-only; `/menu-analysis` → OCR-only. UI copy explains reduced capability.

## 6. Mobile integration

- `FeatureFlagsContext` (mirrors `RolesContext`): `{ flags, isEnabled(key), isLoading, refresh() }`; cache in `featureConfig.ts` via `accountKey` → auto-clears on logout/switch.
- Fetch triggers: provider mount (post-auth), `AppState → active`, `setInterval(refreshAfterSeconds + jitter)`, exponential backoff on 5xx/network fail; last-known-good cache on offline; **never blocks app render**.
- `<FeatureGate feature="aiCoach" fallback={<DisabledNotice/>}>` for components; route gating via a `withFeatureGate` wrapper so disabled screens render an "unavailable" card instead of mounting — handles users mid-session + notification deep-links (`navigateToTab` allowlist already constrains targets).
- Replaces `betaFeatures.*` reads at the 12 audited sites; keeps `betaSafeMode` as the **build-time AND gate** (TestFlight can't light up AI regardless of remote config).
- Voice FAB in `App.tsx` → gated by `voice_food_logging || voice_exercise_logging` (either enables it; active context decides which).

## 7. Testing plan summary (full → `FEATURE_FLAG_TEST_PLAN.md`, Stage 2)

- **Backend unit:** precedence engine matrix, evaluator cache TTL/expiry, `requireFeature` 403 shape, kill-switch overrides user targeting, provider-outage fail modes.
- **Backend integration:** endpoint × flag matrix (esp. `/meals/detect`, `/chat`, `/label-scanner/extract`, `/voice/transcribe`, `/personal-plans/draft`), quota-not-consumed-when-disabled, `GET /config/features` per-user isolation + cache headers.
- **Mobile (jest + existing screen tests):** gate hides/shows entries, disabled-route fallback, refresh-on-foreground, account-switch cache isolation, offline last-known-good, `betaSafeMode` AND-behavior.
- **Mandatory regression (spec §16):** Tests A–F run against staging with a synthetic account — AI all off / provider down / kill switch / reactivation / data integrity / shared screens.
- **Propagation test:** flip flag → measure backend 403 latency (expect ≤60s) and mobile UI latency (expect ≤ refresh interval + fetch).

## 8. Rollback strategy

- Flag system fails open for `manual_*`, closed for AI — worst case = features stay as today.
- `FF_PROVIDER_DISABLED=true` env → serve registry defaults, bypass PostHog entirely (instant rollback without deploy).
- Remove `/config` mount → mobile falls back to cached then registry defaults (manual on, AI off).
- Git revert is safe — flag code is additive; no migrations required for PostHog path. *(Only needed if we add a local `FeatureFlagOverride` table — deferred/optional.)*
- Kill switch rollback: set flag off / unset env → features restore ≤60s.

## 9. Secrets

- Add `POSTHOG_API_KEY` (server-only env), `POSTHOG_HOST` to Railway vars + `.env.example` docs. Never `EXPO_PUBLIC_` — `verify-release.cjs` already guards.
- Bundle flagged fixes from secrets audit: backend `.gitignore` `.env.*`, document missing env vars. scrypt params upgrade = **separate approval** (touches auth).

## 10. Decisions (approved 2026-03-10)

1. **PostHog Cloud free tier** — managed, ~1M flag requests/mo covers closed beta. Requires user to create the PostHog project + server-side API key (deliverable: set `POSTHOG_API_KEY`/`POSTHOG_HOST` Railway vars).
2. **PostHog targeting only** — no local `FeatureFlagOverride` table; all targeting/rollout rules live in PostHog dashboard.
3. **Orphaned screens** (`VideoSearch`, `VideoCompare`, `MacroDetail`, `VideosScreen`, `ExerciseCreateScreen`) — **flag them off** (registry `video_search: off`, plus `off` flags on dead mobile code paths), don't delete.
4. **scrypt upgrade** — **separate PR later**, not bundled with flag work.
5. **Staging environment** — TBD by user (staging Railway service vs prod-only; flag config supports either via separate PostHog env/vars).

---

*Stage 2 begins on approval + receipt of PostHog credentials.*
