# Security Review — Recipe Intelligence

**Scope:** constraint engine, validator, generation, persistence, matching,
customize, metrics, admin analytics. Date: 2026-11-21.

## What was fixed

| ID | Finding | Resolution |
|---|---|---|
| F-1 | `matchIngredients` + `/customize` trusted client `allergies`/`diet` | Server-authoritative `loadConstraints`; request can only narrow. Regression-tested. |
| F-5 | Transformed recipes could skip revalidation | `/customize` runs full `validateGeneratedRecipe`; result attached to response. |
| F-9 | Generated saves colliding on global `recipeName @unique` | `ai:` sourceKey + name disambiguation; user-supplied status rejected. |
| F-12 | `/recipes/generate` mount order could shadow `/:id` | Route registered before `/:id`. |
| (dup) | 2 keyword systems drifting | `foodIntel` imports shared `LABEL_ANIMAL_TERMS`. |

## Verified properties

- **Fail-closed flag gating:** `/generate` + `/save-generated` behind
  `ai_recipe_generation_enabled` (default off); `/customize` behind
  `recipe_customization_ai_enabled`. Flag-off → 404.
- **AI output untrusted:** candidates carry no honored `status`, `nutrition`,
  `allergens`, or `validated` fields; nutrition always recomputed.
- **Cross-user isolation:** every constraint query scoped by `req.userId`;
  saved recipes `ownerId`-scoped. `recipeName` uniqueness handled by
  disambiguation, not bypass (ISO-001 isolation test pending).
- **Injection surface:** AI prompt inputs (`items`, `cuisine`) are strings fed
  to `askJSON` only — never interpolated into SQL (all prisma params bound).
- **Audit:** every generate candidate + customize transformation writes a
  `SafetyAuditLog` row (userId, checkType, input ref, result, pass).
- **No secrets/PII in metrics:** counters keep status + ruleIds only; no
  recipe text, no user attributes. Admin endpoints behind
  `VIEW_PLATFORM_ANALYTICS`.

## Open risks (tracked)

| Risk | Severity | Status |
|---|---|---|
| No cache yet — every request recomputes constraints | cost, not security | CACHE-001 pending |
| Prompt content not sanitized for prompt-injection inside `askJSON` | MEDIUM — provider-level mitigations; AI output untrusted anyway | accepted |
| `allergens` declared on client-posted save candidates ignored correctly, but no schema validation of candidate shape on save | LOW | revalidation covers content |
| Metrics are in-process (restart resets) | LOW | SafetyAuditLog is durable source |
| No rate limit on `/generate` beyond `askJSON` quota | LOW-MED | quota exists; consider per-route limit |

## Reviewer signoff requirement

No deployment should enable `ai_recipe_generation_enabled` for real users
until: (a) this review is re-confirmed against the release commit, (b) a
synthetic-user production check validates flag-off → 404 and flag-on →
validated-only behavior.
