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
9. **NEW** `group_indoor` category referenced by AS-SYS-004 not in catalog — rule inert until catalog gains group-class activities.
10. **NEW** Trainer-facing + wearable + coaching entry points not yet wired (trainerCopilot, wearable insights, ai_coach re-rank). Engine gate exists for todayActions, voice, dashboard.
11. **NEW** Mobile feedback UI surface not built (API client exists); symptom/injury entry screens not built — voice + API paths work.
12. **NEW** Shadow-mode diff tooling: persist exists; offline comparison job not written.
13. **NEW** `isEvaluationFresh` cache-invalidation is implemented but has no consumer cache yet (evaluations are computed fresh; cache layer arrives with the recommendation cache work).

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
