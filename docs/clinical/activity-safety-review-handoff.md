# Clinical Review Handoff — 71 DRAFT Rules (Phase 21)

## Package location

- Per-rule validation: `docs/audits/activity-safety-rule-by-rule-validation.md` (+`.json` machine-readable) — purpose, trigger, evidence, FP/FN risk, tier
- Evidence register: `docs/clinical/activity-safety-evidence-register.md` (28 sources — ACOG, ACSM, ADA, EPA, NIH, WHO…)
- Adjudication queue: `docs/clinical/activity-safety-adjudication-queue.md` (20 deduped disagreements, 5 over-restriction candidates)
- Workflow + SoD + version pinning: `docs/clinical/activity-safety-review-workflow.md`, `reviewer-approval-package.md`, `activity-safety-reviewer-operations.md`
- Deployed behavior evidence: `docs/audits/activity-safety-phase20-staging-validation.md`

## Export

`node scripts/activity-safety-review-package.js --out reviewer-package.json` — rule specs + citations + scenario outcomes only; **zero customer data**.

## By reviewer tier

| Tier | Count | Rules |
|---|---|---|
| Physician/specialist | 29 | urgent-symptom, pregnancy/postpartum, cardiac, post-surgical, medication-flag |
| Exercise-science | ~30 | demand classification, substitution, progression |
| Procedural/screening | ~12 | data availability, `UNSUPPORTED_INPUT`, emergency routing |

## Decision form (per rule)

```
ruleId:        AS-XXX-###
version:       <content hash — approval binds to THIS version>
decision:      approved | rejected | needs_revision | insufficient_evidence | out_of_scope
reviewer:      <identity + role + credentials — required, no fictional reviewers>
rationale:     <free text>
evidence reviewed: <citation ids consulted>
required changes: <if needs_revision>
next review date: <YYYY-MM-DD>
```

## Reapproval requirements

Auto-required on: trigger/threshold/effect change, user-facing wording change, evidence-source update. The version hash mismatch invalidates prior approval — enforced in the workflow, not by convention.

## Items flagged for reviewers

1. 5 over-restriction adjudication candidates (ADJ-003/019/020) — stricter ≠ correct.
2. AS-REC-003/004 `UNSUPPORTED_INPUT` — decide if a validated input exists.
3. E-1..E-6 taxonomy gaps (overhead/balance/position; deadlift inconsistency).
4. 10 metadata patch inferences (`data/exercise-metadata-patch.json`) — engineering-derived; reviewers may veto.
5. Live-staging observation: `shoulder injury → overhead_lifting` returns MODIFY (not BLOCK) — proportionality of MODIFY vs BLOCK is a clinical call.

**No rule is approved.** This package hands off to qualified humans; nothing here constitutes medical validation.
