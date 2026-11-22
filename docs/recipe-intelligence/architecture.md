# Recipe Intelligence — Architecture

## Principle

AI generates **candidates**. Deterministic systems validate them. No AI output
reaches a user as validated; nutrition is always recomputed from trusted
per-100g data; unknowns are surfaced, never silently safe.

## Data flow

```
user request (items/diet/cuisine/time/servings)
        │
        ▼
loadConstraints(userId, request)          src/services/recipes/constraints.js
  merges: UserAllergy, UserHealthCondition+ConditionRule(APPROVED),
          HealthConditionNutrientRule(APPROVED), FoodPreference,
          UserPlanningPreferences, FoodInventory, MacroGoal
  request params narrow-only — server profile always wins
        │
        ├──► POST /recipes/match-ingredients ─ recipeMatch.js
        │      violatesHard per recipe (text/declared/category/tags/attrs)
        │      → matched verified/system recipes + excluded counters
        │
        ├──► POST /recipes/generate ─ recipes/generate.js  [flag: ai_recipe_generation_enabled]
        │      askJSON candidates (max 3) → validateGeneratedRecipe each
        │      FAIL → rejected[]  ·  PASS/REVIEW/CLARIFY → candidates[]
        │      all fail → 1 correction retry (ruleIds fed back)
        │      → VERIFIED-recipe fallback via matchIngredients
        │      → else no_eligible_recipe
        │
        ├──► POST /recipes/save-generated     [same flag]
        │      server-side revalidation of posted candidate
        │      RESEARCH_DRAFT + ai: sourceKey + disambiguated name
        │
        └──► POST /recipes/:id/customize     [flag: recipe_customization_ai_enabled]
               AI proposes changes → per-line violatesHard on adds/swaps
               → full validateGeneratedRecipe on transformed recipe
               → validation.status + provenance.revalidated
        │
        ▼
recipes/validate.js — staged pipeline
  schema → identity → quantity → decompose → allergen → exclusion →
  pattern → medical → nutrition → limits → feasibility → safety →
  servings → substitution → eligibility
        │
        ▼
SafetyAuditLog (checkType 'recipe_validation') + recipes/metrics.js counters
        │
        ▼
GET /admin/recipe-intelligence/metrics | /validation-log (VIEW_PLATFORM_ANALYTICS)
```

## Module map

| File | Role |
|---|---|
| `recipes/constraints.js` | Normalized constraints: `loadConstraints`, `violatesHard`, `textHasTerm`, `RESTRICTIONS` vocabulary |
| `recipes/validate.js` | `validateGeneratedRecipe`, `loadCatalog`, `recordValidation`, `SAFETY_RULES` |
| `recipes/generate.js` | Candidate generation, retry budget, fallback, NO_ELIGIBLE_RECIPE |
| `recipes/metrics.js` | In-process counters (status/ruleIds — no user content) |
| `recipeMatch.js` | Inventory-based matching on the same constraint object |
| `foodIntel.js` | Label/barcode suitability — shares `LABEL_ANIMAL_TERMS` |
| `recipeImport.js` | `computeFromLines` — deterministic per-100g nutrition |
| `mealSuggestion.js` | `keywordsFor`/`ALLERGEN_KEYWORDS` — the keyword base the constraint engine extends |

## Trust boundaries

- **Client → server:** allergies/diet in request JSON can only ADD restrictions.
- **AI → validator:** candidates carry no trusted nutrition/safety fields.
- **Validator → presentation:** `validation.status` accompanies every candidate;
  RESEARCH_DRAFT until human review.
- **Cache:** none yet — every call recomputes constraints + validation
  (CACHE-001 scenario pending; versioning keys exist: `constraintVersion`,
  `validatorVersion`).

## Flags

`ai_recipe_generation_enabled` (new, fail-closed) gates `/generate` +
`/save-generated`; `recipe_customization_ai_enabled` gates `/customize`.
`askJSON` adds quota + `AI_EMERGENCY_SHUTDOWN` + provider-failure mapping.
