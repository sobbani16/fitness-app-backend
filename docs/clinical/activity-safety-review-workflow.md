# Clinical Review Workflow (Phase 16.6)

Goal: a workable path for *qualified humans* to classify each of the 71 DRAFT rules. The implementation agent is never an approver; automated tests never constitute approval.

## Decision vocabulary

`APPROVED` | `REJECTED` | `NEEDS_REVISION` | `INSUFFICIENT_EVIDENCE` | `OUT_OF_SCOPE`

## Reviewer credentials + tiers (from rule-audit.json `reviewerTier`)

| Tier | Who | Rules |
|---|---|---|
| physician/specialist | MD/DO or board specialist (OB, cardiology, neurology, nephrology) | **29 rules** — all pregnancy, cardiac, urgent-escalation, epilepsy/PD/MS/CKD, medication-precaution rules |
| clinical exercise physiologist | ACSM-CEP or equivalent | screening/gating, DOMS, environmental physiology rules |
| qualified exercise professional | certified trainer + safety scope | personalization/preference rules |
| product+clinical joint | PM + clinician together | `PRODUCT-POLICY` markers |

## Required record per rule

`reviewerIdentity` (role+credential ref) · `ruleCode` + `version` · `evidenceReviewed` (refs from `docs/audits/activity-safety-rule-audit.json`) · `decision` · `timestamp` · `justification` · `requiredChanges` · `nextReviewDate`.

## Separation of duties (enforced)

- `reviewStatus` transitions require a human reviewer identity in the approval row — the seed path hard-pins `DRAFT` and skips non-DRAFT rows (cannot downgrade an approved rule by re-seed).
- DB CHECK constraint keeps rules inert for users until `APPROVED` + flag enable — two independent gates.
- The implementation agent's outputs (tests, matrices, audits) are *evidence*, never `justification`.

## Reviewer package (ready now)

- `docs/audits/activity-safety-rule-audit.json` — machine-readable per-rule: triggers, input channels, executable example verdict, co-firing rules, guidance family, reviewer tier, risk flags.
- `docs/audits/activity-safety-rule-by-rule-validation.md` — same, human-readable.
- `docs/clinical/activity-safety-review-package.md` — encoded triggers/thresholds/conflicts + executable examples.
- `docs/clinical/activity-safety-adjudication-queue.md` — 20 shadow disagreements needing calls (incl. over-restriction candidates ADJ-003, ADJ-019/020).
- `docs/audits/activity-safety-scenario-matrix.md` — 3,840-scenario behavioral evidence.

## Order suggestion for reviewers

1. The 4 URGENT mirrors + AS-CORE-001..003 (gating semantics) — highest blast radius.
2. Physician-tier rules by condition family.
3. Threshold-bearing flags (`apparentTemp`, `aqi`, `age`, `painLevel` numeric triggers).
4. Personalization/informational markers.
5. `PRODUCT-POLICY` items last (joint session).
