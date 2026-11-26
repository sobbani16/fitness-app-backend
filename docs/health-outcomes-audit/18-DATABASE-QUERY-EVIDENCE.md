# 18 — Database Query Evidence

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Date:** 2026-11-22
**Target:** `postgresql://localhost:5432/fitness_app` (dev). All queries READ-ONLY (SELECT/\d only). Re-runnable verbatim.

## Q1 — Row estimates, all user tables
```sql
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;
```
Result (top): ExerciseMuscle 3735, AuditLog 2861, User 2507, UserIngredient 1772, RecipeIngredient 1714, HealthEnergyRecord 1317, AuthSession 925, Exercise 884, UserRole 841, IngredientNutrient 486, Ingredient 426, IngredientServing 422, FoodLog 323, Recipe 258, IngredientCatalog 228, Supplement 207, HealthCondition 23, ConditionRule 34, HealthConditionNutrientRule 14, RuleEvidence 21, ActivitySafetyRule 71, UserHealthCondition 1.

## Q2 — HealthCondition contents
```sql
SELECT name FROM "HealthCondition" ORDER BY name;
```
23 rows: Celiac, CKD, Dairy Allergy, Egg Allergy, GERD, Gout, heart failure, High LDL Cholesterol, Hypertension, Hyperthyroidism, Hypertriglyceridemia, Hypothyroidism, IBS, Iron Deficiency, Lactose Intolerance, Nut Allergy, PCOS, Prediabetes, Pregnancy, Shellfish Allergy, Soy Allergy, Type 1 Diabetes, Type 2 Diabetes.
**40-target coverage: ~14/40 present** (T1D, T2D, Prediabetes, CKD, Celiac, GERD, Gout, HF, High LDL, HTN, Hypertriglyceridemia, Hypo/Hyperthyroid, IBS, PCOS). Missing: MASLD/NAFLD, insulin resistance, obesity, metabolic syndrome, PAD, CAD, post-stroke, constipation, functional bloating, alcoholic liver, OA, low-back pain, sarcopenia, osteopenia/osteoporosis, postural dysfunction, OSA, insomnia, depression, anxiety, chronic stress, asthma, kidney stones, gestational diabetes, fertility, elevated CV risk.

## Q3 — Rule review status
```sql
SELECT "reviewStatus", count(*) FROM "ConditionRule" GROUP BY 1;          -- DRAFT:34
SELECT "reviewStatus", count(*) FROM "HealthConditionNutrientRule" GROUP BY 1; -- DRAFT:14
SELECT "reviewStatus", count(*) FROM "ActivitySafetyRule" GROUP BY 1;      -- DRAFT:71
SELECT approved, "reviewStatus", count(*) FROM "SupplementInteractionRule" GROUP BY 1,2; -- all unapproved
```

## Q4 — Condition rules detail
```sql
SELECT hc.name, cr.attribute, cr.target, cr.action FROM "ConditionRule" cr
JOIN "HealthCondition" hc ON hc.id=cr."conditionId" ORDER BY 1,2;
```
34 rules across 14 conditions. `clinical_ingredient` target used by Celiac/Gout/Lactose (`clinical` action). T1D+T2D `HIGH_SUGAR→block` on both ingredient+supplement; HTN `HIGH_SODIUM→block`; CKD `HIGH_POTASSIUM/HIGH_PHOSPHORUS→block`, `HIGH_SODIUM→warn`.

## Q5 — RuleEvidence provenance
```sql
SELECT code, organization, "guidelineTitle" FROM "RuleEvidence" ORDER BY organization;
```
Real: ACR_GOUT_2020, ADA_EATING, AHA_SODIUM, AHA_SATURATED, AHA_DYSLIPIDEMIA_2026, ATA_IODINE, PCOS_GUIDELINE, NIH_IRON, NIDDK_CELIAC, NIDDK_DIABETES, NIDDK_CKD, NIDDK_LACTOSE. **9 rows: "Test Fixture"/"Fixture guideline" — pollution.**

## Q6 — Nutrient coverage
```sql
SELECT n.name, count(in2.id) FROM "Nutrient" n LEFT JOIN "IngredientNutrient" in2
  ON in2."nutrientId"=n.id GROUP BY n.name ORDER BY 2 DESC;
SELECT count(*) FROM "IngredientNutritionProfile";
```
All 27 nutrients: exactly 18 values each. **18 IngredientNutritionProfile rows for 426 ingredients = 4.2% micronutrient coverage.**

