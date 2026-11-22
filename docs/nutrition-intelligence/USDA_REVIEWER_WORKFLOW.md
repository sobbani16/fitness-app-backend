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
