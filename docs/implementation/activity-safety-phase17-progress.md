# Phase 17 Progress — Staging, Clinical Infrastructure & Live Validation

- **Branch**: `feat/activity-safety-engine` · **P16 exit**: `d3cabc7` · latest: see `git log`
- **Test baseline**: 135 suites; full run §11 below. User-owned Sprint-B nutrition WIP present — kept out of all commits.

## Status

| § | Task | Status | Evidence |
|---|---|---|---|
| 1 | P16 verify | ✅ | 65+4+2+0 rules, user WIP untouched |
| 2 | Clearance precedence | ✅ | `resolveClearance` in engine.js (specificity > dates > provenance, restriction>clearance); 12 tests `activitySafety.clearance.test.js`; doc `activity-clearance-precedence.md` |
| 3 | Exercise coverage | ✅ | Unmapped→`unevaluated` conflict rows (not silent-safe); 884=742 full/134 partial/8 review; matrix in `exercise-library-safety-quality.md` |
| 4 | Staging | **BLOCKED** — no creds | Exact steps in `staging-e2e-validation.md` |
| 5 | Live write-paths | ✅ | 8 paths on real dev schema, synthetic user, cleaned up — same doc |
| 6 | J12/J15 | ✅ | `Recommendation.staleAt` + migration `20261223000000`; `recommendationSafety.js`; invalidation on all safety-record writes/deletes; push-suppression at send-time; 6 tests green; `activity-notification-safety.md` |
| 7 | Reviewer infra | ✅ | `reviewer-approval-package.md` (tier routing, version-pin, SoD, export map) + `observe.js` emits `safety.rule.inert_unexplained` |
| 8 | Monitoring | ✅ | `observe.js` — code/count-only events + ALERTS table; wired into invalidation/suppression/gate-error/untyped-notification paths |
| 9 | DB pool flake | ✅ root cause | ~27/100 conns held by long-lived dev procs (19-day `src/index.js`); fix: `connection_limit=5` under NODE_ENV=test. Residual flake: `voice.test.js` UNDO — **pre-existing** order-dependent real-DB state (failed identically pre-cap); documented, not concealed |
| 10 | Claims inventory | ✅ | `activity-safety-claims-inventory.md` — restriction-enforcement + urgent copy flagged REVIEW REQUIRED (US + India); no self-classification |
| 11 | Full regression | ✅ 1 residual | 133/134 suites, 5490/5546 pass. Sole failure: voice UNDO (pre-existing flake; passes standalone). Safety/env/review suites all green |
| 12 | Final report | ✅ | `activity-safety-phase17-final-report.md` |

## Next session
- Mobile suite run (`fitness-app-mobile` typecheck/jest/lint) — not yet executed this phase.
- Human-owned: staging provisioning, clinical review of 71 DRAFT rules, regulatory review of claims inventory, CPCB key.
phase17 mobile: tsc clean, 73 suites/423 tests pass
