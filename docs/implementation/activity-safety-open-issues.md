# Activity Safety — Open Issues & Decisions

## Open issues
1. `applyWeather` dead path — `weatherAdjusted` flag now truthfully exposed; canonical weather-aware suggestions moved to `GET /activity-safety/recommendation`. `/recommendations?weather=` remains for legacy clients; no consumer verified — candidate for deprecation.
2. ✅ RESOLVED: `/summary/daily` no longer claims weather accounting when none happened.
3. Mobile/backend hot-threshold mismatch — v2 env bands supersede locally; local buckets remain the offline fallback (still conservative).
4. `symptom_pathways` flag — `/activity-safety/symptoms` now implements the capture route; nutrition-side check-in flows still pending.
5. Medication model absent — `medicationActivityFlags` opt-in structured classes shipped; no med list is inferred, no dose advice.
6. Mobile `api/recommendations.ts` stale client — still unused; deprecate once health_aware path is default.
7. Emergency copy is template-based per symptom class (urgent vs review); region-specific numbers still a TODO (open).
8. ✅ RESOLVED: NWS alerts via `api.weather.gov/alerts/active?point=` — live-verified (NYC `nws-us`+alert, MexicoCity `unsupported`, Paris `unsupported`, outage `unavailable`). Coverage = US + territories only; elsewhere honest `alertsAvailable:false`.
9. ✅ RESOLVED: `group_indoor` — `GROUP_INDOOR` category + `group_fitness_class` catalog entry with real demand metadata (weight-bearing, impact, balance). Indoor never implies safe (S052).
10. ✅ RESOLVED: all producers routed through shared `gate.js` — progressCoach COMPLETE_WORKOUT, weeklyHealthReview copy, sleepRecovery overlay, workoutPlanner/personalPlans (draft/edit/confirm/catalog/progression), workoutProgression (increase→review coercion), trainerCopilot (privacy-safe presence notice only), trainerPlanService (safetyConflicts annotation at assign + client view), formChecks (clientSafetyNotice), chat (post-generation deflection). See progress doc for per-producer semantics.
11. ✅ RESOLVED: mobile `SafetyReportScreen` (injury + symptom forms w/ backend codes) + `SafetyFeedbackScreen` (verdict vocabulary) + `safetyInvalidation` bus + Dashboard links — gated `activitySafetyEngine` (mobile `f5fa88d`).
12. ✅ RESOLVED: `scripts/activity-safety-shadow-diff.js` — live-vs-shadow deltas per candidate, privacy-preserving output, flag-off skip, `shadow:true`-only persistence. 6 tests green.
13. **PARTIAL** `isEvaluationFresh` still has no consumer recommendation-cache layer — evaluations are computed fresh on every request (correct but uncached). Cache layer is a performance item, not a correctness one.
14. **NEW** Producer-gate semantics note: `activityPushOk` requires the generic `strength_training` proxy to be fully `ALLOW` — a MODIFY verdict suppresses generic pushes too (deliberately conservative; the dedicated safety card remains).
15. ✅ RESOLVED (changed by eligibility audit): `seated_movement` is now restrictable via `upper_limb_load`/`trunk_load` prohibitions — chair work still loads arms/trunk. `rest` is excluded from the suggestion slot entirely: blanket prohibition → `no_safe_candidate` + `restFallback` marker (never "suggestion: rest"). `no_safe_candidate` IS now reachable at runtime.
16. **NEW** Clinical review package findings (auto-generated, `docs/clinical/activity-safety-review-package.md`): 4 URGENT rules are structural mirrors (short-circuit precedes rule evaluation — by design); 22 rules inert as encoded: wildcard tokens (`__any__`/`__always__` match literally), unreachable profileFlags (e.g. `wb_non_weight_bearing`, `env_stale`), non-canonical symptom codes (`severe_dyspnea`, `neuro_deficit`, `severe_headache`, `muscle_soreness_doms`, `systemic_illness` — vocab mismatch vs SYMPTOMS_URGENT/REVIEW), uncovered catalog categories (`contact_fall_risk`, `supine_prolonged`, `overhead` — no activity carries them). Reviewer must decide per rule: fix encoding, map aliases, or rely on structural coverage.
17. **NEW** Privacy fix T-1 (see `docs/audits/activity-safety-security-privacy.md`): trainer `assign` response leaked `blockedCategories`/`limitationConflict` → `detail:'summary'` strips them. Open P-items: P-1 retention endpoint, P-2 consent category for trainer clinical detail, P-3 dead `consentScopes` field, P-4 region emergency copy, P-5 free-text fields latent.
18. **NEW** Merge tie-break fix: `DEFER_OUTDOOR` (3.5) > `MODIFY` (3), `BLOCK_ACTIVITY` (5.5) > `NEEDS_CLINICAL_REVIEW` (5) — equal-rank merges could downgrade env deferrals and documented blocks. Shadow report regenerated: 39 disagreements, all stricter, 0 LOOSER.

## Decisions log
- **Doc location:** backend `docs/` (engine artifacts); mobile audit stays in mobile repo.
- **Rule gating:** mirrored `ConditionRule` contract — `reviewStatus` DRAFT→REVIEWED→APPROVED, `RuleEvidence` link, APPROVED-only query default, CHECK constraint for approval metadata.
- **Engine shape:** multi-dimensional (medical/functional/environmental/personalization) → decision via DECISION_RANK merge. Structural mechanics are always-on code paths, not DRAFT rules.
- **Environments:** normalized observation; `alertsAvailable:false` honest; unknown/stale → INSUFFICIENT_DATA for outdoor.
- **Voice:** safety intents parsed BEFORE log intents; urgent symptom copy identical to manual path; undo supported.
- **Reminders:** urgent active symptoms suppress workout/movement sends (flag-gated).
- **todayActions:** `safety_check` card (weight 100) replaces start_workout/recovery_lighter when gated.
- **LLM boundary:** deterministic templates only for v1; any future rewording must pass post-generation validation.
- **Rest:** `rest` is a non-exercise fallback, never blocked — and never the `suggestion` either (restFallback marker). Rest request suppresses suggestions entirely.
