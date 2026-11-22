# Fiber Supplement Safety Review — status: NOT CLINICALLY REVIEWED

This document separates what the system does today from what still requires
human clinical review before the `fiber_supplement_suggestions_enabled` flag
may be turned on for real users.

## What the code does (automated, deterministic)

`src/services/fiber/supplementCheck.js` (`fiber-supplement-check-v1`):

- Evaluates ONLY user-selected fiber supplements (psyllium/isabgol, soluble
  fiber families by name/slug pattern). Non-fiber items → `not_applicable`.
- Requires a `SupplementProduct` with `verificationStatus` LABEL_REVIEWED or
  VERIFIED and a `labelFacts` fiber-per-serving value before it reports any
  fiber amount. No teaspoon→gram conversion is ever inferred.
- Hard-suppress reasons (outcome `suppressed_safety`): recorded
  swallowing/esophageal conditions, bowel obstruction/stricture/
  gastroparesis/diverticulitis/IBD/low-residue conditions (shared
  `FIBER_RESTRICTION_PATTERNS` with the target engine), recorded psyllium
  allergy, age < 12, `review_only` catalog entries.
- Warnings (outcome `eligible_with_warnings`): minors, pregnancy,
  fluid-restricted conditions (kidney/heart), a published interaction rule.
- Medication interactions: only approved+PUBLISHED `SupplementInteractionRule`
  rows can inform the verdict; none currently exist, so every check reports
  `medications_not_evaluated` — explicitly not "no interaction".
- Directions always include: mix into adequate liquid (commonly ≥240 mL /
  8 fl oz per label), never dry, not immediately before bedtime, plus the
  product's own label warnings verbatim.
- Every check is persisted to `FiberSupplementCheck` (outcome, reason codes,
  label fiber, rule version) — suppressed verdicts included.
- Explicit user confirmation (`POST /fiber/supplement-check/:id/confirm`) is
  recorded; logging still happens through the normal supplement flow by the
  user's own hand. Nothing is auto-logged, no dose is ever suggested.

## What is NOT done (needs clinical review)

- No dose, frequency, or escalation advice exists anywhere in the system.
- The psyllium research-seed entry stays `requires_clinical_review`,
  `suggestion_auto_enabled=false`, `review_status=UNREVIEWED_RESEARCH_DRAFT`.
- The 47 draft interaction rules in the seed file are `approved=false` —
  they never fire (verified: `medications_not_evaluated` reported instead).
- OTC "12+" labeling is a convention, not a pediatric indication.
- The condition-name pattern lists are heuristic; a clinician should review
  the match set (`FIBER_RESTRICTION_PATTERNS`, `SWALLOW_RE`,
  `FLUID_RESTRICT_RE`) before flag-on.
- `FiberSupplementCheck` audit rows exist for review but have no reviewer UI.

## Pre-release gate

Turning on `fiber_supplement_suggestions_enabled` requires: (1) clinician
review of the condition lists and warning copy, (2) at least the psyllium
seed entry's `requires_clinical_review` resolved, (3) a decision on whether
`medications_not_evaluated` info copy is acceptable without any published
interaction rules.
