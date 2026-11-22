# Activity Safety — Open Issues & Decisions

## Open issues
1. `applyWeather` dead path — `weatherAdjusted` flag now truthfully exposed; canonical weather-aware suggestions moved to `GET /activity-safety/recommendation`. `/recommendations?weather=` remains for legacy clients; no consumer verified — candidate for deprecation.
2. ✅ RESOLVED: `/summary/daily` no longer claims weather accounting when none happened.
3. Mobile/backend hot-threshold mismatch — v2 env bands supersede locally; local buckets remain the offline fallback (still conservative).
4. `symptom_pathways` flag — `/activity-safety/symptoms` now implements the capture route; nutrition-side check-in flows still pending.
5. Medication model absent — `medicationActivityFlags` opt-in structured classes shipped; no med list is inferred, no dose advice.
6. Mobile `api/recommendations.ts` stale client — still unused; deprecate once health_aware path is default.
7. Emergency copy is template-based per symptom class (urgent vs review); region-specific numbers still a TODO (open).
8. **NEW** Real severe-weather alert provider missing — `alertsAvailable:false` honestly flagged; thunderstorm inferred from WMO codes only. Needed before production: NWS/cap feed or provider with alert coverage.
9. ✅ RESOLVED: `group_indoor` — `GROUP_INDOOR` category + `group_fitness_class` catalog entry with real demand metadata (weight-bearing, impact, balance). Indoor never implies safe (S052).
10. ✅ RESOLVED: all producers routed through shared `gate.js` — progressCoach COMPLETE_WORKOUT, weeklyHealthReview copy, sleepRecovery overlay, workoutPlanner/personalPlans (draft/edit/confirm/catalog/progression), workoutProgression (increase→review coercion), trainerCopilot (privacy-safe presence notice only), trainerPlanService (safetyConflicts annotation at assign + client view), formChecks (clientSafetyNotice), chat (post-generation deflection). See progress doc for per-producer semantics.
11. ✅ RESOLVED: mobile `SafetyReportScreen` (injury + symptom forms w/ backend codes) + `SafetyFeedbackScreen` (verdict vocabulary) + `safetyInvalidation` bus + Dashboard links — gated `activitySafetyEngine` (mobile `f5fa88d`).
12. ✅ RESOLVED: `scripts/activity-safety-shadow-diff.js` — live-vs-shadow deltas per candidate, privacy-preserving output, flag-off skip, `shadow:true`-only persistence. 6 tests green.
13. **PARTIAL** `isEvaluationFresh` still has no consumer recommendation-cache layer — evaluations are computed fresh on every request (correct but uncached). Cache layer is a performance item, not a correctness one.
14. **NEW** Producer-gate semantics note: `activityPushOk` requires the generic `strength_training` proxy to be fully `ALLOW` — a MODIFY verdict suppresses generic pushes too (deliberately conservative; the dedicated safety card remains).
15. **NEW** `no_safe_candidate` is currently unreachable at runtime: `seated_movement` is the intentional unblockable last-resort candidate, so restrictions alone always leave a suggestion. The disposition exists for future approved-rule activations (or all-candidate urgent suppression, which uses `suppressed_urgent`).

## Decisions log
- **Doc location:** backend `docs/` (engine artifacts); mobile audit stays in mobile repo.
- **Rule gating:** mirrored `ConditionRule` contract — `reviewStatus` DRAFT→REVIEWED→APPROVED, `RuleEvidence` link, APPROVED-only query default, CHECK constraint for approval metadata.
- **Engine shape:** multi-dimensional (medical/functional/environmental/personalization) → decision via DECISION_RANK merge. Structural mechanics are always-on code paths, not DRAFT rules.
- **Environments:** normalized observation; `alertsAvailable:false` honest; unknown/stale → INSUFFICIENT_DATA for outdoor.
- **Voice:** safety intents parsed BEFORE log intents; urgent symptom copy identical to manual path; undo supported.
- **Reminders:** urgent active symptoms suppress workout/movement sends (flag-gated).
- **todayActions:** `safety_check` card (weight 100) replaces start_workout/recovery_lighter when gated.
- **LLM boundary:** deterministic templates only for v1; any future rewording must pass post-generation validation.
- **Rest:** `rest` is a catalog candidate, never blocked; rest request suppresses suggestions entirely.
