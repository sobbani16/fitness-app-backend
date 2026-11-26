# Phase 6 — Controlled Pilot Readiness

Date: 2026-11-22. Commits: backend `13e2452` (flag outage-path fix), Phase 5 `e98f430`/`76e97b5`; mobile `d7e0509` (Android flow), dev APK built from mobile `9d83177`.

## Verdict: **CONDITIONAL GO — bounded internal pilot. NO-GO for general availability.**

Every blocker that could be closed in-repo is closed. What remains is
environmental (physical devices, PostHog credentials) or owner/clinical
decisions — none of which block an internal allowlist pilot.

---

## 1. Flag security matrix — VERIFIED

Resolution order: `ai_shutdown → environments → dependsOn → FF_<KEY>_USERS
allowlist → env override → provider → default`.

**Defect found & fixed** (`13e2452`): the provider-outage branch previously ran
hand-rolled precedence that (a) checked env override *before* environment
restrictions — `FF_*=true` + PostHog down + `NODE_ENV=production` would have
resolved restricted flags **true**; (b) skipped `dependsOn` entirely — a
dependent flag could resolve with its parent off; (c) silently dropped
`FF_AI_EMERGENCY_SHUTDOWN` overrides. Outage now resolves through the identical
`resolveKey` chain with an empty provider contribution. Regression test:
`tests/featureFlags.test.js` "outage does not weaken env guards, deps,
allowlists, or shutdown" — 11/11 pass.

Bypass surfaces checked:
- **Env var**: cannot outrank env guards/deps/allowlist in either path.
- **Provider outage**: identical precedence; allowlist still narrows.
- **Cache**: keyed by server-verified `req.userId` — no cross-user path; ≤60 s stale is the documented propagation bound.
- **Stale session**: token auth resolves userId fresh each request; flags evaluated per-user.
- **Client-side**: `/config/features` is server-evaluated output only; no client input reaches resolution.
- **Authorized vs unauthorized**: allowlist listed→true, unlisted→false, dependents cascade per-user (Phase 5 + new outage test).

## 2. Android evidence — PASS (executed)

Device: Pixel_8 emulator, dev APK `app-debug.apk` built this session (mobile `9d83177`), Metro dev bundle, backend `:4000` via adb reverse. Evidence: `~/.maestro/tests/2026-11-22_173002/`.

| Step | Result |
|---|---|
| Sign-in (fresh install) | ✅ |
| Dashboard fiber card + "Fiber today · 0 g confirmed · Target 30 g" | ✅ rendered |
| Leo grounded answer — *"No meals are logged yet today… Today's target is 31 g. 31 g to go."* | ✅ deterministic engine copy, honest unknown state |
| Fiber question → unintended food log | ✅ **0 FoodLog rows** server-side for `p6-android-verify@syn.local` |

Note: the emulator required two cold boots (guest offline / dead `pm` / SystemUI ANR — host contention, not app defects). The installed staging APK was signature-incompatible and removed first.

**Not executed on Android**: meal log→totals, sequencing card, weekly view, reminders config, voice mic path. The dashboard tile shows "Target 30 g" while Leo reports 31 g — see Findings.

## 3. Physical-device evidence — NOT EXECUTED

No physical devices attached. Physical-device package is reproducible:
`app-debug.apk` + `adb reverse tcp:8081 tcp:8081 && adb reverse tcp:4000 tcp:4000` + `maestro test maestro/fiber-p6-android.yaml` + test account `p6-android-verify@syn.local` (dev DB only). Camera/mic/SST/offline/accessibility items remain unevidenced on all platforms.

## 4. Recipe reconciliation

