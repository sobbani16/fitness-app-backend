# Phase 22 — Progress

Scope: finish remaining device validation, safety UX/API hardening, clinical +
regulatory review preparation, controlled-beta readiness. No merge, no release,
no production changes.

## Status by task

| Task | Status | Evidence |
|---|---|---|
| 1 — Finish 15 Android flows | PARTIAL / BLOCKED | `docs/audits/activity-safety-phase22-device-validation.md` — flows 1–6 carry Phase 21 on-device PASS; 9/10/11 flag-flip verified on-device (gated surfaces appeared); remainder NOT TESTED after emulator NAT corruption (root-caused: PIA kill-switch + concurrent user automation + residual slirp degradation). Sign-out dead-token edge case found and documented |
| 2 — Exercise suitability | PASS | `docs/audits/activity-safety-phase22-exercise-suitability.md` — `upper_body_ergometer` profile verified (not a label); 6 regression cases added; `trunk_load` category boundary documented; 46/46 scenarios green. Commit `1f29e6d` |
| 3 — Onboarding persistence | PASS | SecureStore-backed, account-keyed draft in `src/storage/onboardingDraft.ts`; restore-on-relaunch, clear-on-confirmed-submit; 5/5 tests; lint/tsc clean. Mobile commit `e27aab0` |
| 4 — Injury PATCH API | PASS | Unknown field → 400; invalid value → 400; clinician-documented restriction self-edit → 409; resolution stamps `resolvedAt`; 31/31 route tests. Commit `2a8021d` |
| 5 — iOS staging build | BLOCKED | `docs/audits/ios-staging-build-procedure.md` re-verified: `--non-interactive` fails "no credentials suitable for internal distribution"; **zero devices registered** on team `8FQ5RQS3P8` — a device UDID + interactive credential setup are required human actions |
| 6 — Clinical review prep | PASS | `docs/clinical/activity-safety-review-assignment.md` — all 71 rules, tiered (P1 16 / P2 30 / P3 25), stable content hashes, reviewer-qualification matrix, explicit "tests ≠ clinical correctness" banner |
| 7 — Regulatory prep | PASS | `docs/regulatory/activity-safety-claims-handoff.md` — intended use, audiences, claims, architecture, governance, regions (US+India), limitations, screenshots references; no self-certification |
| 8 — Controlled beta | PASS | `docs/audits/activity-safety-phase22-beta-readiness.md` — 5-audience matrix; flag enforcement verified server-side; legacy-path check documented (disabling engine cannot reactivate an unsafe path); practical checklist |
| 9 — Regression | PASS | Backend 150/150 suites (5,849 tests); safety suites 14/14 (4,160); mobile 81/81 (503); tsc clean; eslint clean on touched files; staging smoke health=200/unauth=401 |

## Commits this phase

Backend (`feat/activity-safety-engine`):
- `2a8021d` — injury PATCH hardening + tests
- `1f29e6d` — exercise-suitability regression matrix

Mobile:
- `e27aab0` — onboarding draft persistence

## Not done / handed to humans

- Flows 7–8, 12–15 on-device: NOT TESTED (environment fault, exact rerun steps in
  the device-validation doc).
- iOS: BLOCKED — interactive credentials + device UDID registration.
- Clinical review: package + assignment matrix ready; qualified reviewers required.
- Regulatory counsel: handoff ready; no certification claimed.
- Sign-out dead-token edge case: documented, fix deferred (product decision).
- Merge/release: not authorized.
