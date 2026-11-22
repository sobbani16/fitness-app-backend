# Maestro Device E2E Report — 2026-11-22

## Environment
- iOS: iPhone 17 Pro sim (ACA24B39, iOS 26.4), app `com.sobbani.fitnessappmobile` installed, API `localhost:4000` (dev backend)
- Android: emulator-5554 (Pixel_8) — **BLOCKED: Maestro device-server died** (`DeviceServerDiedException: UNAVAILABLE`); needs emulator restart / driver reinstall before flows can run

## iOS results

| Flow | Result | Evidence |
|---|---|---|
| dismiss | PASS | full run, screenshot captured |
| auth-cycle-verify | PASS (interrupted run completed steps) | debug dir 2026-11-22_131914 |
| food-logging-verify | **FAIL — real finding** | debug dir 2026-11-22_132100 |

### Device-verified defect (food-logging)
Search → "Whole wheat bread, ready" → serving sheet (1 slice 32g → 2 servings = 64g) → Log food → nutrient card showed **×100-inflated values**: protein 936, carbs 2952, fat 302.4, fiber 504 (correct ≈9.36/29.52/3.02/5.04 — all exactly per100g×grams without /100). Keyboard failed to dismiss (hideKeyboard WARNED); `Save meal` tapped but **no log row reached the backend** and "Saved on this device" never appeared. Owner action required on `src/screens/FoodEntryScreen.tsx` display/scale path (all paths via `macrosForPortion` divide correctly — a different writer produced the values).

## 2026-11-22 PM — driver diagnosis: resource contention, not a driver defect

### iOS ConnectException (~75 s in) — root cause
- **Concurrent Maestro sessions on the same simulator.** During my runs, the owner was simultaneously running `maestro test` on BOTH iPhone 17 Pro (ACA24B39) and iPhone 17 (0AF4D2A8) — two XCUITest driver instances + two xcodebuild + two maestro JVMs competing; my session on ACA24B39 collided directly.
- **Severe memory pressure:** `vm_stat` free ≈ 0.07 GB with 2 sims + 2 Metros + 2 xcodebuilds + emulator — iOS jetsams the runner app mid-flow.
- Evidence the driver is healthy: the owner's own single-session runs proceed past the 75 s window and complete (recent dirs show runs finishing, incl. some test-level FAILEDs — those are app results, not driver crashes).

### Android `DeviceServerDiedException`
Same memory pressure — the emulator competes for the same exhausted RAM. Retry requires: close one sim session, free RAM, `adb reconnect`, single-session flow.

### Recommendation
Run ONE Maestro session per device at a time; keep either iOS-only or Android-only; close unused sims/Metro; rerun `food-logging-verify.yaml` under a clean single session. My code fix (portionGuard + Keyboard.dismiss) is already in the bundle Metro serves.

## Pending owner-run — single-session command
```
cd fitness-app-mobile && maestro test --device <free-sim-udid> maestro/food-logging-verify.yaml
```
Expected post-fix: 2 slices → "= 64 g total" → protein ≈8.3 g / carbs ≈26.2 g / fat ≈2.7 g / fiber ≈4.5 g (dev-DB per100 13/41/4.2/7; if the bundle's backend returns the staging per100 14.625/46.125/4.725/7.875 the expected display is 9.4/29.5/3.0/5.0 — mission's quoted values) → keyboard dismisses at save → meal persists.
NOTE: mission's expected numbers (9.36/29.52/3.02/5.04) correspond to a per100g of 14.625/46.125/4.725/7.875 — dev DB holds 13/41/4.2/7 for "Whole wheat bread, ready". Whichever backend the app resolves, the invariant is per100 × 64/100 — verify against the shown "Per 100 g" line.