| Recipe | Was | Now | Decision |
|---|---|---|---|
| Lentil soup with bread | 12 g | **15.5 g** | RESOLVED. Internal evidence proves cooked basis: 150 g dry lentils alone (≈550 kcal/43 g P) exceeds the recipe's own 420 kcal/22 g P; cooked basis (USDA boiled lentils, 7.9 g/100 g) reproduces ≈424 kcal/21.5 g P. New catalog row `301b3985…` (usda, cooked, 7.9), line remapped, fiber = bread 3.6 + lentils 11.85. Rollback: `UPDATE "Recipe" SET "fiberG"=12 WHERE id='2bfd72dd-…'; UPDATE "RecipeIngredient" SET "ingredientId"='f8fddd01-…' WHERE id='5a3dd09e-…'; DELETE FROM "Ingredient" WHERE id='301b3985-…'` |
| Overnight oats | 8 g | **8 g (held)** | HELD — quantity, not basis, is the defect. Dry oats are legitimate (measured dry), but 120 g dry ≈ 598 kcal vs stated 370 kcal. At ≈60 g dry the recipe's own macros match almost exactly (fiber ≈ 9.8 g). Owner must confirm intended quantity before writing; both candidates documented. |

The other four recipes (applied Phase 5): granola 5.6, eggs+toast 7, salmon+quinoa 2.8, avocado toast 11.7 — unchanged, rollback SQL in Phase-5 audit. No production data touched anywhere.

## 5. 77.7 g investigation — NOT A DEFECT

User `b8ded510` (fl-device-verify), 2026-11-21/22, 25 logs = 77.7 g. Traced: identical "Whole wheat bread 64 g" entries logged 13× (six within 10 min at 04:58–05:07 — Stage 1–4 test submissions), oat cereal ×2, plus unknown-fiber items (correctly excluded). Per-log values are correct (64 g whole-wheat ≈ 4.5 g @ 7 g/100 g). The sum is honest arithmetic on duplicate test logs — no unit/conversion/recipe defect. Legitimate-high vs defect: **defect-class = test data**, not engine. No user records modified.

## 6. Pilot infrastructure

Ready:
- Per-account targeting: `FF_<KEY>_USERS` env allowlist (verified incl. outage path); PostHog targeting exists code-complete pending `POSTHOG_API_KEY`.
- Server-side gates: env restriction + deps + kill switch all enforced and regression-tested.
- Rollback: remove env vars + restart (env provider reloads on boot); `AI_EMERGENCY_SHUTDOWN` for the AI surface; recipe inverse SQL recorded.
- Pilot account pool: `fl-device-verify@syn.local`, `p6-android-verify@syn.local`, `stage1-p…` users.

Recommended acceptance thresholds (ops to wire): grounded-answer rate ≥ 99% (no LLM fallback on fiber topics), fiber p95 < 100 ms at cohort size, 0 unintended writes on ASK_FIBER, reminder dedupe rate 0, flag propagation ≤ 60 s. Monitoring dashboards are an ops concern — no in-repo dashboard infra exists; thresholds documented for implementation.

## 7. Clinical/supplement separation

`fiber_supplement_suggestions_enabled` remains OFF; supplement routes unreachable; AI/voice psyllium answers stay educational with no dose. Per instruction §7 this is **not** a launch blocker for food-based fiber tracking, which is verified independently.

## 8. Findings register

| Sev | Finding | Status |
|---|---|---|
| MED | Flag outage path bypassed env guards + deps + shutdown override | **FIXED** `13e2452` |
| LOW | Dashboard macro tile (stored default 30 g) vs fiber engine (31 g) disagree | OPEN — align `macroGoal.fiberTarget` seeding with engine formula |
| LOW | `/fiber/trend` per-day queries | OPEN (bounded) |
| INFO | Maestro regex alternation in `text:` unreliable on Android — use exact strings | documented in flow |

## Remaining blockers (non-code)

1. Physical devices — none attached (repro package ready).
2. `POSTHOG_API_KEY` — approved-provider targeting activation (ops).
3. Overnight-oats quantity — owner decision (candidates documented).
4. Voice mic path — verified over HTTP only on all platforms.

## GO / NO-GO

- **Internal allowlist pilot (dev/test env + `FF_*_USERS` cohort)**: **GO** — flag security hardened with outage parity, Android journey executed with evidence, recipes resolved or documented-held, no-write invariant proven.
- **General availability**: **NO-GO** — pending physical-device pass, PostHog targeting live, and owner sign-off on overnight oats + the 30/31 g display alignment.
