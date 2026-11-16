# Platform expansion — Mind & Habits, Food Intelligence, Wearables

## Architecture

| Module | Routes | Service | Models | Flags (PostHog, project 701405) |
|---|---|---|---|---|
| Mind & Habits | `/mind/*` | `services/mind.js` | EmotionalCheckIn, UserMindPreferences, MindExerciseCompletion | mind_habits_enabled (100%), mind_emotional_checkins_enabled, mind_learning_enabled, mind_behavioral_insights_enabled; mind_ai_coaching_enabled OFF |
| Food Intelligence | `/food-intel/*` | `services/foodIntel.js` | BarcodeProduct, IngredientEvidenceProfile | food_intelligence_enabled, food_barcode_scanning_enabled, ingredient_evidence_enabled (100%); visual_food_recognition_enabled, apple_foundation_models_enabled OFF |
| Wearables | `/health-sources/*` | `services/healthSources.js` | WearableDevice, HealthDataSource, HealthMeasurement, HealthSyncCursor, HealthMetricSummary | wearable_platform_enabled, health_data_sources_enabled, wearable_recovery_insights_enabled (100%); humai_band_enabled, wearable_internal_testing_enabled OFF |

## Safety contract (enforced, not aspirational)
- Journals: private; `aiJournalConsent` + `checkinSharingConsent` are separate booleans on UserMindPreferences; `/mind/leo` is deterministic and never reads journals.
- Insights: min 10 observations, `causal:false`, sampleSize always shown; INSUFFICIENT below threshold.
- Suitability: hard exclusions (allergy via `keywordsFor`, dietaryRestrictions via `RESTRICTION_KEYWORDS`, NEVER_RECOMMEND, clinician meat exclusions) always win; unknown composition → `verdict:unknown`.
- Evidence: only APPROVED/ACTIVE profiles surface; seeds encode culinary-vs-supplement distinctions.
- Measurements: idempotent on (userId,provider,externalId); same-provider interval overlap skipped; daily summaries pick highest-precedence provider per day — never double-sum.
- Recovery: INSUFFICIENT_DATA or descriptive trends; sdnn/rmssd never mixed; no numeric score.
- Synthetic records: `synthetic=true`, excluded from real queries unless `includeSynthetic=1`; sim seeding is dev/internal-only.

## Humai Band vendor questionnaire (docs contract for OEM/ODM)
Required before integration work: BLE services+GATT characteristics list; pairing/bonding protocol (LE Secure Connections? passkey?); sensor specs (PPG channels, sampling Hz, accelerometer range/rate); raw vs processed data access (can we get RR intervals, or only computed HRV?); HRV statistic definition (SDNN vs RMSSD vs proprietary) and window; timestamp model (device clock vs epoch, drift handling); offline buffer capacity + sync strategy; battery reporting characteristic; firmware update protocol (signed? DFU? recovery behavior?); device identity (certifiable?); encryption at rest/in transit; SDK license terms + iOS/Android min versions; background-sync restrictions on iOS/Android; manufacturing/serial identity scheme.
Current state: provider `humai_band` registered `not_available`; no pairing UI; no fabricated battery/HRV.

## Mobile surfaces
`MindHomeScreen` (quick check-in + tracks + exercises + insights + privacy toggles), `MindTrackScreen`, `MindExerciseScreen`, `FoodIntelligenceScreen` (barcode/ingredient analysis), `HealthSourcesScreen` (connect/disconnect + deduped steps + recovery). All flag-gated via `gateScreen`; entry points in Summary → "Progress & review" card.

## What is NOT built (honest gaps)
- On-device barcode camera + label OCR (visual_food_recognition_enabled OFF — needs provider/on-device path; screen accepts manual barcode/pasted ingredients).
- Apple Health / Health Connect native adapters (schema+ingest ready; mobile bridge not built — ingest endpoint works for any adapter posting normalized records).
- Mind voice commands (leo endpoint is text-only deterministic).
- Trainer-side mind surfaces (check-ins stay private unless `checkinSharingConsent`).
- Admin evidence-review workflow UI (model lifecycle exists: DRAFT→IN_REVIEW→APPROVED→ACTIVE→NEEDS_REVIEW→RETIRED).
