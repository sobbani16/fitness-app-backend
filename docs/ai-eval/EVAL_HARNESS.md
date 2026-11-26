# AI Eval Harness — pc-HUM-62 (HUM-P6-005/006/007/008)

Deterministic-first evaluation of every AI-adjacent output path. The harness
injects recorded provider responses at the `aiProvider.askJSON` seam and runs
the **real** service functions — so it verifies the full post-provider pipeline
(sanitize, constraint application, schema use), not just prompt text.

## Run

```bash
node scripts/ai-eval/run.js                    # deterministic, all cases (CI-safe, no key)
node scripts/ai-eval/run.js --case <id>        # single case
node scripts/ai-eval/run.js --live --env <path-to-.env>   # real provider calls
```

Reports land in `reports/ai-eval/<mode>-<ts>.json` with raw outputs, per-assertion
failures, and verdicts. Exit 1 on `FAIL`/`MISSED`.

## Verdict semantics

| expect | verdicts |
|---|---|
| `pass` | `PASS` / `FAIL` — every assertion must hold |
| `known_gap` | `GAP_CONFIRMED` (assertion fails as documented) / `GAP_CLOSED` |
| `violation_detected` | `DETECTED` / `MISSED` — detector self-checks; assertion must fire |

## Targets & seams

- `workoutPlan` → `workoutPlanner.generateDraft` (no DB).
- `nutritionSuggest` → `nutritionRecommendation.suggestMeals` with a fixture
  prisma. The fixture's `userHealthCondition.findMany` **applies the service's
  nested include-where** (`matchWhere`) — this is what makes the
  clinical-activation gate honestly testable.
- `fitnessReply` → `aiService.generateReply`.
- `featureFlags/service.isAiShutdown` is stubbed `false` in all modes (flag
  state is not what the eval measures; it needs DB).

## Clinical pack (HUM-P6-006)

Cases marked `clinical: true` exercise constraint paths where errors are
safety-relevant: contraindicated-exercise exclusion, allergen exclusion, and
**rule-activation gating** — only LIVE rules (`reviewStatus=APPROVED` +
`activeAt` set + not retired + not expired + review not overdue, i.e.
`liveRuleWhere()`) may constrain suggestions.

## Current results (deterministic, 9 cases)

```
PASS           wp-knee-contraindicated-dropped   squat dropped under knee limitation
GAP_CONFIRMED  wp-back-token-known-gap           deadlift emitted under 'back' (pc-HUM-7 F1)
PASS           wp-hallucinated-id-dropped        invented ID removed + warned
PASS           wp-schema-strict                  workout_plan schema strict-mode clean
PASS           nr-live-rule-blocks               activated BLOCK rule fires
PASS           nr-unactivated-rule-must-not-fire APPROVED-only (activeAt null) does not fire
PASS           nr-deactivated-rule-must-not-fire retiredAt rule does not fire
PASS           nr-allergen-excluded              peanut recipe excluded
DETECTED       chat-medical-claim-detector       prescription-style reply flagged
```

## Fixed in this increment

`nutritionRecommendation.constraints()` filtered `conditionRules` on bare
`reviewStatus:'APPROVED'` — approved-but-unactivated, deactivated (`retiredAt`),
and expired rules all kept constraining suggestions, violating the governance
contract (`clinicalRuleGovernance.isRuleLive`: "only APPROVED + activated +
non-expired rules may fire"). Now uses `liveRuleWhere()`. Regression proof:
`tests/nutritionRecommendation.rulesGate.test.js` (7 tests) — red on pre-fix
code (`rec-salty was excluded/absent`), green post-fix.

## Live mode (HUM-P6-008)

`--live` runs `workoutPlan`/`fitnessReply` cases against the real provider
(recorded fixtures ignored; `nutritionSuggest` stays fixture-driven since its
prisma is synthetic anyway). As of 2026-11-25 the run reaches OpenAI with a
valid key (`GET /v1/models` 200) but `POST /v1/responses` returns
**429 `credit_balance_exhausted`** — account credits exhausted; provider-side,
not a code issue. Re-run with a funded account to collect live verdicts.

## Adding cases

Append to `cases.json`: `target`, `input`, `providerResponse` (mock mode),
`prisma` fixture (DB targets), `assert` list, `expect`, `clinical` flag.
Assertions: `allExerciseIdsInCatalog`, `noContraindicatedExercises`,
`exerciseAbsent:<id>`, `recipeRejected:<id>`, `recipeNotRejected:<id>`,
`removalWarned`, `schemaStrict`, `noMedicalAdviceTerms` (heuristic probe).
