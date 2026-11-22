# US / INDIA COMPLIANCE HANDOFF (H10)

Purpose: function-level inventory for qualified counsel. This document **does not** determine legal status, declare compliance, or grant regulatory clearance.

## Function inventory

| Function | Category | Likely frame (for counsel) | Notes |
|---|---|---|---|
| Food logging + macro totals | General wellness | US: non-device general wellness; IN: FSSAI-adjacent | Low risk; keep copy non-therapeutic. |
| Ingredient classification + portion impact | Wellness education | US: general wellness; IN: education | Deterministic, evidence-cited; avoids disease claims by design. |
| Trends / goal progress / outcome-divergence review flags | Wellness | US: general wellness (self-tracking) | Observational wording enforced in code. |
| Symptom reports + activity-safety engine | **Borderline** | US: could approach CDS/medical-device boundary depending on claims; IN: CDSCO question | Urgent-escalation copy exists — counsel should review the escalation/disclaimer wording specifically. |
| Medical-condition rules (`ActivitySafetyRule`, `ConditionRule`) | **Clinical** | US: device-like functionality if user-facing; IN: CDSCO | All gated `APPROVED` + flags OFF; zero approvals. Keep off until reviewed. |
| Calorie floor / rapid-loss policies | **Clinical** | Same as above | Implemented but inactive pending review. |
| Trainer access to member data | Privacy | US: state consumer-health-data laws (WA My Health My Data etc.); IN: DPDP consent | Symptoms/trainer data restricted by default — verified in code. |
| Wearable energy ingest | Wellness | General wellness | Estimates labeled; no device output. |
| Data retention/deletion | Privacy | US state laws; IN: DPDP erasure | Account deletion path exists; verify symptom/audit retention semantics with counsel. |
| Cross-border data | Privacy | IN: DPDP transfer rules; US: state | Hosting location + subprocessor list needed for counsel. |

## Counsel-review items (explicit)

1. Whether symptom triage + "do not begin a workout" escalation copy constitutes medical advice/functionality in US states and under CDSCO SaMD rules.
2. Whether approval-gated clinical rules can ever ship under general-wellness framing (likely not — assume restricted).
3. FSSAI position on nutrient claims and food-substitution suggestions.
4. DPDP consent granularity for symptom data vs. fitness data; trainer access as separate consent purpose.
5. Retention windows for health data vs. audit logs; erasure semantics of `superseded` records.
6. Minor/pregnancy-specific symptom codes — stricter review.

## Engineering posture (unchanged)

Flags OFF · 0 approvals · observational copy enforced · no diagnosis language · estimates labeled · unknown ≠ zero.
