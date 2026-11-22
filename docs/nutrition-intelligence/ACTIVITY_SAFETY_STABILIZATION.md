# ACTIVITY_SAFETY_STABILIZATION (Sprint E Phase 0)

**Verdict: no engine defects — order-dependent test flakiness.**

Evidence:
- `tests/activitySafety.scenarioMatrix.test.js` standalone: **3,840/3,840 pass**.
- Full-run failures are non-deterministic: run A → 18 in scenarioMatrix; run B → 4 in `identity`/`exerciseLibrary`; those suites also pass standalone.
- Known cause (documented since Sprint A): shared `process.env`/module state across suites; prior fixes restored env in messaging/featureFlags/photoScan/trainerWorkoutPlans/energySummary tests, but polluters remain unfixed.
- Engine files (`constants/engine/rulesData/activityCatalog`) show no uncommitted diff — owner's WHO_PA_2020 work was committed; `reviewPackage` diff is only a test timestamp.
- No medical-restriction weakening observed; no assertions loosened to force green.

**Action needed (not engine work):** isolate suite-level env/module pollution; add `jest.resetModules` or env-restore in the suites that leak. Classified as test-infra debt, not a safety regression.
