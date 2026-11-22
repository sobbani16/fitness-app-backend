# Test Results — Recipe Intelligence

**Measured:** 2026-11-21, `npx jest` in-band on the six suites that exercise
recipe-intelligence paths. **79 tests / 6 suites — all passing.** No
result below was claimed without a run; scenario IDs map to
`scenario-registry.json`.

## Suites

| Suite | Tests | Covers |
|---|---|---|
| `recipeConstraints.test.js` | 23 | Constraint engine, F-1 tamper regression, boundary matching, provenance |
| `recipeValidate.test.js` | 14 | Staged validator: identity/allergen/pattern/medical/limits/equipment/safety |
| `recipeGenerate.test.js` | 8 | AI candidates, retry budget, fallback, NO_ELIGIBLE_RECIPE, flag-off |
| `recipeE2E.test.js` | 5 | generate→save→customize on an allergic profile |
| `smartKitchen.test.js` | (regression) | Constraint engine reuse in mealSuggestion path |
| `foodIntel.test.js` | (regression) | Shared `LABEL_ANIMAL_TERMS` consolidation |

## Verified critical scenarios (subset of 18 implemented-critical)

| ID | Assertion | Proof |
|---|---|---|
| ALLERGEN-001/002 | peanut-allergic user: direct + derivative names fail | recipeValidate |
| ALLERGEN-004 | case/plural forms (`Eggs`) caught, `eggplant`/`walnut` not | recipeConstraints |
| F-1 (DIET-001) | saved allergy enforced when request omits `allergies` | recipeConstraints + route |
| MED-001/004 | APPROVED condition block fails; DRAFT rule inert | recipeConstraints/Validate |
| LIMIT-001/002 | computed sodium over LIMIT fails; missing nutrient → review | recipeValidate |
| UNKNOWN-001/003 | unresolvable + allergen-hint identity fail closed | recipeValidate |
| GEN-001/002/005 | provider down → no fabrication; invalid AI → rejected; flag off → 404 | recipeGenerate |
| GEN-004 | all-invalid → VERIFIED fallback; none → `no_eligible_recipe` | recipeGenerate |
| SAVE-001/002 | posted status never trusted; valid→RESEARCH_DRAFT | recipeGenerate/E2E |
| E2E-001 | full pipeline honors allergy end-to-end | recipeE2E |
| EQUIP-001/002 | unknown equipment mention → clarify; known→pass | recipeValidate |

## Pending scenario coverage (top risk)

CACHE-001 (no cache layer yet — currently fail-open-by-absence since every
call recomputes), STALE-002, MULTI-001/002, PORTION-003, ISO-001
(cross-user recipe-name collision — mitigated by `ai:` sourceKey but not
isolation-tested), PERF-001, FLAG-002 (kill-switch mid-request), LABEL-005.

## Known test-harness artifacts

- Route tests hit `auth` bypass via `x-user-id` + `AUTH_TEST_BYPASS`.
- One Express stack trace prints in CI output (deliberate 500-path test);
  suite still green.
- Full repo suite (all jest files) not re-run end-to-end for this effort —
  targeted suites cover every touched module; run `npm test` in release gate.
