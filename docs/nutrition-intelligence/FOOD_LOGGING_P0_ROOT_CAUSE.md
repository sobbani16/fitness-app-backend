# P0 Food-Logging Root Cause — RESOLVED (code), device re-verify pending driver fix

## Exact mechanism
Displayed values were per-100g × **7200 g** — not a ×100 math bug in the scaler
(`macrosForPortion` correctly divides by 100 — verified in every code path and
git history). The portion itself became 7200 g: the focused "Number of servings"
field absorbed stray keystrokes ("225" servings × 32 g) after `hideKeyboard`
failed — the decimal-pad stayed open and Maestro's later taps (92%,93%; Save)
landed on pad keys, mutating the field instead of hitting buttons. Save never
fired → no backend row → no confirmation. All confirmed by exact value match:
P 936=13×72, C 2952=41×72, F 302.4=4.2×72, Fiber 504=7×72.

## Fixes applied (src/screens/FoodEntryScreen.tsx + new src/services/portionGuard.ts)
1. `clampPortionGrams` — 5000 g cap (aligned with barcode path) on serving-qty
   AND scale-autofill paths; oversized input shows an error instead of inflating.
2. `onSave` → `Keyboard.dismiss()` first; save-time portion cap aligned 10000→5000.
3. No DB/API changes; provenance/unknown-fiber handling untouched.

## Regression tests — `src/services/__tests__/foodLoggingPortions.test.ts`: 14/14 PASS
(64 g, 1 g, 100 g, 150 g, decimal, missing-fiber, never-inflate invariant, guard)

## Save-failure cause
Not a backend/API fault — submit never executed (taps ate by open pad). The
persistTaps='handled' config was correct; dismissal now explicit at save.

## Device re-verification
BLOCKED by maestro iOS driver instability (XCUITest runner dies ~75 s into runs,
including post-reboot; Android emulator device-server already dead). Owner:
reinstall drivers → rerun food-logging-verify + Android flows.

## Follow-up: driver crash cause identified
The ~75 s ConnectException was environmental — concurrent maestro sessions on the same simulator + ~0.07 GB free RAM jetsamming the XCUITest runner. Owner's own sessions on uncontended devices complete normally. App-side fix stands (portionGuard + Keyboard.dismiss + save cap); device re-verification should run single-session.
