# Constraint Taxonomy — Normalized User Constraint Engine

Module: `src/services/recipes/constraints.js` · version `recipe-constraints-v1`

The constraint engine produces one normalized object per request that every
recipe surface (match, customize, and the upcoming generate/validate path)
consumes. Server records are authoritative; request parameters can only narrow
the result set — a client can never remove a saved allergy, exclusion, or
medical restriction. (Closes audit finding F-1.)

## 1. Constraint classes

| Class | Source | Effect | Can client remove? |
|---|---|---|---|
| Allergy (confirmed) | `UserAllergy` + `Allergy` | hard block — terms, declared allergens | never |
| Medical restriction | `UserHealthCondition` + `ConditionRule` where `reviewStatus='APPROVED'`, `target='ingredient'`, `action='block'` | hard block via `IngredientAttribute` | never |
| Medical warning | same, `action='warn'` | advisory (`warnRules`) | never |
| Hard exclusion | `FoodPreference=NEVER_RECOMMEND`, `exclude_*`/`exclude:` restrictions, `request.exclusions` | hard block on terms | never (request adds only) |
| Dietary pattern | `UserPlanningPreferences.dietaryRestrictions`, `request.diet/restrictions` | hard block on terms/categories/tags | never |
| Dislike | `FoodPreference=DISLIKE` | soft — `soft.dislikes`, never a hard block | yes (it's soft) |
| Nutrition limits | `MacroGoal` | `limits` — targets, not hard blocks yet | n/a |
| Equipment | `planning.availableEquipment` ∩ request | feasibility filter | request narrows only |
| Availability | `FoodInventory` | ranking/matching input | n/a |
| Unknown/unverifiable | computed | `unknown[]` — recorded, surfaced, never treated as safe | — |

DRAFT/REVIEWED `ConditionRule`s are deliberately inert — consistent with
`mealSuggestion`, `foodIntel`, and `conditionEvaluation`. Unapproved rules
cannot hard-block.

## 2. `NormalizedConstraints` shape

```js
{
  version, userId, generatedAt,
  hard: {
    allergenTerms: Set,      // expanded keywords (peanut → peanut, groundnut)
    excludeTerms: Set,       // exclusions + pattern terms
    bannedCategories: Set,   // normalized catalog categories
    bannedTags: Set,         // nutritionSource.tags
    bannedAttributes: Set,   // IngredientAttribute values (APPROVED rules)
    patterns: [{key, kind, source}],
    medicalConditions: [{id, name, severity, kind, rules}],
    warnRules: [{attribute, action, reason, conditionName}],
  },
  soft: { dislikes, likes, cuisines, budgetLevel, cookingSkill, householdSize, mealPrepStyle },
  limits: { caloriesTarget, proteinTarget, carbsTarget, fatTarget, fiberTarget, source } | null,
  equipment: [],
  availability: { items: [{name, quantityG, expiresAt}] },
  unknown: [{key|field, reason}],
  request: { cuisine, maxPrepMinutes, servings },
  provenance: { sources, narrowingOnly: true },
}
```

## 3. Canonical restriction vocabulary (`RESTRICTIONS`)

Keys are underscore-normalized (`canonRestriction`). Each maps to mechanism
sets: `terms` (word-boundary text match), `categories` (catalog category),
`tags` (nutritionSource.tags), `attributes` (IngredientAttribute), and
`unverifiable` notes.

| Key | Enforces | Cannot verify (surfaced in `unknown`) |
|---|---|---|
| `vegetarian` | meat/fish terms, Animal protein + Seafood categories, meat/fish/shellfish tags | — |
| `eggetarian` | same as vegetarian; egg lines exempted at match layer | — |
| `vegan` | vegetarian + milk/egg/honey terms, Dairy + Eggs categories | — |
| `pescatarian` | meat terms minus fish; Animal protein category | — |
| `gluten_free` | wheat/barley/rye/etc. terms, `CONTAINS_GLUTEN` attribute | — |
| `dairy_free` | milk-group terms, Dairy category | — |
| `nut_free` | specific-nut terms, Nuts category, `NUT` attribute | — |
| `peanut_free` | peanut/groundnut terms, `PEANUT` attribute | — |
| `egg_free` | egg/mayo terms, Eggs category | — |
| `soy_free` | soy/tofu/tempeh terms | — |
| `fish_free` / `shellfish_free` | fish / crustacean+mollusc terms, Seafood category | — |
| `low_carb` | sugar/bread/pasta/rice terms | — |
| `halal` | pork + alcohol + animal-additive terms | slaughter method, certification, cross-contact |
| `kosher` | pork + shellfish + additives | certification, meat/dairy separation, utensil status |
| `jain` | meat + egg + onion/garlic/potato/honey terms | root-vegetable completeness, preparation |

Unknown restriction keys are NOT silently dropped: they are recorded in
`unknown` as unverifiable and enforced as a conservative literal term match.

### Matching semantics

- `textHasTerm(text, term)` — word/phrase boundary + trailing-plural `s`.
  `egg` matches `egg`/`eggs`, NOT `eggplant`; `nut` does NOT match `walnut`
  (specific nuts are listed individually); `peanut` matches `peanut butter`.
- `hasTerm(set, term)` — plural-tolerant set membership (`peanut`↔`peanuts`).
- A positive match can establish a conflict; **absence of a match never proves
  safety** — undeclared derivatives and cross-contact remain `unknown`.

## 4. `violatesHard(hard, subject)`

Shared checker used by `matchIngredients` and `/customize`:

```js
subject = { text, allergens: [], category, tags: [], attributes: [] }
→ null | { ruleId, severity: 'block', reason }
```

| ruleId | Trigger |
|---|---|
| `ALLERGEN_TEXT` | allergen keyword in ingredient/recipe text |
| `ALLERGEN_DECLARED` | declared allergen intersects user terms |
| `EXCLUDED_TERM` | exclusion term in text |
| `BANNED_CATEGORY` | catalog category conflicts with pattern |
| `BANNED_TAG` | nutritionSource tag conflicts |
| `CONDITION_ATTR` | IngredientAttribute blocked by APPROVED medical rule |

## 5. Endpoint integration

- `POST /recipes/match-ingredients` — hard check on `recipeName + all line
  names` text, declared + line-level allergens, tags, attributes; per-line
  category check retains the `eggetarian` egg exemption. Response `excluded`
  now reports `{allergy, diet, prepTime, exclusion, condition}`.
- `POST /recipes/:id/customize` — AI-proposed add/substitute lines run
  `violatesHard` (text, declared allergens, category, tags, attributes) before
  being applied; declared-allergen warning uses expanded user terms.

## 6. Known limitations (tracked, not hidden)

- Term matching cannot prove absence: `NO_RELIABLE_SOURCE_MATCH` ingredients
  carry no declared allergens — they pass unless their name trips a term.
- `peanut butter` trips the word `butter` for `vegan`/`dairy_free`
  (conservative false-positive; the old keyword sets behaved identically).
- Halal/kosher/Jain are partial — enforced on observable terms, flagged
  unverifiable for certification-level claims.
- Duplicate `peanut`/`Peanuts` allergy rows exist in data (audit §7) —
  expansion is name-based so both map correctly, but data dedupe is a separate
  cleanup task.
