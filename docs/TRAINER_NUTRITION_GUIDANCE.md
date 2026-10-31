# Trainer Nutrition Guidance

Date: 2026-10-31 · Verified against `src/services/trainerNutritionService.js`, `src/routes/{trainerNutritionPlans,myNutritionPlans}.js`, `prisma/schema.prisma` (models 2017–2101). Flag: `trainer_nutrition_guidance_enabled`. Tests: `tests/trainerNutrition.test.js` (20).

## 1. Scope-of-practice rules (enforced in code, not just copy)

| Rule | Mechanism |
|---|---|
| Plans are *suggestions* | every read/mutation response carries `disclaimer: DISCLAIMER` (`'General fitness nutrition guidance — not medical nutrition therapy.'`, `trainerNutritionService.js:22`) |
| No auto-writes | the plan lifecycle never writes `FoodLog`/`MacroGoal`; the ONLY write path is the client's own `/log` action |
| Allergy check is consent-gated | `consentedAllergyCheck` runs only when `food_logs` **or** `nutrition_summaries` is granted on the active relation (`ALLERGY_CONSENT_CATEGORIES`) — the trainer cannot learn allergy data indirectly |
| Conflicts reported, never dropped | `findAllergyConflicts` returns warning rows `{itemId, mealId, mealType, item, allergen, match}`; items stay in the plan |
| No medical claims | guidance text is free-form (≤10000 chars); nothing labels plans as therapy |

## 2. Plan structure

```
TrainerNutritionPlan ──1:N──> TrainerNutritionPlanMeal ──1:N──> TrainerNutritionPlanItem
                    ──1:1──> TrainerNutritionTargets
                    ──1:N──> TrainerNutritionAssignment ──1:N──> TrainerNutritionFeedback
```

| Model | Fields |
|---|---|
| Plan | `title*`, `guidanceText`, `clientId?` (target client — requires active relation when set), `status draft\|published\|archived`, `version`, `supersedesId` (scalar, no FK) |
| Meal | `mealType` (breakfast/lunch/dinner/snack — arbitrary strings coerced), `timing`, `notes` |
| Item | **one of** `ingredientId` / `recipeId` / `foodName` required + `quantityG*` (0–100000) + `substitutions Json?` (≤2000 chars) |
| Targets (1:1) | `caloriesKcal, proteinG, carbsG, fatG, fiberG, waterMl` (each nullable, 0–100000) |
| Assignment | `status assigned\|accepted\|declined\|archived`, `assignedAt`, `respondedAt` |
| Feedback | `rating 1–5`, `note` |

Limits: ≤50 meals, ≤100 items/meal.

## 3. Lifecycle

```
draft ──publish──→ published ──revise──→ (new draft v+1, supersedesId→old; old→archived)
draft/published ──archive──→ archived
published ──assign──→ assignment(assigned) ──respond──→ accepted|declined
assigned|accepted ──feedback──→ rows      assigned|accepted ──/log──→ client FoodLog
```

- `createDraft`/`updateDraft`: children are **fully replaced** (delete+create; payload-omitted children re-created verbatim — same replace-children pattern as MealPlan).
- `publishPlan` requires ≥1 meal with ≥1 item.
- `revisePlan` accepts optional `{title, guidanceText, meals, targets, clientId}` overrides, else clones prior.
- `updateDraft` on non-draft → 409; `assignPlan` requires `published` + active relation; duplicate open assignment → 409.

## 4. Nutrition math reuse

Per-item computation (`computeItemNutrition`):

| Item kind | Math |
|---|---|
| `ingredientId` | `nutrition.scale(nutrition.fromIngredient(ingredient), quantityG)` — per-100g catalog values scaled; skipped when `ingredient.catalog.usable === false` |
| `recipeId` | stored recipe macro totals scaled by `quantityG/portionG` via `nutrition.scale` |
| `foodName`-only / unresolvable | all-null nutrition, `resolvable:false` |

`sumTotals` produces `totals` (null when any item lacks a key) and `partialTotals` (sum over known values) + `complete` flag — surfaced on meals and the whole plan via `attachNutrition`. Keys come from `nutrition.keys` (calories, proteinG, carbsG, fatG, fiberG).