## 2026-11-22 PM2 — driver investigation: two distinct causes found
1. **Competing runner launches:** sim log shows `SBWorkspaceTerminateApplication ... "terminate for debugging launch request"` — stale `xcodebuild test-without-building` sessions relaunch the runner and force-quit the live one mid-flow (ConnectException). Killed all stale sessions.
2. **Deterministic death at 45 s optional Email wait:** after the stale-launch fix, one run progressed ~95 % (through review checkbox — the deepest observed). Subsequent runs die consistently at the 45 s `extendedWaitUntil "Email"` — shortened to 12 s in the yaml.
3. Deepest observed progress: search → bread → 1 slice 32 g → 2 → "= 64 g total" → Log food → Save meal scroll → review checkbox — all COMPLETED on-device; only the final save-confirmation assert was not reached before the runner died.
4. Blockers remaining: owner maestro sessions resumed on both sims; RAM recovered to 48% free but contention persists. Code fix is in the served bundle — any clean single-session run verifies it.

## 2026-11-22 15:53 — food-logging-verify iOS PASS (P0 closed on iOS)

Device: iPhone 17 Pro, iOS 26.4, dev backend :4000, synthetic `fl-device-verify@syn.local`.

**Final keyboard root cause (real app defect, not Maestro):** iOS `decimal-pad`/`number-pad` have no return key and taps outside the ScrollView never dismiss it (`keyboardShouldPersistTaps` only governs taps *inside*). The pad stayed open through the whole card, physically occluded the review gate + Save button, and every "Save meal" tap landed on pad keys — corrupting the focused servings field (2 → 22 → 704 g) and preventing `onSave` from ever firing. **Fix:** shared `InputAccessoryView` "Done" bar (`KB_DONE_ID`) on all six numeric inputs in `FoodEntryScreen.tsx` + flow taps `Done` when visible.

**Run evidence:** `~/.maestro/tests/2026-11-22_155205/` — all steps COMPLETED.
- 07-two-slices.png: servings 2, "= 64 g total", 158 kcal, fiber 4.5, protein 8.3, carbs 26.2; Done accessory visible bottom-right.
- 09-saved: "Saved on this device" alert asserted.
- 10-today-row.png: row "Whole wheat bread, ready — 158 kcal · 64 g".
- 11-reopened.png: "Serving size: 1 slice" restored.

**Backend row:** `FoodLog.id = 1795380822083-jgaa2o`, loggedAt 20:53:42 UTC —
64 g · 158 kcal · P 8.3 · C 26.2 · F 2.7 · fiber 4.5 — exactly per100(247/13/41/4.2/7)×0.64.

Android: unchanged INFRA-BLOCKED (host RAM; owner has CI workflow configured).

## 2026-11-22 PM3 — serving-restoration audit + Android status
- "Serving size: 1 slice" on reopen: **not a defect** — unit label (grams/unit);
  "Number of servings" restores 2, calories 158, "= 64 g" — see
  FOOD_ENTRY_SERVING_RESTORATION.md. Hydration extracted to
  `src/services/repeatMeal.ts` + 8 regression tests (22/22 green total).
- Android: emulator-5554 booted + adb-responsive, but owner maestro sessions +
  0.06 GB free RAM keep it INFRA-BLOCKED; background watcher armed to run
  food-logging-verify the moment a window opens. Owner CI path exists
  (.github/workflows/android-e2e.yml).

## 2026-11-22 PM4 — Android session result (see ANDROID_DEVICE_ACCEPTANCE.md)
- Driver-startup fix found: adb-server restart + MAESTRO_DRIVER_STARTUP_TIMEOUT.
- One real run executed to search step; new blocker: Pixel_8 stylus
  onboarding overlay swallows inputText (emulator IME, not app).
- Staging-pointing build → dev bread fixture absent → Android yaml written
  against staging "WHOLE WHEAT" fixture (161 kcal, 1 ONZ×2 → 56 g).
- Emulator degrades (adb ~5 s/echo) under host RAM ~0.08 GB + owner iOS
  sessions → driver re-timeouts. Verdict: INFRA-BLOCKED locally; CI is path.

## 2026-11-22 PM5 — Android moved to CI
Local emulator attempts stopped (host-RAM ANR class confirmed twice more).
Android yaml hardened for CI: staging MILK fixture (verified via API),
env sign-in, stylus-onboarding defense. Pushed on feat/pose-coaching-impl
(75de24f). Awaiting owner `gh workflow run` + secrets. See ANDROID_CI_E2E_REPORT.md.
