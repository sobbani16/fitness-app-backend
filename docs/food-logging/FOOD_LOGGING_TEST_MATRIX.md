# Food Logging — Test Matrix

| ID | Category | Test | Status |
|---|---|---|---|
| DB-001 | integrity | IngredientServing rows have grams>0, label, sourceRecord | pending |
| SR-001 | serving resolution | search 'Whole wheat bread, ready' → servings include slice w/ verified grams | pending |
| SR-002 | serving resolution | toDto emits catalog servings over label-serving derivation | pending |
| NC-001 | conversion | 1 slice=28g → 69.16 kcal; 2 slices → 138.32 (247/100g) | pending |
| NC-002 | conversion | unit switch preserves grams; round-trip no drift | pending |
| NC-003 | conversion | missing nutrient stays null, not 0 | pending |
| UI-001 | state | portion edit updates all macros; unit sheet lists serving+g/oz | pending |
| UI-002 | regression | dup 'kcal / 100g · per 100g' text never reappears | pending |
| PL-001 | persistence | save→retrieve keeps quantity, unit label, nutrition snapshot | pending |
| SEC-001 | isolation | food log userId scoping; cannot read another user's row | pending |
| E2E-001 | exact record | bread: search→slices→portion kcal→save→reopen (Phase 12 mandatory) | pending |
