# Release Readiness — Recipe Intelligence

**As of:** 2026-11-21 · branch `feat/activity-safety-engine` · commits `f390725`, `507c535`, `5c1f604`, `6c537a1`, `2df0669`

## Gate checklist

| # | Gate | Status | Evidence / gap |
|---|---|---|---|
| 1 | Server-authoritative restrictions (F-1 closed) | ✅ | `loadConstraints`; tamper tests |
| 2 | Deterministic validation on every user-facing recipe | ✅ | `validate.js`; E2E proves generate→save→customize |
| 3 | AI fail-closed: flag off → unavailable; provider down → no fabrication | ✅ | feature registry + generate tests |
| 4 | No unvalidated AI output reaches users | ✅ | every candidate through validator; RESEARCH_DRAFT on save |
| 5 | Nutrition recomputed from per-100g; missing → INSUFFICIENT not 0 | ✅ | `computeFromLines` + validate nutrition stage |
| 6 | Medical rules approval-gated (DRAFT inert) | ✅ mechanism | tests use synthetic APPROVED rules |
| 7 | **Any clinical rule actually enabled** | ❌ **BLOCKED** | 34+14 DRAFT, 0 approved — needs clinician signoff |
| 8 | Revalidation after every transformation | ✅ | `/customize` revalidates |
| 9 | Observability: counters + audit + admin endpoints | ✅ | `metrics.js`, `SafetyAuditLog`, admin routes |
| 10 | Data-quality findings reviewed + fixed | ⚠️ partially | report done; 150 missing-instr / 55 unlinked / 138 allergen gaps need data work |
| 11 | Cross-user isolation test | ✅ | ISO-001 in recipeE2E — per-user constraints, owner-scoped saves |
| 12 | Caching/versioning layer | ❌ not built | CACHE-001/STALE-002 pending — current no-cache posture is safe but costly |
| 13 | Mobile generation surface | ✅ code done | `RecipeByIngredients` generate flow, mobile `a4c2dbf`; flag-gated |
| 14 | Ranking/personalization beyond hard filter | ❌ not built | Phase 9 pending |
| 15 | Performance measurements vs targets | ⚠️ component-cost only | PERF-001 pending |
| 16 | Full-repo regression (`npm test`) | ⚠️ targeted only | 80 tests green; full suite not run |
| 17 | Production synthetic-user check behind flag | ❌ | requires deploy + flag control |
| 18 | Human clinical review of rules + evidence | ❌ | `medical-rule-evidence.md` protocol |
| 19 | DB migration | ✅ n/a | no schema changes — existing models reused |
| 20 | Documentation complete | ⚠️ 12/13 | this file completes the set with IMPLEMENTATION_PROGRESS |

## Readiness verdict

**Not production-ready for real users.** Ready for: internal/synthetic-user
testing behind `ai_recipe_generation_enabled` off-by-default, continued
data-quality work, and clinical review kickoff.

Blocking items for user-facing release: gates **7, 10** minimum;
recommended also **12, 14, 15, 16, 17**.

## Rollback posture

Both AI flags are off-by-default and kill each surface independently.
`AI_EMERGENCY_SHUTDOWN` is a global kill. Reverting the branch removes the
constraint/validator modules; `recipeMatch`/`customize` retrofits must be
reverted with them (they now depend on `constraints.js`).

## Required human actions

1. Clinician reviews + approves selected `ConditionRule`/`NutrientRule` rows
   (protocol in `medical-rule-evidence.md`).
2. Data owner fixes catalog/recipe gaps in `database-quality-report.md`.
3. Decide mobile UX scope for generation surface.
4. Production flag-flip + synthetic-user verification before real traffic.
