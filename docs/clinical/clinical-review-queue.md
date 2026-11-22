# Activity Safety — Clinical Review Queue

**Generated:** 2026-11-21 · **Nothing auto-approved.** Every rule in `docs/clinical/activity-safety-evidence-register.md` §B and every row in `data/activitySafetyRules.json` ships `reviewStatus: DRAFT` / `pending_review` and is **inert for real users** until a qualified reviewer signs off.

## Gating contract (must be verified by `scripts/verify-activity-safety-gating.js`)

1. The activity-safety engine loads only `ActivitySafetyRule` rows with `reviewStatus = 'APPROVED'` for live evaluation; DRAFT/REVIEWED rows load only in `shadow`/`test` mode.
2. DB CHECK constraint: APPROVED requires `reviewedBy`, `reviewedAt`, `evidenceSourceId` — mirroring `ConditionRule_check`.
3. Feature flags `activity_safety_engine_enabled` / `health_aware_recommendations_enabled` default **off**; shadow mode can evaluate-but-not-display without clinical approval (evaluation logs only).
4. Urgent-escalation copy is **product-safety copy** (direction to seek care), never diagnosis — it may ship before clinical review because it errs toward caution; all *eligibility/restriction* rules require review.

## Queue A — rules needing clinician sign-off before production (all §B rows)

**Reviewer asks, per rule:**
1. Confirm the citation + revision date and that the encoded trigger faithfully represents the guideline (no over- or under-blocking).
2. Confirm severity/applicability criteria; supply anything marked "clinician-documented".
3. Confirm missing-data behavior errs conservatively without producing false prohibitions.
4. Approve or edit the user-facing reason strings (no diagnostic/prescriptive language).
5. Set `reviewedBy`/`reviewedAt`/`evidenceSourceId`; flip `reviewStatus` → APPROVED.

**Priority order for review (highest-risk first):**

| # | Rule(s) | Why first |
|---|---|---|
| 1 | AS-CORE-001 urgent-symptom escalation list | determines when the app tells a user to stop and seek care — wording + trigger breadth need sign-off |
| 2 | AS-PREG-001..005 pregnancy set | ACOG 804 encoding; warning-sign list completeness; heat precautions |
| 3 | AS-CV-001..005 cardiovascular set | stable-vs-acute differentiation; post-event rehab framing |
| 4 | AS-DM-001..004 diabetes set | hypoglycemia/hyperglycemia+ketones handling; neuropathy/retinopathy adaptations |
| 5 | AS-MSK-001..008 musculoskeletal set | NWB/fracture/post-op handling; "never infer clearance from elapsed time" behavior |
| 6 | AS-RESP-001..006 respiratory + AQI | EPA band mapping for sensitive groups vs general |
| 7 | AS-ENV-001..012 environmental | NWS/EPA band encoding; stale/missing-data behavior |
| 8 | AS-NEURO-001..006, AS-SYS-001..005, AS-AGE-001..004 | condition adaptations; verify no blanket prohibitions |
| 9 | AS-REC-001..004, AS-PER-001..005 | product policies — verify copy is non-coercive, non-diagnostic |

## Queue B — scenario fixtures needing clinician-derived expected outcomes

`data/activitySafetyScenarios.json` ships with implementation-derived `expected` fields marked `expectedSource: 'implementation'`. The clinician reviewer must convert each into `expectedSource: 'reviewed'` before those fixtures certify a rule — mirroring D9 in the nutrition program (`docs/nutrition-intelligence/CLINICAL_RULE_REVIEW_QUEUE.md`).

## Queue C — items requiring specialist input (not in v1 rules)

- Medication→activity interaction flags beyond the coarse heat-sensitivity/hypoglycemia/sedation classes — needs a pharmacist-verified mapping; v1 treats med flags as user-reported hints only.
- Region-specific environmental indices (non-US AQI schemes, local heat plans) — needs per-region config review for international deployment.
- Voice injury-report triage questions — "only the necessary follow-up questions" needs a clinical review of question breadth.

## Golden-test requirement

Before any rule goes APPROVED, add a fixture pair: APPROVED rule fires on matching input; identical DRAFT twin stays inert (precedent: `mealSuggest.test.js`, `scripts/verify-rule-gating.js`).
