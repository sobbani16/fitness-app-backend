# Activity Safety — Open Issues & Decisions

## Open issues
1. `applyWeather` dead path in `recommendationEngine.js` — decision needed: emit real workout-type recs vs remove plumbing (Phase 8).
2. `/summary/daily` insight falsely claims weather is accounted for — fix wording or wire evaluation (Phase 8).
3. Mobile/backend hot-threshold mismatch (28 vs 32 °C) — resolved server-side by weather_intelligence_v2; local fallback keeps conservative copy.
4. `symptom_pathways` flag registered with no routes — either implement symptom check-in here or document.
5. Medication model absent — Phase 3 adds opt-in medication-activity *flags* (heat sensitivity, hypoglycemia risk…) as structured fields; never an inferred med list, never dose advice.
6. `RecommendationType` in mobile `api/recommendations.ts` is stale vs engine types — fix or delete dead client file (Phase 8).
7. Emergency escalation copy must be region-appropriate — store escalation text per symptom class, not generic.

## Decisions log
- **Doc location:** program docs in `fitness-app-backend/docs/` (engine/schema/rules/flags are backend artifacts); mobile audit stays at `fitness-app-mobile/docs/audits/weather-recommendation-audit.md`.
- **Rule gating:** mirror `ConditionRule` contract — `reviewStatus` DRAFT→REVIEWED→APPROVED, `RuleEvidence` linkage, query-level APPROVED filtering, golden tests for draft-vs-approved, `verify-rule-gating`-style proof script.
- **Engine shape:** multi-dimensional (medical eligibility / functional suitability / environmental suitability / personalization) → disposition, per spec — not a single collapsed status.
- **Scenarios:** new `data/activitySafetyScenarios.json` + fixture runner mirroring `scenarioFixtures.test.js` (execute real engine; `blocked_not_implemented` reported not asserted).
- **LLM boundary:** deterministic templates only for v1 safety copy; AI rewording (if any) must pass post-generation output validation before display.
