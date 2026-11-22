# Serving-state restoration — 2 slices / 64 g reopen

## Verdict: NOT a defect (verified 2026-11-22)

The reopened card shows:
- Source line "Copied from a saved meal — review before logging" (`Repeated meal`)
- Unit selector "1 slice (32 g)" — the UNIT label: grams per unit, not the count
- "Number of servings" field = **2** — the logged count, restored
- Calories 158, macros 8.3/26.2/2.7/4.5 — unchanged from the save

Evidence: `~/.maestro/tests/2026-11-22_155205/.../11-reopened.png` (count "2"
visible, calorie 158 visible) + `10-today-row.png` ("158 kcal · 64 g") +
`FoodLog 1795380822083-jgaa2o` (quantityG 64).

## How restoration works
Save stores `servingCount` + `selectedServing` + `servingId` on the
`LoggedMeal` (device row; the server `FoodLog` carries only `quantityG`).
On reopen, `repeatMealPreview()` (`src/services/repeatMeal.ts`, extracted
from `FoodEntryScreen.tsx` for testability):
- prefers `nutritionSnapshot.servingGrams` (synced rows), else derives
  grams-per-unit = quantityG / servingCount (64/2 → 32 g);
- rebuilds the unit as `snap:reopen` when no catalog `servingId` exists
  (barcode/label meals; `snap:` ids are stripped on save, never posted);
- restores `servingQty = String(servingCount)`.
Fallbacks: grams-only logs restore no household unit (field shows grams);
`quantityG` absent → Manual entry on a 100 g basis. No serving count is
invented when it was never stored.

## Regression tests
`src/services/__tests__/repeatMeal.test.ts` — 8 cases: count restoration,
no rescaling, snapshot priority, snap: unit, grams-only, zero count,
manual entry, missing-fiber preservation. 22/22 green with
`foodLoggingPortions.test.ts`.
