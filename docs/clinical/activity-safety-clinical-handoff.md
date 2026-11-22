# Clinical Review Handoff — Activity Safety Engine (Phase 18)

**Status: ready for qualified external reviewers. 0/71 rules approved; all DRAFT.** This package is version-pinned to backend `feat/activity-safety-engine` (see `docs/implementation/activity-safety-phase18-progress.md` for the exact commit at handoff).

## What reviewers receive

| Artifact | Path |
|---|---|
| Per-rule validation (all 71: purpose, evidence citation, trigger logic, applicability, FP/FN risk, conflicts, review tier, version) | `docs/audits/activity-safety-rule-by-rule-validation.md` (+ `.json` machine-readable) |
| Evidence register (28 mapped sources — ACOG, ACSM, ADA, EPA, NIH, WHO…) | `docs/clinical/activity-safety-evidence-register.md` |
| Adjudication queue (20 deduped disagreements incl. 5 over-restriction candidates) | `docs/clinical/activity-safety-adjudication-queue.md` |
| Workflow: decision classes, SoD, version pinning, re-review triggers | `docs/clinical/activity-safety-review-workflow.md` |
| Reviewer package format + decision-record schema | `docs/clinical/reviewer-approval-package.md` |
| Clearance precedence semantics (clearance never overrides restrictions) | `docs/audits/activity-clearance-precedence.md` |
| Scenario evidence incl. borderline cases | 3,840-case matrix (`tests/activitySafety.scenarios.test.js`), E2E journeys doc |

## Review tiers required

- **Physician/specialist tier (29 rules)**: pregnancy/postpartum, cardiac, post-surgical, urgent-symptom, medication-flag rules. A general fitness professional is NOT sufficient.
- **Exercise-science tier**: demand-classification and substitution rules.
- **Procedural**: screening/data-availability rules (`UNSUPPORTED_INPUT` — AS-REC-003/004 stay inactive until a validated input exists).

## Separation of duties (enforced)

- Developers/AI cannot approve rules — no code path sets `reviewStatus=approved` without the review workflow's clinician credential gate.
- Approval binds to the **exact rule version hash**; any medically significant change (trigger, threshold, effect, wording) requires re-review.
- Decisions are recorded with reviewer identity, role, credentials, timestamp, justification, next review date.

## Rules needing explicit human verdicts (highest risk)

1. Urgent-symptom short-circuit set (chest pain, neuro symptoms) — emergency-copy wording + suppression breadth.
2. Pregnancy/heat-AQI deferral thresholds.
3. Postpartum re-entry timing vs. ACOG graduated-return guidance.
4. The 5 over-restriction candidates in the adjudication queue (stricter ≠ correct — reviewers must decide).
5. `overhead`/`balance`/`position` exercise taxonomy gaps (E-1..E-6) — currently conservative (review-required), needs clinical classification decision.

## What tests do and don't prove

Automated tests prove the *implementation* matches the *encoded* rules. They do not establish that the rules are medically correct — that is the reviewers' job. Do not read green suites as clinical validation.
