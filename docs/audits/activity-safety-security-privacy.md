# Activity Safety — Security & Privacy Review

**Date:** 2026-11-21 · **Scope:** clinical data access, trainer visibility, audit/logging, push notifications · **Status:** one leak found & fixed (T-1); remaining items listed as gaps.

## Data classification

| Data | Class | Storage |
|---|---|---|
| Injuries, surgeries, restrictions, symptom reports, health conditions, pregnancy status | **Health data — sensitive** | UserInjury, UserSurgery, UserActivityRestriction, UserSymptomReport, UserHealthCondition, UserActivityProfile |
| Evaluations (decision, ruleIds, activityId, inputsStamp) | Derived health inference | ActivitySafetyEvaluation |
| Environmental observation (lat/lon only) | Location-adjacent | transient — never persisted with user linkage |
| Shadow output (userId, activityId, decisions, ruleCodes) | Internal-only | ActivitySafetyEvaluation `shadow:true` + stdout |

## Access matrix (verified in code)

| Surface | Who | What is visible | Enforcement |
|---|---|---|---|
| `/activity-safety/*` | self only | own safety state | `req.userId` from session; PATCH/feedback/`evaluate` scope all queries by `userId`; no cross-user params honored |
| `getForClient` plan view | client | own `safetyConflicts` incl. category detail (`detail:'full'`) | own data |
| `assign()` trainer response | trainer | conflict/unevaluated flags per authored exercise — **no `blockedCategories`, no `limitationConflict`, no clinical detail** | `detail:'summary'` (this review's fix T-1); no consent category exists for more |
| trainerCopilot | trainer | binary `safety_notice` + `review_recommended` only | presence-only; categories not shared |
| formChecks | trainer | `clientSafetyNotice` boolean | presence-only |
| Shadow diff stdout | operators | userId, activityId, decision codes, rule codes | tested (`activitySafety.shadowDiff.test.js` privacy case) |
| Push notifications | user | generic copy ("rest is a valid choice", "conditions look better") | no symptom/injury/condition text in any notification body — verified by copy audit |

## Findings

### T-1 — FIXED: trainer-facing assign response leaked restriction categories
`planSafetyConflicts` returned `blockedCategories` (e.g. `weight_bearing_lower`, `trunk_load`) and `limitationConflict` tokens in the `POST /trainer/workout-plans/:id/assign` response — inferring the client's clinical restrictions without consent. **Fix:** `detail:'summary'` for trainer paths strips both fields; per-exercise conflict flags remain (minimum needed to fix the plan). Client view keeps `detail:'full'` — own data. Test asserts the fields are absent.

### Verified safe-by-construction
- All safety routes force `userId` from session (`uid(req)`) — `where: {id, userId}` on updates; a forged `userId` in a body/param is ignored.
- `inputsStamp` on contexts invalidates stale evaluations; safety changes can't be bypassed by caching.
- LLM output is post-validated; deflection copy never quotes health state (generic suppression message).
- Shadow mode writes only `shadow:true` evaluations; live evaluation rows carry decision/ruleIds — no free-text health data.
- `followUps` ask only questions whose answers change the restriction (weight-bearing, reassessment, type).

## Remaining gaps (tracked in open-issues)

| # | Gap | Risk | Needed before |
|---|---|---|---|
| P-1 | No deletion/retention endpoint for safety data (injury/symptom/restriction rows persist indefinitely) | privacy hygiene | production — retention policy decision |
| P-2 | No consent category for trainer clinical visibility — currently hard-blocked (correct), but product may want opt-in | feature gap | any richer trainer notice |
| P-3 | `consentScopes` on UserActivityProfile exists but nothing reads it for activity-safety surfaces | dead field | when trainer detail is reconsidered |
| P-4 | Region-specific emergency copy ("local emergency services") — generic by design | UX | international launch |
| P-5 | Symptom-report `notes`/injury `rehabInstructions` are user free-text — stored, not yet surfaced anywhere (no leak surface today, but retention + access review needed if ever displayed) | latent | any UI that renders them |

## Verified via tests
`activitySafety.producers.test.js` (conflict summary without categories), `activitySafety.shadowDiff.test.js` (privacy output), `activitySafety.routes.test.js` (flag gating + per-user scoping), `activitySafety.e2e.test.js` (stateful per-user isolation).
