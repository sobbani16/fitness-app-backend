# Android CI E2E — environment validation + readiness (2026-11-22)

## Workflow audit: `.github/workflows/android-e2e.yml` (on origin/main + feat/pose-coaching-impl)
| Check | Finding |
|---|---|
| Runner | `macos-14` (M-series, ~14 GB) — hw-accelerated AVD, not host-starved |
| AVD | API 34, google_apis, arm64-v8a, pixel_8, `-memory 3072`, animations off |
| Toolchain | node 20, temurin JDK 17, `npm i -g @maestro/mobile-cli` (**unpinned** — recommend pinning) |
| APK | local `./gradlew :app:assembleRelease` with `EXPO_PUBLIC_API_URL=staging` (self-contained), or EAS artifact |
| Backend | `https://activity-safety-staging-staging.up.railway.app` — NOT localhost |
| Auth | secrets `E2E_STAGING_EMAIL` / `E2E_STAGING_PASSWORD` (synthetic only) — **unverified whether set** (no `gh` here) |
| Flows | dispatch input; my flow passed as `flows=food-logging-verify-android` |
| Artifacts | junit XML + bugreport + maestro png/mp4, 30-day retention |

## Staging fixture (verified via live API, synthetic account)
Deterministic first result for `search?q=milk`: **"MILK" — 55 kcal/100 g**,
macros 3.39/5.08/2.12, fiber 0, serving **"1 cup" = 236 g**.
qty 2 → **472 g → ~260 kcal** (55×4.72=259.6, kcal rounds whole).
`food-logging-verify-android.yaml` asserts "Per 100 g: 55 kcal" to pin the row.

## Flow readiness gaps fixed in `75de24f` (feat/pose-coaching-impl, pushed)
- env-var sign-in block (`${MAESTRO_E2E_EMAIL}` / `${MAESTRO_E2E_PASSWORD}`)
  — CI app starts signed-out; local runs had owner sessions.
- stylus-handwriting onboarding defense (`runFlow when "Try out your stylus"
  → tap "Cancel"`) — observed locally swallowing `inputText` on Pixel API.
- staging fixture swap (dev "Whole wheat bread, ready" doesn't exist on staging).

## How to execute (owner — `gh` CLI required; not installed here)
```bash
gh workflow run android-e2e.yml --ref feat/pose-coaching-impl \
  -f build_source=local -f flows=food-logging-verify-android
gh run watch   # artifacts land as android-e2e-<run_id>
```
Prereq: set repo secrets `E2E_STAGING_EMAIL`/`E2E_STAGING_PASSWORD` to a
synthetic staging account (e.g. the p20-* family). Without them the sign-in
branch fails honestly.

## Status: READY-TO-DISPATCH (not yet executed — no gh binary on this host)
Local emulator path remains INFRA-BLOCKED (documented); do not retry locally.

## 2026-11-22 PM6 — workflow defect fixed + expected values pinned
- **Defect found & fixed (`6e52cd5`):** `npm i -g @maestro/mobile-cli || true`
  — the package does NOT exist on npm (E404); `|| true` masked it → CI would
  have run with no maestro binary. Now installs `cli-2.12.1` zip from the
  mobile-dev-inc/maestro GH release (version proven locally on both platforms).
- Exact expected values for the staging MILK fixture (2 cups = 472 g,
  canonical `macrosForPortion` rounding): **kcal 260 · protein 16.0 ·
  carbs 24.0 · fat 10.0 · fiber 0**. Asserts in the yaml pin identity via
  "Per 100 g: 55 kcal" + "= 472 g total"; screenshot captures the rest.
- Remaining owner-only gate: set `E2E_STAGING_EMAIL`/`E2E_STAGING_PASSWORD`
  repo secrets, then `gh workflow run android-e2e.yml --ref feat/pose-coaching-impl
  -f build_source=local -f flows=food-logging-verify-android`.
