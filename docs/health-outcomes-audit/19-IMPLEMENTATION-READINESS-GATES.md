# 19 — Implementation Readiness Gates

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Date:** 2026-11-22
A condition must pass ALL applicable gates before public release. Gates are ordered; a fail stops progression.

## Gate G0 — Input existence
- [ ] User can record the condition (API + UI + consent).
- [ ] Condition registry entry exists w/ slug, category, evidence class, staging axis.
- [ ] Condition deactivation path exists (rules stop firing).

## Gate G1 — Data sufficiency
- [ ] Nutrients the rules need are populated on >90% of in-scope ingredients (verifiedAt + sourceCitation present).
- [ ] Recipe roll-ups carry required nutrients (sodium/sugar/sat fat where rules depend).
- [ ] Attributes the rules reference are sourced and assigned — zero coverage = rule inert by design (acceptable) BUT user-facing claims must not reference unevaluable attributes.
- [ ] Serving/portions exist for recommended foods.

## Gate G2 — Rule quality (clinical review)
- [ ] Every rule targeting the condition is APPROVED (reviewer + evidence + version) — DB constraint enforces.
- [ ] Rule granularity matches evidence (portion/stage/medication-aware, not blanket attribute bans).
- [ ] Blanket-classification review passed (no "all carbs/dairy/potassium bad" patterns).
- [ ] Evidence rows cite guidelines (not marketing/education pages) + publicationYear populated.

## Gate G3 — Safety integration
- [ ] Medication interactions modeled or explicitly out-of-scope-labeled.
- [ ] Multi-condition conflicts resolve to PERSONALIZATION_REQUIRED (never silent intersection-only when a real tension exists, e.g. CKD×sarcopenia protein).
- [ ] Referral triggers wired to `UserClinicalReview` queue.
- [ ] Calorie/protein bounds respect supervised-condition set.

## Gate G4 — Explainability
- [ ] Every recommendation exposes: which conditions influenced it, evidence refs, alternatives considered, missing data, reconsider-at.
- [ ] "Unknown" is displayed as unknown — never as "safe" or "0".

## Gate G5 — Measurement
- [ ] Condition-appropriate outcomes defined + collectable (behavior + ≥1 clinical measure where relevant).
- [ ] Provenance labels: self-reported / device / lab / clinician-verified distinct.
- [ ] No improvement claim without clinical verification path.

## Gate G6 — Regulatory & claims
- [ ] Copy review: supportive/"helps you manage" language; no cure/reversal claims; remission wording only where defined by guidelines (T2D: ADA consensus A1c<6.5% ≥3mo off meds) and only as an educational fact, never a promised outcome.
- [ ] MHMD/DPDP consent + deletion coverage verified for new tables.
- [ ] App-store health-data compliance (no PHI to analytics/ads).

## Gate G7 — Test coverage
- [ ] Unit: rule evaluation incl. INSUFFICIENT_DATA + PERSONALIZATION_REQUIRED paths.
- [ ] Integration: condition→constraint→recommendation e2e.
- [ ] Adversarial: conflicting conditions, missing labs, med-context, stale data, injection attempts.
- [ ] Regression: deletion coverage, flag-off behavior, fixture exclusion.

## Gate G8 — Rollout
- [ ] Feature flag + allowlist cohort first; PostHog staged %.
- [ ] Rollback = flag-off (no data migration reversal needed).
- [ ] Monitoring: SafetyAuditLog + evaluation provenance dashboards.

## Per-condition gate map (summary)

| Condition | G0 | G1 | G2 | G3 | G4 | G5 | G6 | G7 | G8 | Blocking items |
|---|---|---|---|---|---|---|---|---|---|---|
| Obesity | ✗ | ~ | — | ~ | ~ | ✓ | ~ | ~ | ~ | write path, ED-risk wiring |
| Prediabetes/IR | ✗ | ~ | ✗ | ~ | ~ | ✗A1c | ~ | ~ | ~ | rules, A1c ingest |
| MASLD | ✗ | ✗ | ✗ | ~ | ~ | ~ | ~ | ~ | ~ | condition, rules, ALT data |
| Hypertension | ✗ | ✗Na | ✗ | ⚠K⁺ | ~ | ✗BP | ~ | ~ | ~ | sodium data, BP metric, K⁺-med rules |
| HTG/LDL | ✗ | ✗ | ✗ | ~ | ~ | ✗lipids | ~ | ~ | ~ | lipid ingest, sat-fat data |
| T2D (non-insulin) | ✗ | ~ | ✗ | ⚠med | ~ | ✗A1c | ⚠claims | ~ | ~ | rules, A1c, med model, claim review |
| PCOS | ✗ | ~ | ✗ | ~ | ~ | ~ | ~ | ~ | ~ | rules authoring |
| CKD | ✗ | ✗ | ✗ | ⚠stage | ~ | ✗eGFR | ⚠ | ~ | ~ | stage model, protein override, labs |
| Celiac | ✗ | ✗ | ✗ | ~ | ~ | ~ | ⚠cert | ~ | ~ | GF certification context, coverage |
| Gout | ✗ | ✗ | ✗ | ~ | ~ | ✗urate | ~ | ~ | ~ | purine data, honest framing |
| OA / LBP | ✗ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | condition rows, exercise templates |
| Osteoporosis | ✗ | ~ | ~ | ⚠flexion | ~ | ~ | ~ | ~ | ~ | exercise restriction classes |
| Asthma | ✗ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | env-trigger rule set |
| OSA | ✗ | ~ | ~ | ~ | ~ | ~ | ⚠claims | ~ | ~ | adjunct framing |
| Depression/Anxiety | ✗ | ~ | ~ | ⚠crisis | ~ | ✗PHQ9 | ⚠ | ~ | ~ | instruments + escalation |
| Insomnia | ✗ | ~ | ~ | ~ | ~ | ✗ISI | ~ | ~ | ~ | CBT-I signposting |
| GDM | ✗ | ~ | ~ | ⚠preg | ~ | ✗glucose | ⚠ | ~ | ~ | supervised pathway only |
| Stones | ✗ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | stone-type field, hydration |
| Education-only set | n/a | n/a | ✗ | ~ | ~ | n/a | ⚠copy | ~ | ~ | content review |

Legend: ✗ missing · ~ partial/unverified · ⚠ specific blocker · ✓ ok · — n/a
