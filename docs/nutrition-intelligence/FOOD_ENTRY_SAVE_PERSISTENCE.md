# Save persistence — summary
The "Save meal" tap never reached the button — keyboard overlay absorbed it; no API request was constructed (verified: no foodLog row created). Fixes: Keyboard.dismiss() at save start; portion bounds enforced pre-payload; duplicate-save lock (savingLock) already present and preserved.

## 2026-11-22 — PERSISTED (device + DB evidence)

Save failure root cause: iOS numeric pads lack a dismiss affordance; taps
outside ScrollView don't dismiss → pad occluded review/Save → onSave never
ran → zero backend rows. Fixed via `InputAccessoryView` Done bar on all six
numeric TextInputs + existing `Keyboard.dismiss()` + savingLock + pendingMeal
retry preserved. iOS run 15:53:42Z persisted `FoodLog 1795380822083-jgaa2o`
(64 g · 158 kcal · 8.3/26.2/2.7/4.5 g) and history round-trip verified.
