# Mobile Nutrition Provenance — VALIDATED

- `verificationLabel()` (`src/api/ingredients.ts`): SOURCE_BACKED_FULL→"Source-backed" · PARTIAL→"Partially source-backed"/"Calories source-backed · Macros may be estimated" · REVIEW_CONFLICT→"Needs review · Estimated" · else "Estimated"/"USDA data". `IngredientSearch` prefixes `≈` for non-full.
- Barcode flow: `nutrition.verified` → 'Verified catalog product' else 'User-contributed — verify label'.
- Energy card: `dataGaps` rendered via GAP_LABELS (stale sync, missing active/resting, partial coverage, untracked intake).
- Backend gating: consumers require `verifiedAt` → the usda-preview-1 batch cannot appear verified anywhere; missing nutrients remain absent (never 0).
- No unapproved medical copy found; no medical flags active.
