# Mobile E2E Acceptance — verified coverage

API-level (fitness_test, real app): registration/auth bypass parity, goal/profile (macroScore/healthScore suites), food search + manual logging (foodIntel/foodLogs), barcode scan→log (platformE2E journey 2 — real auth), portion/serving resolution (ingredientV5, voice), symptom CRUD + cross-user 404 (asyncScenarios.api), wearable ingest/dedup/trends/recovery/disconnect (platformE2E journey 3), progress/trends (unifiedProgress/trends), isolation + flags (nutritionReview/featureFlags).

Device-level (user's own passes): staging APK flows 1–6 PASS (login, weather, restriction-aware suggestion, injury record, suppression, pain feedback); Muscle Explorer device acceptance GO-conditional; maestro barcode/label/food-logging flows updated by owner.

Gaps honestly noted: flows 9–11,13–15 not device-verified (emulator fault); iOS staging build blocked on interactive creds; insufficient-data mobile paths verified at API level, not device.

## 2026-11-22 — device-level status
- Maestro flows updated by owner: `workout-verify.yaml` (search→log set→finish→restart persistence), `barcode-verify.yaml`. Device execution requires running simulators — **not executed in this session**; flows authored, not device-verified.
- Backend-verified mobile journeys: platformE2E 3/3 real-auth (register→goal→log→trend). Mobile unit suites pass in full runs.
- Owner edits this cycle: mass-vs-volume barcode logging (correct — refuses 1ml=1g fabrication), serving-declaration parser exported.
- Honest label: iOS/Android device E2E = flows ready, needs physical/simulator run by owner; backend E2E = green.
