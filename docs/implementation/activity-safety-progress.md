# Activity Safety Engine — Implementation Progress

**Branch:** `feat/activity-safety-engine` · **Started:** 2026-11-21
**Resume instructions:** read this file → `git log --oneline` this branch → `docs/implementation/activity-safety-open-issues.md` → continue next exact task.

## Current phase
Phase 2→3 transition (inventory complete; evidence register next).

## Completed
- [x] Phase 1 inventory → `docs/audits/health-activity-current-state.md` (all 12 recommendation producers traced; dead paths verified)
- [x] Branch created; user WIP from nutrition workstream identified — commits stage activity-safety files only
- [x] Confirmed existing gating precedent to mirror: `ConditionRule.reviewStatus` (DRAFT→REVIEWED→APPROVED) + `RuleEvidence` + DB CHECK + `scripts/verify-rule-gating.js`

## In progress
- Phase 2: `docs/clinical/activity-safety-evidence-register.md` + `docs/clinical/clinical-review-queue.md`

## Next exact task
Write evidence register with real citations (CDC PA guidelines, ACOG Committee Opinion 804, ACSM preparticipation screening, EPA AQI, NOAA lightning, AAOS/APTA NWB rehab) — every rule `reviewStatus: pending_review` (DRAFT).

## Files modified (mine only)
- `docs/audits/health-activity-current-state.md` (new)
- `docs/implementation/activity-safety-progress.md` (new)
- `docs/implementation/activity-safety-test-results.md` (new)
- `docs/implementation/activity-safety-open-issues.md` (new)

## Tests executed
- Backend `tests/weatherService.test.js` 10/10 ✅ (audit)
- Backend engine probe: `recommendFromBalance` × 20 combos → applyWeather never fires (dead code verified)
- Mobile `weatherContext.test.ts` + `useWeather.test.js` 15/15 ✅ (audit)

## Failing tests
None from my work. Pre-existing WIP state: `A06` nutrition fixture intentionally red (`docs/nutrition-intelligence/NEXT_SESSION.md`).

## Pending migrations
None yet — Phase 3 will add UserInjury, UserActivityRestriction, UserSymptomReport, ActivitySafetyRule, ActivitySafetyEvaluation, EnvironmentalObservation via `prisma migrate diff --from-migrations --to-schema-datamodel` → create-only migration (per AGENTS.md: never `migrate dev`/`reset`).

## Clinical review blockers
- ALL activity-safety rules ship DRAFT/`pending_review` — inert until clinician approval (mirrors ConditionRule contract; user's explicit release gate).

## Known limitations (as of this checkpoint)
- `symptom_pathways` flag registered but no routes exist (nutrition-side placeholder).
- `decisionEngine.js` is nutrition-scoped; activity engine gets its own multi-dimensional evaluator.
- No medication model exists — medication-activity flags will be opt-in structured fields, never an inferred med list.

## Commit IDs
- (pending first checkpoint)
