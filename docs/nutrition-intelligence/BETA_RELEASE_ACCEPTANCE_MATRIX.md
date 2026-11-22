# Beta Release Acceptance Matrix

| Feature | Eng | Int tests | Data dep | Clinical dep | Sec/priv | Flag | Beta? | Blockers |
|---|---|---|---|---|---|---|---|---|
| Auth/onboarding | ✅ | platformE2E 3/3 | — | — | ✅ | on | **READY** | — |
| Food search + manual log | ✅ | green | catalog | — | ✅ | on | **READY** | — |
| Barcode logging | ✅ | E2E journey | catalog+label | — | ✅ | on | **READY** | — |
| Food classification + portion | ✅ | green | verifiedAt-gated | — | ✅ | on | **READY** | unverified batch invisible (correct) |
| Recipe + serving | ✅ | green | — | — | ✅ | on | **READY** | — |
| Provenance/dataGaps UI | ✅ | rendered | honest labels | — | ✅ | on | **READY** | — |
| Workout + wearable sync | ✅ | E2E journey | sources | — | ✅ | on | **READY** | — |
| Trends/progress | ✅ | green | — | — | ✅ | on | **READY** | — |
| Symptom CRUD | ✅ | API 7/7 | — | — | ✅ | on | **READY** | — |
| USDA source-backed profiles | ✅ | 782 rows | reviewer | — | ✅ RBAC | n/a | **PENDING** | human review of 40 |
| Fiber Intelligence (new) | owner-landed | fiber.* suites green | — | supplement path = MEDICAL | flag-gated | **ALL OFF** | **HOLD** | per-flag rollout decision |
| Condition personalization | gated | n/a | — | **CLINICAL** | ✅ | OFF | **DISABLED** | 8 packages awaiting review |
| Scenario matrix | 72/120 | — | — | reviewer fixtures | — | — | n/a | 7 fixture + 8 clinical |

**Beta gate:** general-wellness surface is engineering-ready; medical personalization + fiber-supplement pathway must stay OFF pending review; USDA profiles activate only via reviewer decisions.

## 2026-11-22 device-verification update

| Surface | iOS | Android | Evidence |
|---|---|---|---|
| Food logging (search→serving→save→persist→history) | **PASS** (device) | INFRA-BLOCKED | iOS: FoodLog `1795380822083-jgaa2o` 64 g 158 kcal + screenshots; Android: flow executes to search, emulator ANRs under host RAM (CI path ready) |
| Serving restoration on reopen | PASS | — | 2 slices restored verbatim; `repeatMeal.ts` + 8 tests |
| Keyboard dismissal | FIXED | — | iOS decimal-pad Done accessory; 22/22 tests |
| Backend stability | 2/4 clean (2 env-pressure flakes, zero 403-class) | n/a | seq20–23 durable JSON |
| USDA batch | 40 pending / 0 approved | n/a | reseed wipe found+fixed via `rematerialize-usda-preview.js` |
| Scenario reviews | 0/7 signed | — | owner action only |
| Medical/fiber-supplement/AI/voice | OFF | OFF | unchanged, no activation |

Owner actions: (1) Android — run `maestro/food-logging-verify-android.yaml` in
an uncontended window per ANDROID_DEVICE_ACCEPTANCE.md recipe, or trigger CI
`android-e2e.yml`; (2) sign 7 scenario reviews; (3) assign USDA reviewer +
grant `NUTRITION_DATA_REVIEW`.

## 2026-11-22 Android-CI update
Android food logging: local emulator path retired (host RAM < 0.5 GB → AVD
ANR; verified twice). `food-logging-verify-android.yaml` is CI-ready on
feat/pose-coaching-impl @ 75de24f (staging MILK fixture, env sign-in,
stylus defense). Execution awaits: repo secrets E2E_STAGING_* +
`gh workflow run android-e2e.yml` (see ANDROID_CI_E2E_REPORT.md).