## 5. Allergy-conflict system

| Piece | Detail |
|---|---|
| Source data | `UserAllergy → Allergy.name` (client's own saved allergies) |
| Canonical table | `ALLERGENS` const — 9 keys (`peanut, tree_nut, dairy, egg, gluten, shellfish, fish, soy, sesame`), each with name aliases, `IngredientAttribute` codes (e.g. `NUT`, `DAIRY`, `CONTAINS_GLUTEN`), and a name regex |
| Matching | allergy name → canonical matchers (`matchersForAllergy`); unmatched custom names fall back to a term-derived regex |
| Match channels | `ingredient_attribute` (ingredient attributes) or `name` (regex on display name) |
| Where surfaced | `previewPlan`, `assignPlan` (trainer side, consent-gated: `{consentGranted, allergyConflicts}`); `getClientAssignment` (client side — own data, ungated) |
| Never | removes/rewrites items; warns only |

## 6. API

Trainer `/trainer/nutrition-plans` (`requireFeature` + `requireRole('TRAINER')` + service-level approved/relation checks):

| Method | Path | Notes |
|---|---|---|
| POST | `/` | create draft; 201 plan + disclaimer |
| GET | `/` `?status=` | own plans + `_count` + targets + disclaimer |
| GET | `/clients/:clientId/progress` | trainer progress view (declared before `/:id`) |
| GET | `/:id` | plan + computed meals/totals + assignments + disclaimer |
| GET | `/:id/preview` | nutrition totals + consent-gated allergy check |
| PATCH | `/:id` | draft edit (replace-children) |
| POST | `/:id/publish` `/revise` `/archive` | lifecycle |
| POST | `/:id/assign` | `{clientId}` → 201 `{assignment, disclaimer, allergyCheckConsent, allergyConflicts}` |

Client `/me/nutrition-plans` (`requireFeature` + `identifyUser`):

| Method | Path | Notes |
|---|---|---|
| GET | `/` | `{disclaimer, assignments}` own rows |
| GET | `/:assignmentId` | plan + nutrition + own-allergy conflicts (ungated) |
| POST | `/:assignmentId/respond` | `{action: accept|decline}` |
| POST | `/:assignmentId/feedback` | `{rating?, note?}` — allowed on `assigned`/`accepted` |
| POST | `/:assignmentId/log` | `{mealId*, loggedAt?, items?}` → client-owned `FoodLog` rows |

## 7. Client log path → own FoodLog

`logAssignmentMeal`:

- Requires assignment `assigned`/`accepted` owned by caller; `mealId` must exist in the plan; optional per-item overrides (`itemId` must belong to the meal; `quantityG` + macro overrides).
- `loggedAt` must parse and not be >5 min in the future.
- Creates `FoodLog` rows for **the caller only** (`userId: clientUserId`, `crypto.randomUUID()` ids), copying plan `mealType` and resolved/computed nutrition.
- `nutritionSnapshot` provenance: `{source:'trainer_plan', loggedSource:'trainer_plan', trainerPlanId, trainerPlanVersion, trainerMealId, trainerItemId, grams, loggedFoodName, calculated}` — `nutritionSnapshot.source === 'trainer_plan'` is what the trainer progress summary counts.
- Items that can't resolve macros and get no explicit override → 400 with `{items: needInput}`; foodName-only items *need* macro overrides.
- `MacroGoal.source='trainer'` exists in schema values but has **no writer** — goals stay manual.

## 8. Trainer progress view (`getClientProgress` under `/trainer/nutrition-plans/clients/:clientId/progress`)

Requires active relation. Always returns assignments + `grantedCategories`; the `nutritionSummary` block (30-day window: `daysLogged`, `totalLogs`, `trainerPlanLogs`, macro totals from `FoodLog`) appears **only when `nutrition_summaries` or `food_logs` is granted**.

## 9. Error map

400 validation · 403 flag-off/unapproved/no-active-relation/consent-missing paths are silent-omission not errors · 404 non-owned plan/assignment (hidden) · 409 wrong-state/duplicate assignment.
