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
| P-1 | No deletion/retention endpoint for safety data | privacy hygiene | **FIXED (Phase 15)** — `DELETE /activity-safety/{injuries,symptoms,restrictions,feedback}/:id`, user-scoped; clinician-documented restrictions soft-delete to `superseded` (audit trail preserved). Residual: no bulk purge or scheduled retention job — policy decision |
| P-2 | No consent category for trainer clinical visibility | feature gap | **FIXED (Phase 15)** — `safety_restrictions` consent category added; `safetyDetailLevel()` grants `detail:'full'` only on an explicit grant (relation consent row or `consentScopes.safetyRestrictions`), else `summary`. `safetyDetail` field disclosed in assign responses |
| P-3 | `consentScopes` on UserActivityProfile unread | dead field | **FIXED (Phase 15)** — `consentScopes.safetyRestrictions.scope==='granted'` now wired as a grant source for trainer detail (alongside TrainerClientConsent) |
| P-4 | Region-specific emergency copy generic | UX | **FIXED (Phase 15)** — `emergencyCopy(region)` map (us/ca 911, gb 999/112, eu/in 112, au 000, nz 111) on declared region only — never geo-inferred; unvalidated input falls back to generic. Residual: no User.country field exists — region is client-declared per request |
| P-5 | Free-text `notes`/`rehabInstructions` latent exposure | latent | **VERIFIED+GUARDED (Phase 15)** — regression tests assert neither field appears in any response payload (`/profile`, injury create); stored-only. Residual: any future UI surfacing them needs its own access review |

## Verified via tests
`activitySafety.producers.test.js` (conflict summary without categories), `activitySafety.shadowDiff.test.js` (privacy output), `activitySafety.routes.test.js` (flag gating + per-user scoping), `activitySafety.e2e.test.js` (stateful per-user isolation).
