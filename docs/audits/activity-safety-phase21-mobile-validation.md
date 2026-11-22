# Phase 21 — Mobile Staging Validation

## Build configuration

- `eas.json` → new `staging` profile: `EXPO_PUBLIC_API_URL=https://activity-safety-staging-staging.up.railway.app`, `EXPO_PUBLIC_BUILD_ENV=staging`, internal distribution, staging update channel. Production/preview/testflight profiles **unchanged**.
- `.env.staging` (gitignored) documents the dev-client env for local runs.
- Staging backend deployed commit: `490a530` (redeployed from `dcd6d26` after user's landed commits; same feature branch).
- Auth: staging-compatible password login verified — `p20-healthy-1795324059455@staging.test` signs in, returns `{token, expiresAt, user}`.

## Build status

| Platform | Result |
|---|---|
| Android (`eas build --profile staging`) | **build `ac3c60de` — queued/in progress at report time**; APK install link will appear on completion; remote credentials fine |
| iOS | **BLOCKED — interactive credential setup required** (`eas build --profile staging --platform ios` prompts for internal-distribution creds; human must run interactively) |

## Real device evidence

- **NOT TESTED on-device** — the installed simulator app is a store/preview build (embedded bundle pointing at production); it cannot retarget to staging. Awaiting the staging-profile build artifact.
- Verified on the simulator (independent of backend): the installed build connects and loads — but that session is the user's production account; **no staging mobile flow has run**.

## Safety validation that DID complete (staging HTTP, real deployed code)

From the Step-4 scenario matrix against `activity-safety-staging` @ `490a530`:

| Scenario | Verdict | Assessment |
|---|---|---|
| Shoulder injury → `overhead_lifting` | MODIFY | proportional, not blanket-block |
| Shoulder injury → `outdoor_walk` | INSUFFICIENT_DATA | env unknown — honest |
| Knee-surgery PWB + hip strain → walk | INSUFFICIENT_DATA | missing env dominates |
| Knee-surgery + hip strain → strength | MODIFY | multi-factor |
| Wheelchair + wrist sprain → `seated_movement` | MODIFY | **not assumed suitable** (Scenario E) |
| Asthma + env unavailable | INSUFFICIENT_DATA + env `unknown` | no invented safety (Scenario C) |
| Unknown activityId | 400 `unknown activityId` | no unqualified allow |
| Stable diabetes + fatigue → walk | INSUFFICIENT_DATA | fatigue doesn't blanket-prohibit |

## What remains for the device pass (once APK installs)

15-flow list from the phase brief: sign-in → weather → recommendations → injury → suppression → feedback → stale-clearance → restriction update → trainer conflict → AI coach → voice → restart persistence → account switch → honest-weather-UI → severe-alert suppression. Personas + password (`StagingTest-P21!`) are already provisioned on the staging DB for exactly this.
