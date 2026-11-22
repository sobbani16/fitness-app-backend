# Nutrition Verification Governance

## verifiedAt semantics
`IngredientNutritionProfile.verifiedAt` = reviewer-approved stamp. NULL = source-backed but unreviewed. ALL intelligence consumers (`foodIntelligence`, `population`, `conditionEvaluation`, recipe calc) filter `verifiedAt:{not:null}` — fail-closed by construction, verified empirically (unverified batch returns 0 rows).

## Review workflow (usda-preview-1)
- Package: `data/usda-preview-1-review-package.json` — 40 items: profileId, identity check, prep state, proposed nutrients+units, missingCore, provenance, and empty decision slots (identityApproved/prepApproved/nutrientsApproved/reviewer/decidedAt/notes).
- Setting `verifiedAt` is a **reviewer action on the package** — no automated path exists or was created. Separate from clinical approval entirely.
- Mobile `verificationLevel` derives from `ingredient.catalog`, never from profile `verifiedAt` — unverified batch cannot render as "Source-backed".
- Activation proven: synthetic `synthetic-reviewed-fixture` profile (verifiedAt set) became consumer-visible; batch stayed invisible; synthetic cleaned up, 40 batch rows intact.
