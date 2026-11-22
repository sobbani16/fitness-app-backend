# USDA review-data persistence design (Phase 2)

## Problem found
The `usda-preview-1` review batch lived only in `fitness_test`, which is
rebuilt/reseeded routinely → the 2026-11-22 authorized import (40 profiles +
716 joins + 26 nutrients) was silently wiped. Reviewer work queued against
it could not proceed until restored.

## Design implemented
1. **Source of truth is immutable files, not the DB.**
   `data/usda-preview-manifest.json` (ingredients + profile fields + nutrient
   rows) and `data/usda-preview-1-review-package.json` (reviewer-facing
   identity/evidence) are never mutated by test resets.
2. **Deterministic re-materialization.**
   `scripts/rematerialize-usda-preview.js` rebuilds the batch exactly:
   - refuses to run unless `DATABASE_URL` targets `fitness_test`;
   - binds `ingredientId` by **exact `fdcId` lookup** — no fuzzy/name matching;
   - upserts on deterministic `identityKey` (= `sourceRecordKey`,
     `usda-preview-1|food:<fdcId>`) — re-runs are no-ops;
   - nested `IngredientNutrient` upserts on `(profile,nutrient)`;
   - never updates existing rows (`update: {}`), never sets `verifiedAt`.
3. **Provenance preserved.** `sourceDataset`, `sourceRecordKey`,
   `sourceCitation`, `sourceFoodId` all round-trip from the manifest.
4. **Consumers stay fail-closed.** All intelligence paths filter
   `verifiedAt != null`; the restored batch is invisible until a reviewer
   approves (verified: still 0 approved).
5. **Reviewer evidence separation.** Reviewer decisions live in `auditLog`
   (append-only) and `scenarioReviewDecisions.json` (hash-chained) — neither
   is touched by test-DB resets. A dedicated staging DB remains an option
   for long-lived review work; NOT provisioned — needs owner authorization.

## Re-applied
40 pending / 0 approved in `fitness_test` after re-run. If wiped again:
`DATABASE_URL=...fitness_test node scripts/rematerialize-usda-preview.js --apply`.
