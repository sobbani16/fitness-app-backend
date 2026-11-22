# Fiber Intelligence — Release Readiness

**Status: READY FOR STAGING / FLAGGED-OFF ROLLOUT. NOT for production enablement.**

## What was built

Backend (`fitness-app-backend`):

| Surface | File(s) | Notes |
|---|---|---|
| Feature flags (7) | `src/config/featureRegistry.js` | `fiber_intelligence_enabled` parent; daily-goal, sequencing, reminders, supplements, AI, voice subs. All OFF by default, server-enforced via `requireFeature` |
| Personalized target | `src/services/fiber/targets.js` | 14 g/1000 kcal for adults; pediatric AI table; pregnancy/lactation references; restriction-aware conservative fallback; provenance (`formula`, `ai_table`, `life_stage`, `default`, `custom`, `clinician`, `stored`/`unknown`) |
| Suggestion catalog | `src/services/fiber/suggestions.js` | Deterministic food-first suggestions; allergy/dislike aware |
| Daily engine | `src/services/fiber/dailyEngine.js` | confirmed/estimated/unknown/planned/supplement taxonomy; `inputsHash` covers logs+target+conditions+allergies+prefs; persists `FiberDailyRecommendation` audit row; reminder body builder |
| Sequencing | `src/services/fiber/sequencing.js` | veg→protein→starch with fruit precedence fix; mixed dishes not separated; optional fiber-side suggestion; disclaimer copy |
| Supplement check | `src/services/fiber/supplementCheck.js` | Label-verified fiber only; safety gates; `FiberSupplementCheck` audit rows; never a dose |
| AI/voice grounding | `src/services/fiber/assistant.js` + `src/routes/chat.js`, `src/routes/voice.js` | Deterministic interception; LLM never answers fiber questions |
| API | `src/routes/fiber.js` (mounted in `routes/index.js`) | `/fiber/target` GET/PUT, `/fiber/daily`, `/fiber/trend`, `/fiber/sequence`, `/fiber/suggestions`, `/fiber/supplement-check` (+/:id/confirm), `/fiber/supplement-education` |
| Reminders | `src/services/reminders/constants.js`, `scheduler.js` | `fiber` category, send-time body, flag-gated planning, gap-closed suppression |
| Schema | `prisma/schema.prisma` + `20261224000000_fiber_intelligence` | `MacroGoal.fiberTargetBasis/fiberTargetNote`, `RecipeIngredient.fiberG`, `FiberDailyRecommendation`, `FiberSupplementCheck` — additive only |

Mobile (`fitness-app-mobile`):

| Surface | File(s) |
|---|---|
| API client | `src/api/fiber.ts` |
| Components | `src/components/fiber/MealOrderCard.tsx`, `FiberProgressCard.tsx`, `FiberSupplementSheet.tsx` |
| Integrations | `PhotoMealScreen.tsx` (non-blocking sequence card), `DashboardScreen.tsx` (fiber progress card + safety-invalidation refresh), `SmartRemindersScreen.tsx` (fiber opt-in), `reminderPlan.ts` (fiber excluded from static local scheduling), `featureKeys.ts` |

## Verification performed (actual)

- Backend full suite: **148/148 suites, 5,796 tests pass** (2 skipped, 48 todo)
- Fiber-focused suites: 68/68; route gating: 15/15
- `npx prisma validate` clean; `prisma migrate status` — dev DB up to date
- Mobile: `tsc --noEmit` clean; full jest 77/78 suites pass (DashboardScreen passes standalone — earlier OOM was a dep-array regression, fixed); eslint clean on touched files
- Live DB checks: `/fiber/daily`, `/fiber/trend` (31 g personalized), assistant grounding (dal 17 g, broccoli 2.6 g, oats 10.1 g per 100 g), sequencing runs

## Updates since initial readiness (follow-up session)

- **Assistant dry-basis fix**: "dal"-type questions previously resolved to one
  alphabetically-first dry-basis row (chana dal, 17 g/100 g). Now multi-match
  dry entries answer with an explicit range + dry-weight caveat; single
  dry-marked rows get a basis note; raw-named rows unaffected. See
  FIBER_DATA_AUDIT §8.
- **Payload fix**: `GET /fiber/daily` target object now carries
  `reviewRequired` + `restrictions` (was only inside `safety`) — found by the
  E2E suite.
- **Weekly review added**: `GET /fiber/weekly` (`fiber-weekly-v1`) — 7-day
  rollup distinguishing incomplete logging from low intake, recurring-pattern
  food suggestions, nonjudgmental verdicts. Mobile surfaces the headline +
  first pattern inside `FiberProgressCard`.
- **New coverage**: `tests/fiber.e2e.test.js` — 21 real-DB scenario tests;
  mobile `FiberCards.test.js` — 20 component tests. Full suites re-verified.

## Known limitations

- 64% of existing food logs have `NULL fiberG`; 21 ingredients lack `fiberPer100g`; `Supplement.fiberG` default 0 is a recorded value, not measured (see FIBER_DATA_AUDIT.md). Engine treats these as unknown — never zero.
- Suggestions catalog is curated (~20 items), not the full ingredient DB.
- Supplement fiber check covers psyllium/soluble-fiber naming patterns only.
- Medication interaction knowledge for psyllium: none published → `medications_not_evaluated` is surfaced, not "safe".
- Reminder weekly-review phase from the brief is not implemented (daily engine only; the `/fiber/weekly` API + card headline covers the review UX, no weekly reminder exists).

## Safety posture

- Flags all OFF by default; enabling requires both parent and sub-flag.
- No dose, frequency, or prescription language anywhere; supplement path is
  eligibility + label-verified facts + education only.
- Sequencing copy carries evidence-informed, non-guarantee wording.
- Supplement safety review NOT clinically completed — see
  `SUPPLEMENT_SAFETY_REVIEW.md` for the gate before enabling
  `fiber_supplement_suggestions_enabled`.

## Rollout recommendation

1. Ship code with all `fiber_*` flags off — zero user-visible change.
2. Enable `fiber_intelligence_enabled` + `fiber_daily_goal_enabled` for a
   cohort first (lowest-risk surface: read-only progress).
3. Then sequencing, then reminders, then AI/voice.
4. `fiber_supplement_suggestions_enabled` LAST — only after the clinical
   review gate in SUPPLEMENT_SAFETY_REVIEW.md is cleared.
