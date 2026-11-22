# Release Readiness — Recipe Intelligence

**As of:** 2026-11-21 · branch `feat/activity-safety-engine` · through commit `8fb6e56` (+ mobile `a4c2dbf`)

## Gate checklist

| # | Gate | Status | Evidence / gap |
|---|---|---|---|
| 1 | Server-authoritative restrictions (F-1 closed) | ✅ | `loadConstraints`; tamper tests |
| 2 | Deterministic validation on every user-facing recipe | ✅ | `validate.js`; E2E + synthetic verify |
| 3 | AI fail-closed: flag off → unavailable; provider down → no fabrication | ✅ | flag OFF→403 verified live in synthetic run (before + after) |
| 4 | No unvalidated AI output reaches users | ✅ | every candidate through validator; RESEARCH_DRAFT on save; posted-PASS tamper → 422 |
| 5 | Nutrition recomputed from per-100g; missing → INSUFFICIENT not 0 | ✅ | `computeFromLines` + validate; `/nutrition` now serves saved recipes (portionG persisted) |
| 6 | Medical rules approval-gated (DRAFT inert) | ✅ mechanism | tests use synthetic APPROVED rules |
| 7 | **Any clinical rule actually enabled** | ❌ **BLOCKED** | 34+14 DRAFT, 0 approved — needs clinician signoff via workflow |
| 8 | Revalidation after every transformation | ✅ | `/customize` revalidates — verified live |
| 9 | Observability: counters + audit + admin endpoints | ✅ | `metrics.js`, `SafetyAuditLog`, admin routes |
| 10 | Data-quality findings reviewed + fixed | ⚠️ improved | verified-tier applied — see table below; residuals are needs-human by design |
| 11 | Cross-user isolation test | ✅ | ISO-001 + synthetic verify isolation checks |
| 12 | Caching/versioning layer | ✅ built | `recipes/cache.js` version-stamped; CACHE-001/STALE-002 green; shared content only, never user verdicts |
| 13 | Mobile generation surface | ✅ code done | `RecipeByIngredients` generate flow; typecheck+lint clean; flag-gated |
| 14 | Ranking/personalization beyond hard filter | ✅ built | deterministic `rankScore` post-filter; exclusion-invariance tests |
| 15 | Performance measurements vs targets | ✅ | PERF-001 — see `performance-report.md` |
| 16 | Full-repo regression (`npx jest`) | ✅ | **125 suites / 1554 tests green**; mobile **73/423 green**, tsc clean |
| 17 | Production synthetic-user check behind flag | ✅ | `recipe-synthetic-verify.js` 22/22 vs real app+DB+AI; flag OFF throughout for real users |
| 18 | Human clinical review of rules + evidence | ❌ | workflow built (`/admin/clinical-rules/*`); 0/48 approvable — evidence gaps |
| 19 | DB migration | ✅ n/a | no schema changes — existing models reused |
| 20 | Documentation complete | ✅ | 13/13 deliverables |

## Data remediation results (gate 10 detail)

| Finding | Before | After | Residual |
|---|---|---|---|
| Undeclared allergen lines | 138 | 9 | needs-human (ambiguous names) |
| Unlinked ingredient lines | 55 | 17 | 16 composite + 1 ambiguous |
| Meat recipes, no temp guidance | 62 | 31 | non-poultry meats lack verified safe temp |
| Recipes missing instructions | 150 | 150 | not invented — content authoring needed |
| Catalog allergen hints | 44 | 5 | millet-FP exclusions + unverifiable |
| GLUCOSE macro defect | 1 | 0 | capped at 100g/100g (physical max) |
| Clinical rules DRAFT | 48 | 48 | awaiting qualified reviewer |

## Readiness verdict

**Not production-ready for real users.** Every user-facing code gate is
built, tested, and verified live against the real AI provider and database —
but the two gates that require humans remain open:

- **Gate 7/18 — clinical signoff.** 0/48 rules carry evidence sufficient for
  approval; 31 have no evidence record at all, 14 lack thresholds. The
  approval workflow is live (`ACADEMY_CLINICAL_REVIEW` + ≥20-char attestation
  + gap-blocked transitions + audit) and nothing is approvable today — by
  design. Medical restrictions stay inert until a qualified reviewer signs.
- **Gate 10 tail — data quality.** The verified tier is applied; the
  residual (150 missing instructions, 17 unlinked lines, 9 allergen gaps)
  needs a data owner — we do not invent declarations or content.

## Synthetic verification summary (gate 17)

22/22 checks pass with the flag toggled in-process only (never global):
flag gating/rollback, per-user constraint loading, allergy exclusion,
dislike-vs-NEVER semantics, real AI generation → NEEDS_REVIEW candidate,
save → RESEARCH_DRAFT, posted-PASS tamper → 422, customize → revalidation,
nutrition recomputed per-100g, meal logging, owner-scoped isolation.
Two real defects found and fixed: empty-pantry item resolution and missing
`portionG`/`finishedYieldG` persistence on save.

## Rollback posture

`ai_recipe_generation_enabled` + `recipe_customization_ai_enabled` are
off-by-default and kill each surface independently. `AI_EMERGENCY_SHUTDOWN`
is a global kill — verified live (403 before and after the flag window).

## Required human actions

1. Clinician reviews + approves selected `ConditionRule`/`NutrientRule` rows
   via `/admin/clinical-rules` (protocol in `medical-rule-evidence.md`).
2. Data owner resolves residual gaps in `database-quality-report.md`
   (instructions authoring, 17 unlinked lines, 9 allergen hints).
3. Decide mobile UX scope for the generation surface.
4. Production flag-flip + re-run `scripts/recipe-synthetic-verify.js`
   against the deployed environment before real traffic.
