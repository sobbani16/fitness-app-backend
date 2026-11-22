# Android food-logging acceptance — status (2026-11-22)

## Status: BLOCKED — host infrastructure, NOT an app defect

Emulator: `emulator-5554` (Pixel_8, Android 17). App
`com.sobbani.fitnessappmobile` installed (staging-pointing build — its search
returns the staging catalog, e.g. "WH WH Blueberry BAGELS SLICED · USDA data",
not the dev-DB "Whole wheat bread, ready" fixture).

## Progress achieved this session
1. `MaestroDriverStartupException$AndroidDriverTimeoutException` → fixed by
   `adb kill-server && adb start-server` + `MAESTRO_DRIVER_STARTUP_TIMEOUT=240000`.
2. Full flow EXECUTED to the search step (launch → dashboard → Food tab →
   Search food → inputText) — driver remained stable for the whole run.
3. Real blocker found on-device: **Pixel_8 stylus-handwriting onboarding
   ("Try out your stylus") swallows `inputText`** — search field stayed empty,
   flow failed at the ingredient assert. Not an app defect; an emulator IME
   onboarding overlay.
4. Overlay dismissed via `adb shell input tap` on Cancel + `settings put
   secure stylus_handwriting_enabled 0`. Retried — driver then timed out
   again: `adb shell echo` alone takes ~5 s; host free RAM 0.08 GB with
   concurrent owner iOS Maestro sessions. Same ANR class the owner already
   documented for their own Android attempts.

## Android-adapted flow written (not yet passing)
`maestro/food-logging-verify-android.yaml` — staging catalog lacks the dev
bread fixture; uses first "WHOLE WHEAT" result (161 kcal/100 g, serving
"1 ONZ" = 28 g → qty 2 → 56 g → ~90 kcal). The per-100 g assert pins the
selected row. Same journey: unit → qty → grams → review → save → history.

## Rerun recipe (uncontended window or CI)
1. `adb kill-server && adb start-server`
2. `adb -s emulator-5554 shell settings put secure stylus_handwriting_enabled 0`
   (re-verify — may need re-applying after emulator restart)
3. `MAESTRO_DRIVER_STARTUP_TIMEOUT=240000 maestro test -p android \
    --device emulator-5554 maestro/food-logging-verify-android.yaml`
4. If the stylus overlay reappears mid-run: `adb shell input tap 535 2138`
   taps its Cancel button, then re-run.
5. Free host RAM first — below ~0.5 GB free the emulator ANRs and the
   driver times out regardless.

## Honest verdict
- Driver/flow mechanics: proven workable once (reach search).
- Backend persistence on Android: UNVERIFIED — the installed build targets
  staging; the staging account signed in on the emulator is owner-managed.
- Recommendation: use the owner's `.github/workflows/android-e2e.yml`
  (macos-14 runner, 3 GB AVD) — this host cannot sustain an emulator +
  concurrent iOS Maestro sessions.
