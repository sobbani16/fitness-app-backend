# Allergy enforcement contract (HUM-P6-001)

Single policy enforced at every surface that writes food into a user's plan or
recommends it. Source of truth: `src/services/allergens.js` `assess()`.

## Verdicts
- `conflict` — recipe composition hits a recorded user allergy. NEVER written
  automatically; manual paths reject with `409 ALLERGY_CONFLICT` + `details.conflicts`.
- `unknown` — composition unverifiable (unresolved ingredient lines). Manual
  paths: `409 ALLERGY_COMPOSITION_UNKNOWN` unless the client re-sends with
  `acknowledgeUnknown: true`. Automatic writes: ineligible, no ack path exists.
- `clear` / `not_applicable` — no recorded allergies or no hits.

## Surface matrix
| Surface | Type | conflict | unknown |
|---|---|---|---|
| generation (weekly/ai generators) | automatic | excluded | excluded |
| confirmDay | user-initiated | blocked pending acknowledgement | 409 + ack gate |
| swapMeal | user-initiated | 409 ALLERGY_CONFLICT | 409 + ack gate |
| getAlternatives | read | excluded, allergyStatus exposed | offered with allergyStatus |
| rebalanceDay | automatic (no user) | ineligible | ineligible |
| allergy-change revalidation | automatic | unconfirms + safetyAuditLog row | unconfirms + audit row |

## Ownership invariant
Every mutation is owner-scoped: `userId` flows from the authenticated request
into the service query (`plan.userId` match). Non-owner access is a 404 —
existence is never revealed, and no write is possible cross-user.

## Cache coupling
None. Recipe catalog caches hold allergy-independent data; user-allergy rows
are read live at every decision point. Allergy changes take effect on the very
next read/write — there is no TTL window.

## Jobs
No background job surface exists. All generation is request-driven through the
routes above; nothing generates food into plans outside this matrix.
