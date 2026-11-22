# USDA Reviewer Handoff

40 pending profiles in `fitness_test` (`sourceDataset='usda_fdc_usda-preview-1'`, `verifiedAt NULL`).

**Reviewer interface (live API):** `GET /super-admin/nutrition-profiles?batch=usda_fdc_usda-preview-1` (permission `NUTRITION_DATA_REVIEW`) returns each profile: ingredient name + fdcId, USDA description/citation, preparation (OTHER=unspecified), nutrient values + units, `sourceDataset`, missing-core-nutrient list. Detail evidence: `data/usda-preview-1-review-package.json` (per-item identity check + proposed nutrients).

**Decisions:** `POST /:id/decision {decision: APPROVE|REJECT|REQUEST_CHANGES, justification≥10}` — only APPROVE sets `verifiedAt`; `POST /:id/revoke` reverses; all writes go to `auditLog` (actor/action/before/after/timestamp) — immutable history. Concurrent decisions → 409.

**Status:** 40 pending / 0 approved / 0 rejected / 0 revoked. Nutrition verification ≠ clinical approval.

## Reviewer assignment checklist (owner action)
1. Assign `NUTRITION_DATA_REVIEW` permission (ADMIN/SUPER_ADMIN role) to a qualified reviewer in the admin console or DB.
2. Reviewer opens `GET /super-admin/nutrition-profiles?status=pending&batch=usda_fdc_usda-preview-1` — 40 items.
3. Per item: compare ingredient name ↔ `usdaDescription`, confirm prep state, spot-check 2–3 nutrient values against `data/nutrient-sources/usda/<fdcId>.json` raw cache.
4. `POST /:id/decision` with `APPROVE` (sets verifiedAt → consumers see it) or `REJECT`/`REQUEST_CHANGES` + justification.
5. History: `GET /:id/history`; undo via `POST /:id/revoke`.
6. Cache invalidation: none needed — consumers query `verifiedAt` live, no cache layer.

## 2026-11-22 update — batch was wiped by a test-DB reseed; restored
`fitness_test` was rebuilt after the 2026-11-22 authorized import, removing all
40 `usda-preview-1` rows. New script `scripts/rematerialize-usda-preview.js`
re-inserts them (dry-run default; `--apply`; refuses non-fitness_test URL;
idempotent; binds ingredients by fdcId). Re-applied: **40 pending / 0
approved**, all `verifiedAt NULL`. If a reseed wipes it again, re-run:
`DATABASE_URL=...fitness_test node scripts/rematerialize-usda-preview.js --apply`.
