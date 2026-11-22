# Recipe Validation Spec — `validateGeneratedRecipe`

Module: `src/services/recipes/validate.js` · version `recipe-validator-v1`

## Purpose

Every recipe a user may see — AI-generated, imported, or transformed — passes
through one deterministic pipeline before it can be presented. AI output is a
*candidate*, never a verdict. The validator independently re-checks identity,
constraints, nutrition, feasibility, and food safety using trusted backend
data only.

## Signature

```js
await validateGeneratedRecipe(recipe, constraints, ctx)
// recipe:      {name|recipeName, servings, ingredients|lines[], instructions[], allergens?, substitutions?, finishedYieldG?, portionG?}
// constraints: NormalizedConstraints from loadConstraints(userId)
// ctx:         {prisma, catalog} — catalog from loadCatalog(prisma) or auto-loaded
```

## Outcome contract

```js
{
  status: 'PASS' | 'FAIL' | 'NEEDS_CLARIFICATION' | 'NEEDS_REVIEW',
  validatorVersion: 'recipe-validator-v1',
  violations: [{ ruleId, stage, severity, reason }],
  warnings:   [reason…],                       // severity==='warn' subset
  stages:     { schema: {status}, identity: {status}, … },
  nutrition:  { perServing: {calories, proteinG, carbsG, fatG, fiberG}|null,
                computedLines, missingLines, provenance },
  constraintVersion: 'recipe-constraints-v1',
}
```

Severity → status mapping (worst severity wins):

| severity | status | meaning |
|---|---|---|
| `block` | `FAIL` | hard violation — cannot be shown as usable |
| `clarify` | `NEEDS_CLARIFICATION` | user input needed (e.g., missing amount) |
| `review` | `NEEDS_REVIEW` | unverifiable — requires human/clinical review |
| `warn` | `PASS` | advisory only, surfaced in `warnings[]` |

## Stages and rule IDs

| # | stage | ruleIds | severity semantics |
|---|---|---|---|
| 1 | schema | `SCHEMA_NAME`, `SCHEMA_SERVINGS`, `SCHEMA_LINES`, `SCHEMA_LINE_NAME` | all `block` — malformed candidates abort here |
| 2 | identity | `INGREDIENT_UNRESOLVED` | `block` when user has allergies (fail-closed), else `review` |
| 3 | quantity | `QUANTITY_MISSING`, `QUANTITY_NONPOSITIVE`, `QUANTITY_IMPLAUSIBLE` | missing: `clarify` (required) / `warn` (optional); bad values: `block` |
| 4 | decompose | `COMPOUND_UNRESOLVED` | undeclared compound (sauce/mix/broth…) — `block` with allergies, else `review` |
| 5 | allergen | `ALLERGEN_TEXT`, `ALLERGEN_DECLARED` | `block` — name text OR declared allergens OR compound components |
| 6 | exclusion | `EXCLUDED_TERM` | `block` — NEVER_RECOMMEND / exclude_* / pattern terms |
| 7 | pattern | `BANNED_CATEGORY`, `BANNED_TAG` | `block` — catalog category or nutritionSource tag conflicts |
| 8 | medical | `CONDITION_ATTR` (block), `CONDITION_WARN` (warn) | APPROVED `ConditionRule` attributes via `IngredientAttribute` |
| 9 | nutrition | `NUTRITION_MISSING`, `NUTRITION_IMPLAUSIBLE`, `NUTRITION_ZERO` | missing: `review` under medical rules else `warn`; implausible: `review` |
| 10 | feasibility | `INSTRUCTIONS_MISSING`, `INSTRUCTIONS_UNREFERENCED`, `INSTRUCTION_EXTRA_INGREDIENT` | missing steps `clarify`; hallucination guards `review`/`clarify` |
| 11 | safety | `POULTRY_TEMP_UNVERIFIED`, `RAW_EGG_RISK`, `RAW_FLOUR`, `LEFTOVER_RICE`, `SHELLFISH_RAW` | `review` or `warn` — deterministic keyword rules, never proof of safety |
| 12 | servings | `SERVING_IMPLAUSIBLE`, `SERVING_TINY` | `review` / `warn` on gram-per-serving sanity |
| 13 | substitution | `SUB_UNRESOLVED`, plus any hard ruleId | unresolved `review`; constraint hit `block` |

## Safety rules (deterministic, conservative)

| ruleId | fires when | expects | severity |
|---|---|---|---|
| `POULTRY_TEMP_UNVERIFIED` | chicken/turkey/duck in lines | instructions cite ≥165°F or ≥74°C | review |
| `RAW_EGG_RISK` | egg lines + raw/uncooked language | — (pattern is inherently unsafe) | review |
| `RAW_FLOUR` | flour + raw/no-bake language | — | review |
| `LEFTOVER_RICE` | rice + leftover/reheat language | refrigeration/reheat guidance in steps | warn |
| `SHELLFISH_RAW` | shellfish + raw/ceviche language | — | review |

## Revalidation triggers (enforced by callers)

Revalidate whenever ingredients, quantities, portions, cooking methods,
substitutions, user restrictions, medical limits, ingredient data, or safety
rules change — and whenever a cached or shared recipe is reused. `/customize`
already runs the full pipeline on every transformation
(`provenance.revalidated: true`, response carries `validation.status`).

## Integration points

- `POST /recipes/generate` — AI candidates → validator → only non-FAIL
  candidates returned, `FAIL`s reported in `rejected[]` with ruleIds.
- `POST /recipes/:id/customize` — transformed line set + original
  instructions revalidated; result in `validation` field.
- `matchIngredients` — ranking path uses the same `violatesHard` hard-filter
  semantics (shared mechanism, not a parallel engine).

## Deliberate non-goals / limits

- The validator does not certify halal/kosher compliance or allergen-free
  status — those surface via `constraints.unknown`.
- Ingredient text matching can establish conflicts, never prove absence —
  `INGREDIENT_UNRESOLVED` + allergies = fail closed.
- Instruction↔ingredient cross-checks are heuristic (names in step text);
  deeper instruction parsing is a later increment.
- `SERVING_*` bounds are gram sanity checks, not dietary advice.
