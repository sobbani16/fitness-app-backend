# Reviewer Approval Package (Phase 17 §7)

Everything a qualified external reviewer needs, self-contained. **Nothing here constitutes approval** — approval requires the recorded human decision below.

## Artifacts (regenerate any time)

| Artifact | Command | Contents |
|---|---|---|
| `docs/audits/activity-safety-rule-audit.json` | `node scripts/activity-safety-rule-validation.js` | machine-readable: triggers, input channels, executable example verdict, co-firing rules, evidence family, reviewer tier, risk flags |
| `docs/audits/activity-safety-rule-by-rule-validation.md` | same | human-readable version |
| `docs/clinical/activity-safety-review-package.md` | `node scripts/activity-safety-review-package.js` | encoded triggers/thresholds/conflicts + 71 executable examples |
| `docs/clinical/activity-safety-adjudication-queue.md` | `node scripts/activity-safety-adjudication.js` | 20 shadow disagreements (0 LOOSER) incl. over-restriction candidates |
| `docs/audits/activity-safety-scenario-matrix.md` | `node scripts/activity-safety-scenario-matrix.js` | 3,840-scenario behavioral evidence |
| `docs/audits/activity-clearance-precedence.md` | — | precedence invariants + provenance fields |

## Decision record (per rule — required fields)

```json
{
  "ruleCode": "AS-CV-001", "ruleVersion": 1,
  "reviewer": { "identity": "<name/id>", "role": "<physician|CEP|exercise-pro>", "credentialRef": "<license/org>" },
  "evidenceReviewed": ["ACSM_SCREEN_2015", "AHA_RESISTANCE_CVD"],
  "decision": "APPROVED | REJECTED | NEEDS_REVISION | INSUFFICIENT_EVIDENCE | OUT_OF_SCOPE",
  "justification": "<free text — required>",
  "requiredChanges": "<if NEEDS_REVISION>",
  "reviewedAt": "<ISO>", "nextReviewAt": "<ISO>",
  "signoff": "reviewer-only — implementation agents may not write this record"
}
```

## Enforced rules

- **Separation of duties**: `reviewStatus` transitions happen via the approval record above, written by the reviewer — seed re-runs hard-pin DRAFT and skip non-DRAFT rows; the DB CHECK keeps rules inert for users until `APPROVED` + flag enable (two independent gates).
- **Version pinning**: approval binds `ruleCode` + `version`; any medically significant rule edit must bump `version` → prior approval no longer matches → re-review required (enforced by convention + the approval record shape).
- **Tier routing**: 29 rules are physician/specialist-tier (pregnancy, cardiac, urgent, epilepsy/PD/MS/CKD, medication precautions) — a general fitness credential is insufficient for those rows.
- **No fictional approvals**: the audit JSON contains no approval fields; DRAFT is the only state until a real record exists.
- Borderline cases are pre-staged: adjudication queue entries ADJ-003 (NWB→overhead breadth) and ADJ-019/020 (pregnancy breadth) are explicit reviewer-decision items.
