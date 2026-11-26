# pc-HUM-37 — Safety & Clinical Gating Audit

Scope: clinical-rule scenarios, reviewer integrity, flag isolation.
Source: backend `origin/main@3650bbb` (+ this branch's fixes). Test evidence
cited per finding; all suites run with `npx jest <file> --runInBand`.

## 1. Scenario coverage — VERIFIED GREEN

- `activitySafety.scenarioMatrix.test.js` (15.4k lines, generated matrix) +
  `activitySafety.scenarios.test.js` — 3,959 assertions across scenario/flag
  suites pass on this base. No uncovered scenario classes found this pass.
- `automation/flagMatrix.test.js` + `medicalFlagGovernance.test.js` — registry
  integrity, flag defaults, medical flag semantics: green.

## 2. Findings — fixed this increment

### F1 (high) — activation-gate bypass in rule consumers
`liveRuleWhere()` (APPROVED **and** activated, not retired, not expired,
review not overdue) is the contract every consumer must use. Five sites
queried bare `reviewStatus:'APPROVED'`, so an **unactivated** rule
constrained users before clinical activation, and — worse — a rule found
harmful post-approval could **not be stopped by deactivation/retire** on
these paths. Fixed:

| File | Before |
|---|---|
| `src/services/safety/supplementValidator.js` | bare APPROVED |
| `src/services/recipes/constraints.js` (×2: ingredient + nutrient) | bare APPROVED |
| `src/services/weekly/weeklyDietGenerator.js` (×2) | bare APPROVED |
| `src/services/safety/mealRecommendationService.js` | partial manual gate (missed expiry/reviewDue) — now `liveRuleWhere()`; JS `isRuleLive` belt already present |

Cross-ref: identical defect in `nutritionRecommendation.js` already fixed on
`humai/dev-07/pc-HUM-62-ai-eval` (`733e7e3`) — pending merge, not duplicated
here. Verified-correct consumers: mealSuggestion, foodIntelligence,
conditionEvaluation, activitySafety index+gate, healthScoreEngine,
health/engine, ingredientValidator.

### F2 (medium) — spoofable reviewer role in immutable audit events
`clinicalRules.js` passed `req.body?.actorRole` into `ClinicalRuleEvent` —
an immutable audit record claiming whatever role the caller asserted,
contradicting the schema comment ("NOT self-declared authority"). Now
records `req.userRoles` (DB-verified, populated by `requirePermission`).

### F3 (medium) — silent-path crash window in governance writes
`transition`/`activate`/`deactivateNow` did update-then-event as separate
calls — a crash between them changes rule status with **no audit event**,
violating the no-silent-path invariant. All three now run inside
`prisma.$transaction` with the event create.

### F4 (high) — legacy `/admin/clinical-rules/transition` integrity holes
Three compounding gaps on the pre-governance path:
1. **No from-state guard** — any `to` accepted (`REJECTED→APPROVED`,
   `DRAFT→APPROVED` skipping review entirely).
2. **Swallowable audit** — `safetyAuditLog.create().catch(()=>{})` meant an
   audit-write failure silently approved anyway.
3. **No `ClinicalRuleEvent`** — the immutable ledger misses every approval
   made through this path (incomplete provenance).

Now: `ALLOWED_FROM` map (demotion to DRAFT always allowed — safe
direction), approval/review ordering matches governed semantics, and
status-update + `ClinicalRuleEvent` + `safetyAuditLog` commit in one
transaction. Regression tests added (from-state guard 409s, event payload
with verified `actorRole`).

## 3. Flag isolation — verified + one open decision

Verified: rule enforcement (`isRuleLive`/`liveRuleWhere` consumers) is
**independent of feature flags** — flags gate routes, not safety evaluation.
`activity_safety_engine` off → `enabled:false`, producers keep legacy
behavior; the chat suppression flag "does not weaken recorded restrictions"
(holds — verified against `gate.js:139-181` and `chat.js` post-check).

- **F5 (open decision)** — `/admin/clinical-rules` sits outside
  `clinical_rule_admin` (registry lists `/super-admin/clinical-rules` only).
  Two parallel approval paths remain with different permissions
  (`ACADEMY_CLINICAL_REVIEW` vs `CLINICAL_RULE_APPROVE`/`ACTIVATE`).
  Since the flag defaults false, the legacy path is currently the *only*
  reachable transition route — deprecating or flag-gating it is a product
  decision (recommended: flag-gate behind the same `clinical_rule_admin`,
  or route it through `G.transition`).
- **F6 (nit, documented)** — `TRANSITIONS[].perm` is dead metadata; only
  `approve` is special-cased in the route. `review`/`reject`/`retire` rely
  on the umbrella `REVIEWER` permission — consistent with the documented
  separation-of-duties spec (only activator ≠ approver is enforced).
  Same-actor review→approve is permitted by spec.

## 4. Test evidence

| Command | Result |
|---|---|
| `npx jest tests/activitySafety tests/clinicalRuleWorkflow tests/healthOutcomes tests/recipe tests/supplement tests/meal tests/aiWeeklyGenerator tests/weekly tests/featureFlags tests/medicalFlagGovernance` | **4398/4398 pass** (35 suites) |
| `clinicalRuleWorkflow.test.js` | 10/10 incl. 2 new (from-state 409s; event write w/ verified role) |
| `recipeConstraints.test.js` | updated where-assertion to live-gate shape; 23/23 |

## 5. Remaining for human/clinical review

- F5 legacy-path deprecation decision (product/clinical-ops).
- Actual rule *activation* requires a human `CLINICAL_RULE_ACTIVATE`
  holder — separation of duties working as designed.
- Whether the same-actor review→approve convenience should be tightened
  (spec question, not a defect).
