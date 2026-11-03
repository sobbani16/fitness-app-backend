# Energy Intelligence — calories in vs out

Single backend-owned contract: `GET /energy/summary?date=&tz=` → `energy-v1`
(`src/services/energySummary.js`). Web (`/dashboard` EnergyCard, `/progress`
DualTrend) and mobile (Dashboard energy card, offline fallback `services/energy.ts`)
render the same numbers.

## Terminology contract (never interchange)

- **BMR** — profile estimate (Mifflin-St Jeor). Never labeled "measured".
- **Resting energy** — wearable-reported basal kcal over an interval (device
  measurement with its coverage window).
- **Active energy** — movement kcal over an interval. Workout calories are
  usually already inside it — never added twice.
- **TDEE** — BMR × activity factor = full-day FORECAST incl. routine movement.
- **Expended so far** — measured/estimated kcal for elapsed local time.
- **Projected day** — actual so far + baseline estimate for the remainder.
- **Logged intake** — recorded food kcal only; never a confirmed total intake.

## Source precedence (never blindly summed)

1. Single wearable provider per metric = the one with most covered interval
   minutes (ties → healthkit > health_connect > fitbit). Different providers
   are never summed.
2. Same-provider resting records for resting; else another provider's resting.
3. Profile estimate (Mifflin + activity factor).
4. Explicit `null` — missing data is never zeroed.

Overlapping same-provider intervals are deduplicated by proportional
allocation (`dedupedKcal`): each record's kcal is allocated over its original
span, and only still-uncovered in-day portions count. Records are clipped to
the local day first.

## Day boundaries

Local midnights resolved via Intl (`localDayBounds`) — DST yields 23h/25h days
automatically since elapsed fractions are computed on instants. tz resolution:
request `tz` > `User.timeZone` > `ReminderPreference.timezone` > UTC.

## Balance honesty

- `balance.provisionalKcal` = logged − expended-so-far — only when meals exist,
  always labeled provisional.
- `balance.completedDayKcal` = always null (intake completeness unverifiable).
- `computeDailyBalance` no longer subtracts exercise (TDEE contains it).
- `recommendFromBalance` never prescribes workouts to offset food — types:
  `log | review | maintain | rest | eat_regular`.
- `/recommendations` no longer invents `caloriesIn=2200`; absent intake →
  `intakeProvided:false` → `log` suggestion.

## Progress

`GET /me/progress` entries now include `expenditureKcal` + `expenditureSource`
('wearable' | 'wearable+estimated_resting' | 'estimate'). Null on unknown days —
charts show gaps, not fake drops to zero.

## What Should I Eat Now — `GET /meal-suggest`

`meal-suggest-v1` (`src/services/mealSuggestion.js`):
occasion (user-tz hour) → context → HARD filters → rank → options with
reasons. Filters can never be overridden by ranking/AI. Suggestions never
scale to a provisional deficit.

Hard eligibility (applied to recipes AND trainer plan items):
- allergies (keyword-expanded allergen matching on names + ingredients)
- `NEVER_RECOMMEND` food preferences
- `dietaryRestrictions` (vegetarian/vegan/gluten-free/dairy-free/...)
- active health-condition `ConditionRule` blocks (target='ingredient',
  action='block') matched via the Ingredient attribute catalog
- trainer/nutritionist `MealPlan` items surface first (`fromPlan: true`) and
  still pass through every hard filter

Eligibility metadata is returned per call (`allergiesChecked`,
`restrictionsApplied`, `conditionBlocksApplied`, `excludedRecipes`) and
recomputed on every request — profile or restriction changes take effect
immediately. Name-matching is deterministic but not a clinical guarantee
(disclosed in the response).

## Ingestion

`POST /health-data/energy` accepts `restingKcal` per record (same upsert
dedupe by provider+sourceId). Migration `20261207000000`: adds
`HealthEnergyRecord.restingKcal`, `User.timeZone`.

Fixed pre-existing bug: the ingestion validator used `Number.isFinite()` on
`Date` objects — always false — so every synced record was silently dropped.
Now validates `getTime()` and rejects reversed intervals.

## Known limitations

- Wearable resting extrapolated to full day over covered window (labeled).
- Meal eligibility = name/keyword matching + ingredient-attribute block rules;
  unlisted allergens in unnamed ingredients can't be proven.
- Condition-block rules match only cataloged `Ingredient` names — free-text
  recipe ingredients outside the catalog aren't attribute-checked.
- AI re-rank not wired (rules engine is the required fallback path anyway).
- `completedDayKcal` will stay null until intake completeness can be verified.

## Real-device verification checklist (before release)

1. iOS device with Apple Health: grant energy permissions, sync, confirm
   `resting.source = wearable:healthkit` and `active.soFarKcal` matches the
   Health app's active-energy total for covered intervals.
2. Android device with Health Connect: same flow, expect
   `wearable:health_connect`. Verify no double count vs Apple Health on a
   device that reports both (winner = better coverage, not sum).
3. Airplane-mode rest day: no wearable → `estimate:mifflin_st_jeor` resting,
   nonzero `expenditure.soFarKcal`, `dataGaps` lists missing wearable data.
4. Log one small breakfast → `balance.provisionalKcal` labeled provisional;
   no "deficit" language anywhere.
5. Complete profile → delete weight → summary returns nulls +
   `profile_incomplete`, never zeros.
6. Kill backend → mobile Dashboard falls back to local `services/energy.ts`
   estimates without crashing.
