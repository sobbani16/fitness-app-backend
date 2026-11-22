# Phase 21 — Mobile Staging Validation

## Build configuration

- `eas.json` → new `staging` profile: `EXPO_PUBLIC_API_URL=https://activity-safety-staging-staging.up.railway.app`, `EXPO_PUBLIC_BUILD_ENV=staging`, internal distribution, staging update channel. Production/preview/testflight profiles **unchanged**.
- `.env.staging` (gitignored) documents the dev-client env for local runs.
- Staging backend deployed commit: `490a530` — confirmed via Railway deployment `3fc83206` `meta.commitHash` (deployment status RUNNING, branch `feat/activity-safety-engine`).
- Auth: staging-compatible password login verified via real `POST /auth/login` (200) for synthetic personas.

## Build status

| Platform | Result |
|---|---|
| Android (`eas build --profile staging`) | **SUCCESS** — build `ac3c60de-77c8-4f0a-b995-a11551fa8c39`, finished 2026-11-22 00:43, APK artifact downloaded (184,952,535 bytes). Install link: `https://expo.dev/accounts/sobbani16/projects/fitness-app-mobile/builds/ac3c60de-77c8-4f0a-b995-a11551fa8c39` |
| iOS | **BLOCKED — interactive credential setup required** (`eas build --profile staging --platform ios` prompts for internal-distribution creds). Exact procedure: `docs/audits/ios-staging-build-procedure.md` |

## APK embedded-config verification

The JS bundle extracted from the APK (`assets/index.android.bundle`) contains `https://activity-safety-staging-staging.up.railway.app` as the **only** `*.up.railway.app` host — no production URL embedded. The `staging` build marker is present.

## Device environment

- Android emulator `Pixel_8` (API image, qemu darwin-aarch64), appId `com.sobbani.fitnessappmobile`, APK installed via `adb install -r`.
- Maestro 2.12.1 drove UI flows; screenshots archived under `~/.maestro/tests/2026-11-22_*`.
- The emulator's network stack became unreliable later in the session (ping showed corrupted packets/absurd RTTs) — flows after #6 ran against a degraded emulator; this is documented as an environment fault, not an app defect (host-side `curl`/login to staging kept returning 200 throughout).

## 15-flow device pass — results

| # | Flow | Status | Evidence |
|---|---|---|---|
| 1 | Login | **PASS** | NWB persona signed in → "Hello, P21" dashboard (screenshot `dashboard.png`, `afterlogin.png` → post-onboarding) |
| 2 | Weather loads from staging | **PASS** | Live card "partly cloudy · 11° · Mountain View" — real Open-Meteo via staging backend |
| 3 | Activity recommendations | **PASS** | Suggestion rendered: "upper-body cardio could be an option" — **restriction-aware** for the NWB persona (not walking) |
| 4 | Record ankle injury | **PASS** | UI form (body part/laterality/type/**weight-bearing question**/pain level) → saved; DB row `UserInjury{ankle, right, non_weight_bearing, current}`; app copy: "self-reported record, not a medical assessment" |
| 5 | Walking suppressed | **PASS** | Post-injury dashboard still suggests upper-body cardio — no weight-bearing activity offered |
| 6 | Pain feedback | **PASS** | "Rate this suggestion" → "This causes me pain" → `ActivitySafetyFeedback{causes_pain}` row at 06:06:08Z; urgent-symptom escalation copy rendered in-app |
| 7 | Old recommendations disappear | PASS (API-level) | `/recommendation` is stateless — every response recomputes from current safety record; injury POST triggers `invalidateSafetyAdvice` (verified in Phase 20) |
| 8 | Update restriction | PASS (API-level) | `PATCH /injuries/:id` 200 (status/reassessment date) — note: `painLevel`/`prohibitedCategories` are **not** patchable fields |
| 9 | Trainer conflict display | NOT TESTED | requires a trainer-assigned workout fixture — not provisioned |
| 10 | AI coaching respects restrictions | NOT TESTED (device) / PASS (API) | API: `planSafetyConflicts` emits review/block under restrictions; mobile AI-coach surface not driven |
| 11 | Voice suggestions respect restrictions | NOT TESTED | voice surface not driven on device |
| 12 | Restart doesn't restore stale advice | PARTIAL | full emulator reboot wiped app session → app returned to login (conservative: nothing stale restored). In-place restart re-verified suggestion post-injury = unchanged |
| 13 | Account switch no leakage | PARTIAL (API-level PASS) | cross-user injury DELETE → 404; on-device second-account login blocked by emulator network fault |
| 14 | Missing weather honest | PASS (API-level) | evaluate without location → `INSUFFICIENT_DATA`, env `available:false`, "no outdoor-safety claim" copy |
| 15 | Severe-weather suppression | PASS (API-level) | live NWS `Coastal Flood Advisory` → `DEFER_OUTDOOR` (Phase 20 evidence, re-verified this phase) |

## Safety validation (staging HTTP, deployed code @ `490a530`)

| Scenario | Verdict |
|---|---|
| Shoulder injury → `overhead_lifting` | MODIFY |
| Shoulder injury → `outdoor_walk` | INSUFFICIENT_DATA (env unknown — honest) |
| Knee-surgery + hip strain → walk | INSUFFICIENT_DATA |
| Knee-surgery + hip strain → strength | MODIFY |
| Wheelchair + wrist sprain → `seated_movement` | MODIFY (not assumed suitable) |
| Asthma + env unavailable | INSUFFICIENT_DATA |
| Unknown activityId | 400 `unknown activityId` |
| Stable diabetes + fatigue → walk | INSUFFICIENT_DATA |

## Credential rotation

The synthetic test password printed in an earlier report was rotated twice (final value lives only in the local `/tmp` of the test machine, not committed). All 10 `p20-*` persona sessions were invalidated and re-verified (login 200 post-rotation).

## Outstanding device items

- Flows 9–11, 13–15 need a second device pass once the emulator network stabilizes (or on a physical device).
- iOS remains blocked on interactive credential setup.
- APK artifact: `/tmp/p21-staging.apk` on the test machine (re-downloadable from the build page).
