# ACTIVITY_SAFETY_REGRESSION_REPORT

**Sprint-B baseline check:** the 18 `activitySafety.*` failures Sprint A attributed to uncommitted engine WIP were **resolved by owner work (Phase 15)** before this sprint: symptom-alias registry, derivable profile flags, wildcard/composite matching, reachability audit (65 reachable + 4 mirrors + 2 UNSUPPORTED_INPUT), privacy P-1..P-5 fixes, India env sources.

**Verified this session:** `tests/activitySafety.scenarios.test.js` + `tests/activitySafety.reviewPackage.test.js` → **111/111 pass**; full suite **130/1622/0-fail**. No Sprint-B changes touched `activitySafety/*` — no new regressions introduced; nothing reverted.
