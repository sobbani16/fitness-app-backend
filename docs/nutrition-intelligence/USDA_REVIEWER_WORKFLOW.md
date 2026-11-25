# USDA Reviewer Workflow — IMPLEMENTED (not just a document)

Route `src/routes/nutritionReview.js` → `/super-admin/nutrition-profiles`, gated by new RBAC permission `NUTRITION_DATA_REVIEW` (ADMIN + SUPER_ADMIN only; seeded to fitness_test).

| Endpoint | Behavior |
|---|---|
| `GET /?status=pending&batch=…` | Lists profiles incl. nutrients+units, ingredient name/fdcId, provenance (sourceDataset/sourceCitation/sourceFoodId), prep state |
| `GET /:id/history` | Immutable AuditLog decision trail for the profile |
| `POST /:id/decision` | APPROVE → sets `verifiedAt`; REJECT/REQUEST_CHANGES → advisory only, never verifies. Justification ≥10 chars required |
| `POST /:id/revoke` | Clears `verifiedAt` on verified rows only |

- Concurrency: `updateMany` conditioned on observed `verifiedAt` → concurrent/double decisions → 409.
- Immutable history: every decision/revoke writes `auditLog` (actor, action, before/after, justification).
- Original import rows untouched: only `verifiedAt` mutates; provenance fields preserved.
- Clinical approval entirely separate (ACADEMY_CLINICAL_REVIEW, untouched).
- **0 of 40 USDA profiles approved** — workflow exists for an authorized human.

## Governance re-validation (2026-11-25, dev DB `fitness_app`, read-only)

- `IngredientNutritionProfile` count is now **18** (not 40 — count drifted since this doc); all `source:'USDA'`.
- **All 18 carry `verifiedAt` = 2026-10-27**, one month *before* their `createdAt` (2026-11-21): the value is the source-envelope `retrievedAt` stamped at import, **not** a reviewer decision. So `verifiedAt`-gated consumers treat import-time retrieval as verification — any surface that reads it as "human reviewed" overstates the guarantee. Reviewer APPROVE sets the same column, so the two meanings are indistinguishable downstream.
- `AuditLog` nutrition-decision rows: **0** — the review queue has never been exercised (consistent with "0 approved", but also means no REJECT/REQUEST_CHANGES trail exists to test history rendering against).
- `data/scenarioReviewDecisions.json`: `{"version":"review-v1","decisions":[]}` — empty, consistent.
- `ScenarioDefinition` (dev): 120 rows, all `reviewStatus='pending_review'` — no fictitious approvals.
- Route tests `tests/nutritionReview.test.js` re-run: **8/8 green** (RBAC gate, justification ≥10 chars, 409 on double-approve/concurrent state, revoke only on verified rows, member cannot revoke).
- **Implication for governance:** the workflow is implemented and tested, but "verified" currently means "source-retrieval-stamped". If `verifiedAt` is meant to require human review, importers should stamp a distinct field (e.g. `retrievedAt`) and leave `verifiedAt` null until a reviewer acts — that's a product/schema decision, not implemented here.
