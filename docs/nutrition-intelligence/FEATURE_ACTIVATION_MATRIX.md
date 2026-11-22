# FEATURE_ACTIVATION_MATRIX — what can turn on, where, for whom

| Feature | Flag | Country gate | Engineering verified | Clinical approved | Founder test | Cohort release | Production-all |
|---|---|---|---|---|---|---|---|
| Score v1 `/health-score` | none | both | ✔ (live) | n/a wellness | live | live | **live** |
| Score v2.1 route | `health_score_v2` | both | ✔ 56+ fixtures | pending (adherence framing) | **eligible now** | after founder + copy review | blocked: fixture breadth + copy |
| Scenario engine | `scenario_engine` | both | ✔ | n/a (reporting) | **eligible** | internal | blocked |
| Allergen `safety_warning` | `allergen_warnings` (new) | both | ✔ outcome tested | pending wording | conditional (synthetic only) | after allergist sign-off | blocked |
| Persistent-symptom escalation | — (decisionEngine core) | both | ✔ | pending copy | **eligible** (review-path copy) | after wording review | blocked |
| Calorie floor G4 | `calorie_floor_policy` (new) | both | ✔ module tested | **not approved** | no | after dietitian+ED sign-off | blocked |
| Condition rules | `condition_rules` (new) | per-country + counsel | gating ✔ | **0 approved** | no | after approvals + counsel | blocked |
| Supplement cautions | `supplement_safety` (new) | both | catalog exists | **0 of 47 approved** | no | pharmacist review | blocked |
| Medication interactions | `medication_interaction` | both | review path only | n/a — no content | no | blocked until content + review | blocked |
| Calorie-safety flags in `calorieSafety` | same as floor | both | ✔ | pending | no | with floor | blocked |
| Food intel (barcode/OFF) | `food_intel` | both | ✔ live-gated | wellness | live | live | conditional per launch |

**Activation rule:** a row moves right only when every box left of it is checked. Server-side flags only; all defaults OFF; rollback = flag off (no data migration — snapshots/definitions are additive/versioned).
