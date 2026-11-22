# SPRINT_B_INTEGRATION_REPORT

| Piece | Path | Surface | State |
|---|---|---|---|
| trends-v1 | `trends.js` → `unifiedProgress` | `GET /me/progress/unified` `.trends` | backend+surface (existing flag `leo_progress_enabled`; mobile Progress screen renders payload — new fields additive) |
| symctx-v1 | `symptomContext.js` → trends | `.trends.symptoms` (reports/associations/escalation) | backend+surface |
| detectOutcomeDivergence | trends → `DailyScoreSnapshot` | `.trends.reviews[]` | backend+surface |
| goal-aware observations | trends templates | `.trends.observations[]` (kcal/protein/fiber vs target, coverage+confidence labeled) | backend+surface |
| wearable energy cap | `GET /progress` | `source:'wearable_capped_implausible'` | backend |

**UI note:** additive response fields — existing clients render them when present; dedicated symptom-history/insight screens remain a mobile/web follow-up (documented, not claimed).

**Suite:** 130 suites / 1,622 tests / **0 failures** (+11 Sprint-B tests: trends 6→(now incl. observations), symptomContext 5, capabilityIntegration 5). activitySafety suites green post-Phase-15.

**Gates unchanged:** medical flags OFF; 0/120 scenario + 0/95 rule approvals; symctx outputs observational only.
