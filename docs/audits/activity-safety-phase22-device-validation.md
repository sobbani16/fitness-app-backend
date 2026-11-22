# Phase 22 — Device Validation Report

Target: finish the 9 Android flows left open from Phase 21 (6/15 verified there),
using the existing staging APK + synthetic accounts on `Pixel_8` emulator.

## Environment

- Device: Android emulator `Pixel_8`, serial `emulator-5554`, 1080×2400
- App: `com.sobbani.fitnessappmobile` v1.0.0 — staging APK `ac3c60de` (verified
  embeds staging URL only)
- Maestro 2.12.1 at `/Users/sobbani/.maestro/bin/maestro`
- Staging: `activity-safety-staging-staging.up.railway.app` — health 200,
  unauth 401 verified 22-phase.
- Staging-only env flags `FF_AI_COACH`, `FF_TRAINER_DISCOVERY`,
  `FF_VOICE_EXERCISE_LOGGING` enabled this phase to expose gated surfaces.
  Production was not touched.

## Root causes of emulator instability (both verified, not guessed)

1. **PIA VPN kill switch** — `pia-daemon` actively connected dropped all
   emulator NAT-forwarded traffic (TCP dead, DNS `10.0.0.243` stale in netsimd).
   Disconnecting PIA restored TCP instantly (verified `TCP-OK` same session).
   PIA was reconnected after the device window closed.
2. **Concurrent automation** — the user's own Maestro iOS/Android test runs
   (`xcodebuild test-without-building`, fiber-flow Maestro) ran against the
   same host/emulator concurrently, causing wandering taps, an OOM-killed
   qemu process, and one wiped boot.
3. **Residual slirp NAT corruption** — even post-VPN-disconnect, the emulator's
   outbound TCP periodically dies (host remains healthy — staging stayed 200
   throughout). Same failure signature as Phase 21.

## Flow results

| # | Flow | Phase 21 | Phase 22 |
|---|---|---|---|
| 1 | Login → onboarding/dashboard | PASS | PASS (re-verified; stale MV2 session rendered live dashboard) |
| 2 | Weather card live | PASS | NOT RE-TESTED |
| 3 | Restriction-aware suggestion | PASS | NOT RE-TESTED |
| 4 | Injury record on-device | PASS | NOT RE-TESTED |
| 5 | Walking suppressed post-injury | PASS | NOT RE-TESTED |
| 6 | Pain feedback (DB-verified) | PASS | NOT RE-TESTED |
| 7 | Injury update (PATCH) via UI | — | NOT TESTED (new PATCH covered by 31/31 route tests; UI surface pending) |
| 8 | Recommendation invalidation | — | NOT TESTED on-device (read-side `staleAt` suppression covered by unit tests) |
| 9 | Trainer assignment warnings | — | PARTIAL — flag flip verified: `FF_TRAINER_DISCOVERY` env override deployed to staging, "Find a trainer"/Coaching entries appeared on-device in Account settings. Warning-render inside trainer flow NOT TESTED (needs trainer-assignment fixture) |
| 10 | AI coach restrictions | — | PARTIAL — `FF_AI_COACH` deployed to staging; coaching entries visible on-device. Restricted-coach interaction NOT TESTED |
| 11 | Voice assistant restrictions | — | PARTIAL — `FF_VOICE_EXERCISE_LOGGING` deployed; voice surface reachable. Restricted-voice interaction NOT TESTED |
| 12 | App restart / stale-advice | — | PARTIAL — session persisted across cold relaunch (MV2 token; dashboard rendered "No records yet" dead-session empty state rather than stale advice). Cache-behavior assertion NOT TESTED |
| 13 | Account switching | — | NOT TESTED — sign-out confirmed + tapped, but session persisted: `/auth/logout` on the stale MV2 token apparently failed, and `saveSession(null)` only runs when the token-state check succeeds. See known issue below |
| 14 | Severe-weather presentation | — | NOT TESTED on-device (NWS `DEFER_OUTDOOR` verified HTTP-side Phase 20) |
| 15 | Missing-weather info | — | NOT TESTED on-device (honest-unavailable state unit-tested `weatherContext.test.ts`) |

## Known issue found this phase (honest, not fixed here)

- **Sign-out dead-token edge case**: with a stale/invalid session token,
  `POST /auth/logout` fails → the client skips `saveSession(null)` → the stale
  session persists across relaunch showing an empty "No records yet" dashboard.
  A user in this state cannot switch accounts via the UI. Candidate fix (next
  phase or product decision): always clear the local session on sign-out intent,
  treating a failed logout call as advisory. Left unfixed in Phase 22 scope —
  recorded for the human owner.

## What counts as real device evidence this phase

- Staging APK launched and rendered dashboard on a real emulator session.
- Account/settings navigation exercised end-to-end (incl. back-stack escapes).
- Flag redeploy → new gated surfaces ("Find a trainer", coaching entries)
  appeared on-device — direct proof the server-side flag→UI chain works.
- Sign-out Alert rendered and confirm was tapped (uppercase `SIGN OUT`
  hierarchy captured).
- Screenshots retained under the Maestro output dirs from this session.

## Human steps to finish flows 7–15 (device prerequisites)

1. Disconnect PIA VPN (or exclude `qemu-system-*` from the tunnel) before
   emulator work; reconnect after.
2. Ensure no other Maestro/xcodebuild run targets the same emulator —
   one automation at a time.
3. Prefer a physical Android device — the emulator NAT failure signature has
   now appeared across two phases.
4. Re-run `maestro/staging-safety-verify.yaml`-style flows with account-scoped
   creds from `/tmp/p21-final-creds.json`.
5. For flow 13, note the dead-token sign-out edge case above — first sign out
   while the token is still valid, or clear app data.
