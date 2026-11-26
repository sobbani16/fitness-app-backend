# Smart Meal Order — integration coverage matrix (pc-HUM-207, evidence-dated 2026-11-26)

Every row verified against `origin/main` source in both repos. Legend: ✅ integrated / ❌ gap / n/a.

## Canonical engine invariant
- Single engine: `src/services/fiber/sequencing.js` (`sequenceMeal`). Consumers in main: `src/routes/fiber.js` (POST /fiber/sequence), `src/services/fiber/assistant.js` (Hey Leo). **No competing ordering algorithm exists** — invariant test-pinned in `tests/sequencingIntegrationInvariant.test.js`.
- Flags: `fiber_intelligence_enabled` + `fiber_meal_sequencing_enabled` — `default:false, failOpen:false`, production-ineligible (stage-1 internal only). Fail-closed verified by test.

## Meal-entry path matrix (mobile = fitness-app-mobile@main, backend = main)

| # | Entry path | Integration status | Evidence |
|---|---|---|---|
| 1 | Manual food entry (LogMealScreen) | ❌ **gap** | `LogMealScreen.tsx` — 0 sequencing references; multi-component manual meals never sequenced |
| 2 | Manual entry — persisted photo-meal expansion (FoodEntryScreen) | ✅ | imports `sequenceMeal`+`MealOrderCard`; stale-response guard via `seqRequest` counter; fires on expandedMeal/items change, not keystroke |
| 3 | Food search | ❌ gap | search is a single-food picker feeding LogMealScreen — inherits gap #1 |
| 4 | Custom food creation | ❌ gap | single-food flow, no composition surface |
| 5 | Photo meal recognition (PhotoMealScreen) | ✅ | consumes sequence after component confirmation (per baseline + fiber.ts import) |
| 6 | Barcode scanning | ❌ gap | barcode flows (LogMealScreen/FoodIntelligenceScreen/PortionAdjustScreen) — 0 sequencing references |
| 7 | Saved meals | ❌ gap | QuickAdd.tsx — no sequencing |
| 8 | Recently consumed | ❌ gap | same QuickAdd path |
| 9 | Repeated meals | ❌ gap | same |
| 10 | Recipe logging | ❌ gap | recipe log path treats recipe as single mixed unit — correct per mixed-dish rules, but no sequencing vs separate sides |
| 11 | Meal duplication | ❌ gap | duplication copies logs without re-evaluation |
| 12 | Voice / Hey Leo | ✅ backend | `fiber/assistant.js` consumes canonical `sequenceMeal` + `mixedDishIn` — no parallel implementation |
| 13 | Trainer-assigned meals (ClientMealPlanScreen) | ❌ gap | 0 sequencing references |
| 14 | Planned meals | ❌ gap | same |

## Isolation correctness (already correct by design, test-pinned pc-HUM-26)
Single-food entries do not produce irrelevant suggestions — engine requires multi-component composition; mixed dishes (biryani/pizza/khichdi/pasta/sandwich/upma) never decomposed; unknown fiber ≠ zero. Evidence: `tests/fiberSequencingReal.test.js` 32/32 (PR #23, open — **merge-blocked**, see below).

## Integration gaps closing this card vs sibling lanes
- Mobile UI integration for gaps #1/#6-11/#13-14 is **Eshwar's lane (HUM-21)** — this card supplies the backend contract + audit, not duplicate mobile implementation.
- Backend sequencing correctness increment is PR #23 (pc-HUM-26, OPEN — needs QA merge). PR #30 (pc-HUM-61) also touches fiber.js — merge-order coordination required.
- Release engineering (flags/rollout) is Suresh's lane (HUM-24, PR #32 open) — this card does not duplicate.

## Release readiness assessment
- Flags remain fail-closed; production enablement requires clinical gates (fiber intelligence subsystem includes unresolved clinical features — do NOT enable the parent flag to expose meal ordering; a narrowly-scoped sequencing-only release mechanism is the documented requirement).
- Exact release config (when approved): server env overrides `FF_FIBER_MEAL_SEQUENCING_ENABLED=true` in staging first, internal TestFlight cohort, then production only after clinical+QA gates. Never `fiber_intelligence_enabled` in production until clinical sign-off.
