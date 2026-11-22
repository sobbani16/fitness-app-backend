# Phase 23 — Device Validation Closure

## Environment

- Attempted device: Android emulator `Pixel_8` (`emulator-5554`), sole AVD on host;
  no physical Android device present (`adb devices` shows emulator only).
- APK under test: `ac3c60de` (staging profile, Phase 21 build). New staging APK
  `fcc9a14b` queued this phase (sign-out fix + onboarding draft included).
- Backend under test: staging @ `4650908` (verified via deployment commitHash).

## Emulator reliability — observed this phase

The host's qemu/slirp NAT degraded repeatedly: **four cold-boot attempts**, network
healthy for minutes at most, then total outbound failure (`Network is unreachable`,
ping hangs, TCP dead). Verified NOT caused by PIA VPN this phase (PIA confirmed
Disconnected, zero utun tunnels, host DNS normal). One System-UI ANR dismissed;
one qemu process died entirely mid-session. Identical signature across Phases
21–23 → host-level emulator fault, not app/staging. Host connectivity to staging
remained 200 throughout every outage window.

## Flow results this phase

| # | Flow | Result | Evidence |
|---|---|---|---|
| 7 | Injury update via UI | **BLOCKED** — no device surface exists. `updateInjury()` exists in `src/api/activitySafety.ts` but no screen invokes it (SymptomHistory wires only `updateSymptom`). PATCH semantics verified live on staging (see staging-validation doc): 400/400/409/resolvedAt/invalidation/404/401 all PASS | HTTP + DB evidence, not device |
| 8 | Recommendation invalidation | **PARTIAL** — live staging proof: PATCH → `Recommendation.staleAt` set with `staleReason=injury_updated` (DB row inspected). On-device suppression rendering NOT TESTED | DB-verified server-side |
| 12 | Restart / stale advice | **NOT TESTED** — emulator NAT died before sign-in could complete (login screen rendered post-boot = app-launch evidence only) | `/tmp/emu-p23*.log`, screencap `/tmp/p23-app1.png` |
| 13 | Account switching | **NOT TESTED on new build** — requires the sign-out fix (`6f2868e`) which is only in build `fcc9a14b`; emulator down before install. Root-cause code-level verification: `signOut()` now clears local session regardless of `/auth/logout` result (11/11 unit tests incl. dead-token + offline + concurrent-login cases) | unit tests `accountLifecycle.test.ts` |
| 14 | Severe-weather presentation | **NOT TESTED** — cannot force NWS alerts; live card rendering requires healthy device window | — |
| 15 | Missing-weather info | **NOT TESTED** on-device; honest-unavailable state covered by `weatherContext.test.ts` | unit-tested |

## What was actually verified on-device this phase

- App launches to login screen after cold boot (screenshot evidence).
- Login failure state renders honest "Unable to continue" when the transport
  fails — no hang, no crash, no silent retry storm.

## Exact human steps to close flows 12–15

1. Use a **physical Android device** (the emulator NAT fault has persisted
   across three phases on this host) — install APK from build `fcc9a14b`.
2. If emulator must be used: cold-boot, verify `ping 8.8.8.8` inside guest
   BEFORE touching the app; if dead, recreate the AVD.
3. Flow 12: sign in → dashboard → swipe-close app → relaunch → verify no
   stale suggestion and injury-restricted suggestion persists.
4. Flow 13: sign in account A → Account → Sign out → SIGN OUT → verify login
   screen → sign in account B → verify none of A's data (name, injuries,
   suggestion) appears. This exercises the `6f2868e` fix.
5. Flow 14/15: observe the weather card under live NWS alert conditions, and
   with location permission revoked / weather endpoint unreachable.
6. Flow 7 remains BLOCKED until an injury-edit UI exists (product gap — flag
   for product owner, not a device-test issue).

## Builds

- `ac3c60de` — Phase 21 staging APK (validated through flow 6 then).
- `fcc9a14b` — Phase 23 staging build: adds onboarding draft persistence
  (`e27aab0`), dead-token sign-out fix (`6f2868e`), fiber Stage-1 work.
  Embeds `activity-safety-staging-staging.up.railway.app` + `staging` env
  marker only (eas.json staging profile verified).
