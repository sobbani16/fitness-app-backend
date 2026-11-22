# Phase 24 — Progress

## State entering the phase
- Backend `feat/activity-safety-engine` @ `9259ea4` (deployed on staging).
- Mobile `feat/muscle-explorer-v2` @ `6f2868e` (dead-token sign-out fix).
- Staging APK `fcc9a14b` installed on Pixel 8 AVD (Phase 23).

## Task 1 — Preserve current work
User's uncommitted test-infra changes identified and left untouched:
`tests/setup.js`, `tests/setupAfterEnv.js` (flag-cache `resetCache()` in
afterEach — the user's own flake fix, registered via `setupFilesAfterEach`),
`jest.config.js` in backend. Untracked `nutritionReview.js` /
`symptomContext.js` referenced only by uncommitted code — left alone.
No overwrite/discard/commit of foreign work.

## Task 2 — Injury management UI — DONE
- Backend `ef57443`: `GET /activity-safety/injuries` (full rows + provenance +
  lock metadata). 33/33 route tests.
- Mobile `8c1d819`: `InjuriesScreen` (active/resolved sections, inline edit of
  user-editable fields, clinician-locked fields read-only + explainer, 400/409
  surfaced, invalidation on success only), `listInjuries`/`updateInjury` API
  expansion, navigator registration + SafetyReport entry point.
  5/5 screen tests; mobile suite 83/83 (526); tsc + eslint clean.

## Task 5 — Regression baseline — RESOLVED (root cause, no code change)
- Phase 23's "2 failing suites" were an **invocation artifact**: `npx jest`
  runs parallel workers sharing TEST_DB → cross-suite fixture races
  (`photoScan` `deleteMany 'Ps *'` mid-`mealSuggest` determinism check).
- Supported invocation `npm test` (`jest --runInBand`): **two consecutive
  green passes — 151/151 suites, 5,862 tests each**. Baseline was never broken.

## Deployment
- `ef57443` pushed → Railway auto-deploy → commitHash-verified `ef57443`,
  health 200. `GET /activity-safety/injuries` live-verified (returns Phase 23
  seeded clinician injury with `clinicianDocumented` + `lockedFields`).

## Gates (Task 8)
- 71/71 `ActivitySafetyRule` rows `reviewStatus=DRAFT` (staging DB query).
- P1×16 assignments remain pending (no reviewer records — correct).
- Claims handoff unchanged; production untouched.

## iOS (Task 7)
- `eas device:list` on team `8FQ5RQS3P8`: **zero registered devices** —
  unchanged blocker. Human must register a UDID and run
  `eas build --profile staging --platform ios` interactively.

## In flight
- EAS Android staging build `4968dd88` (from `b9c2852`) — carries the
  ListRow-layout fix below; re-verifies edit flows on device.
- Device validation matrix in
  `docs/audits/activity-safety-phase24-device-validation.md`.

## Device findings so far (Task 6, partial)
- APK `127b68cd` (from `8c1d819`): staging-URL-only verified, installed,
  injuries list renders correctly with provenance (PASS).
- **Bug found on device**: edit form nested in `ListRow` children renders in
  the right-edge icon container → Active section appeared empty. Fixed in
  mobile `b9c2852` (edit `Card` replaces the row while editing); unit suites
  re-green (the class of bug only a device pass catches).
- Dead-token (AuthSession deleted server-side → auto-purge → login screen):
  PASS on `fcc9a14b` — same `signOut()` code path ships in the new build.
- Account switching (NWB → shoulder): each account renders its own state —
  no cross-account bleed. PASS.
- Emulator repeatedly ANR/OOM-cycled under the user's concurrent iOS
  `xcodebuild` load; recovered after watchdog reboot + reinstall.