## Q7 — Recipe stored vs recomputed nutrition
```sql
WITH recomputed AS (
  SELECT r.id, r."recipeName", r."reviewStatus", r.servings, r.calories AS stored_cal,
         sum(ri."amountG" * i."caloriesPer100g" / 100.0) AS batch_cal
  FROM "Recipe" r JOIN "RecipeIngredient" ri ON ri."recipeId" = r.id
  LEFT JOIN "Ingredient" i ON i.id = ri."ingredientId" GROUP BY r.id)
SELECT "reviewStatus", count(*),
  sum(CASE WHEN abs(batch_cal/greatest(servings,1)-stored_cal) > 0.2*stored_cal THEN 1 ELSE 0 END) AS gt20pct
FROM recomputed GROUP BY "reviewStatus";
-- SYSTEM: 15/28 >20% off (avg |Δ|111kcal); RESEARCH_DRAFT: 0/230
```
Note: `Recipe.calories` is PER-SERVING; `RecipeIngredient.amountG` sums to the full batch (verified: 6-serving recipes show ~6× stored kcal).

## Q8 — Integrity checks
```sql
SELECT count(*) FROM "RecipeIngredient" ri WHERE ri."ingredientId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" i WHERE i.id=ri."ingredientId");  -- 0 orphans
SELECT count(*)-count(DISTINCT "normalizedName") FROM "Ingredient";            -- 23 dup names
SELECT count(*) FROM "Ingredient" WHERE source='test-fixture';                 -- 10
SELECT count(*) FROM "Exercise" e WHERE NOT EXISTS
  (SELECT 1 FROM "ExerciseMuscle" m WHERE m."exerciseId"=e.id);                -- 0 unmapped
SELECT count(*) FROM "ExerciseMuscle" WHERE role NOT IN ('primary','secondary'); -- 0
```

## Q9 — Macro vs stored kcal reconciliation (4-4-9)
```sql
SELECT CASE WHEN abs("caloriesPer100g"-("proteinPer100g"*4+"carbsPer100g"*4+"fatPer100g"*9))<=30 THEN 'ok'
            WHEN abs(...)<=80 THEN 'warn' ELSE 'high' END, count(*)
FROM "Ingredient" GROUP BY 1;   -- ok:383 warn:23 high:20 (spices/glucose-tabs/wine — explainable)
```

## Q10 — Servings + catalog verification
```sql
SELECT count(DISTINCT "ingredientId") FROM "IngredientServing";        -- 190/426 = 44.6%
SELECT "verificationLevel", usable, count(*) FROM "IngredientCatalog" GROUP BY 1,2; -- all GENERIC_COMPOSITION
```

## Q11 — Exercise distribution
```sql
SELECT category, count(*) FROM "Exercise" GROUP BY 1 ORDER BY 2 DESC;
-- strength 584, stretching 123, plyometrics 61, powerlifting 38, oly 35, strongman 21, cardio 14, null 8
```

## Q12 — User fixture density
```sql
SELECT count(*) FROM "User" WHERE email ILIKE '%test%' OR email ILIKE '%fixture%' OR email ILIKE '%example%'; -- 2427/2491
SELECT count(*) FROM "UserHealthCondition";  -- 1 (fixture-created)
```

## Q13 — IngredientAttribute errors
```sql
SELECT i.name, ia.attribute FROM "IngredientAttribute" ia JOIN "Ingredient" i ON i.id=ia."ingredientId";
-- Salmon,Atlantic: HIGH_MERCURY (wrong — low-mercury fish); Oats: CONTAINS_GLUTEN;
-- Banana: HIGH_GLYCEMIC+HIGH_SUGAR; Sweet potato: HIGH_GLYCEMIC; 23 rows total.
-- Attributes referenced by rules but never assigned: HIGH_SODIUM, HIGH_POTASSIUM,
-- HIGH_PHOSPHORUS, HIGH_PURINE, CONTAINS_HIGH_FRUCTOSE_CORN_SYRUP, CONTAINS_IODINE.
```

## Access needed for production certification
- Read-only replica or sanitized dump of prod `Ingredient*`, `Recipe*`, `FoodLog`, `HealthCondition*`, `RuleEvidence`, `User*` counts (no PHI columns), `ActivitySafetyRule`.
- Confirmation whether prod DBs contain different seed/rule data than dev.
