# iOS Staging Build — Exact Procedure (Phase 21)

Android build succeeded via `eas build --profile staging` (see `activity-safety-phase21-mobile-validation.md`). iOS needs **interactive** credential setup — a human must run it because EAS prompts for an internal-distribution provisioning choice that `--non-interactive` refuses.

## Prerequisites

- `eas whoami` → `sobbani16` ✓ (already authenticated)
- Apple Developer account `8FQ5RQS3P8` (verified Phase 22 via `eas device:list --apple-team-id`)
- **Zero devices registered on the team** (Phase 22: `eas device:list` returned none) —
  at least one test-device UDID must be registered before an internal-distribution
  build can install. Register via `eas device:create` or the Apple portal.
- No production change needed — `staging` profile already exists in `eas.json`

## Phase 22 re-verified blocker

`eas build --profile staging --platform ios --non-interactive` still fails with
*"EAS CLI couldn't find any credentials suitable for internal distribution."* —
the interactive credential-setup requirement is unchanged and remains a human action.

## Commands

```bash
cd /Users/sobbani/dev/fitness-app-mobile
eas build --profile staging --platform ios          # interactive: pick "Set up new credentials" → internal distribution
# or, for simulator-only validation (no device/signing):
eas build --profile staging --platform ios --local  # if local Xcode build configured
```

Then install the `.ipa` on a registered test device via TestFlight-internal channel OR the `.app` on a simulator via `xcrun simctl install`.

## Why a human must run it

`--non-interactive` fails with: *"EAS CLI couldn't find any credentials suitable for internal distribution."* The choice (new ad-hoc provisioning vs reuse testflight-internal profile) needs an owner decision — reusing the testflight-internal provisioning may be the right answer but it changes real Apple Developer state.

## Evidence to capture after install

Same 15-flow checklist as Android (`docs/audits/activity-safety-phase21-mobile-validation.md`), plus `CFBundleIdentifier` + installed-URL proof the build carries `EXPO_PUBLIC_API_URL=<staging>`.
