# Reviewer Operations — Activity Safety Rules (Phase 19 Workstream C)

## Export (no customer data)

`node scripts/activity-safety-review-package.js --out /tmp/review-package.json` — regenerates the full reviewer package from `rulesData.js` + evidence register. Contents are rule specs, citations and scenario fixtures only — **zero customer records are ever read or exported**.

## Per-rule review card

Each of the 71 rules ships with: `ruleId`, `version` (content-hash — approval binds to this exact version), purpose, trigger conditions, evidence (source, org, date), affected activities (category keys + sample catalog activities), example scenarios (drawn from the 3,840-case matrix incl. borderline disagreements from the adjudication queue), FP/FN risk, missing-data behavior, related/conflicting rules, and required reviewer qualification.

## Decision workflow

1. Reviewer authenticates with role `clinical_reviewer` (or specialist tier — 29 rules are physician-tier).
2. For each rule: `approved | rejected | needs_revision | insufficient_evidence | out_of_scope` + justification + next review date.
3. System records decision against `{ruleId, version, reviewerId, credentials, timestamp, rationale}` — audit trail in `ActivitySafetyRule` review fields; see `activity-safety-review-workflow.md`.
4. Approval flips `reviewStatus` only if the stored version hash still matches — **any edit invalidates approval automatically** (version-pin enforcement).
5. Re-review required on: trigger/threshold/effect changes, user-facing wording changes, or evidence-source updates.

## Separation of duties

- Developer/AI accounts cannot hold `clinical_reviewer`/`specialist_reviewer` roles — enforced at the review endpoint, not by convention.
- Reviewer role assignment requires an existing admin + credential attestation; self-grant is blocked.
- No code path lets test success influence `reviewStatus`.

## Medically significant open items for reviewers

- E-1..E-6 taxonomy questions (overhead/balance/position demands; deadlift inconsistency).
- 5 over-restriction adjudication candidates (ADJ-003, ADJ-019, ADJ-020 — stricter ≠ correct).
- 10 metadata patches in `data/exercise-metadata-patch.json` — engineering inferences from source conventions (confidence labeled); reviewers may veto.
- AS-REC-003/004 `UNSUPPORTED_INPUT` — decide whether a validated input exists before activation.
