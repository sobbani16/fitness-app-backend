# Stage 1 Internal Rollout — Execution Report

Date: 2026-11-23 · Owner: internal rollout · Decision required: PASS/FAIL per §8

## 1. What was enabled

| Flag | Value | Mechanism |
|---|---|---|
| `fiber_intelligence_enabled` | ON | `FF_FIBER_INTELLIGENCE_ENABLED=true` in dev `.env` |
| `fiber_daily_goal_enabled` | ON | `FF_FIBER_DAILY_GOAL_ENABLED=true` in dev `.env` |
| `fiber_meal_sequencing_enabled` | OFF | — |
| `fiber_reminders_enabled` | OFF | — |
| `fiber_supplement_suggestions_enabled` | OFF | stays OFF pending clinical review |
| `fiber_ai_enabled` | OFF | — |
| `fiber_voice_enabled` | OFF | — |

`.env` is gitignored — flag state is runtime config, not source. The
registry change gating both flags to `environments: ['development','test']`
IS committed: it makes the flags **structurally incapable of resolving
true in production**, regardless of any env override or future PostHog
targeting. Verified live:

- `NODE_ENV=production` + `FF_*=true` → `fiber_intelligence_enabled=false`
- `NODE_ENV=development` + `FF_*=true` → both `true`
- `FF_FIBER_INTELLIGENCE_ENABLED=false` → goal flag auto-false via
  `dependsOn` (fail-closed cascade)

## 2. Preflight verification — actual results

| Check | Result |
|---|---|
| Deployment versions | backend `de93c9d`, mobile `1c09f73` (local dev; no hosted deploy touched) |
| Migration status | `prisma migrate status`: 68 migrations applied, "up to date" |
| Other fiber flags OFF | verified via `evaluateAll` + `/config/features` — all five remaining fiber flags false |
| `fiber_supplement_suggestions_enabled` | OFF — `POST /fiber/supplement-*` and `GET /fiber/supplement-education` return `FEATURE_DISABLED` (403) |
| Rollback controls | `FF_*=false` works instantly after restart; parent-off cascades to dependents; `AI_EMERGENCY_SHUTDOWN` covers AI-group flags |
| **PostHog cohort targeting** | **NOT CONFIGURED — deviation.** Provider is `env`; per-account targeting does not exist on this instance. Mitigating fact: the dev DB contains 2,481 users — 100% synthetic test domains (`test.dev`, `syn.local`, `device.local`, `humai-seed.example`, `t.dev`, `test.com`, `example.com`) plus the owner's own account. Zero public users reachable on `localhost:4000`. Env-global enablement on this instance is therefore cohort-equivalent. **Per-account PostHog targeting is a hard prerequisite for any shared/staging/prod deployment.** |
| Unrelated uncommitted work | preserved — only `featureRegistry.js` + `docs/fiber-intelligence/*` committed |

## 3. Live endpoint verification (ephemeral instance :4100)

| Endpoint | Result |
|---|---|
| `GET /fiber/target` | 200 — `targetG:30, basis:default` for unpersonalized user |
| `GET /fiber/daily` | 200 — confirmed/estimated/unknown/planned/supplement split correct |
| `GET /fiber/weekly` | 200 — `verdict` states correct, `no_data`/`mostly_incomplete` honest |
| `POST /fiber/sequence` | **403 FEATURE_DISABLED** — sequencing correctly gated OFF |
| `GET /fiber/supplement-education` | **403 FEATURE_DISABLED** — supplement surface gated OFF |
| `GET /config/features` | only `fiberIntelligenceEnabled` + `fiberDailyGoalEnabled` true |
| `/admin/feature-flags` diagnostics | RBAC-gated (`MANAGE_FEATURE_FLAGS`) — flag state not publicly readable |

## 4. Real-device / simulated-device evidence

**Physical devices: none attached to this host** — iOS evidence is from
iPhone 17 Pro Max simulator (iOS 26.4, dev build + Metro), Android from
Pixel_8 emulator (API 36) — flagged as a deviation from "physical".

| Check | iOS sim | Android emu |
|---|---|---|
| Sign-in → dashboard | PASS | PASS (one full run) |
| "Fiber today" card renders | **PASS** — screenshot: `64.4 g confirmed`, progress bar | not reached (see issue I-1) |
| Macro-grid Fiber tile | PASS — shows "Incomplete data / Target 30 g" (unknown ≠ 0) | not reached |
| OFF-surface absence | PASS — no psyllium/supplement UI asserted invisible | not reached |
| Screenshots | `automation/reports/fiber-today-card.png`, `fiber-weekly-section.png` | — |
| Flow file | `maestro/fiber-stage1-verify.yaml` (reusable for both platforms) | same |

## 5. Performance — `GET /fiber/weekly` (production-like volume)

Fixture: `stage1-perf@syn.local`, 27 logs over 7 days (3–5/day, mixed
known/unknown fiber, `nutritionSnapshot.nutrientUnknowns` set honestly).

| Metric | Result |
|---|---|
| DB queries per request | **6, fixed** — user, macroGoal, conditions, allergies, foodPrefs, one bulk foodLog window query. No N+1 (verified via Prisma query-event instrumentation) |
| Query time (local dev DB) | 88 ms total across the 6 queries |
| HTTP latency (n=40) | p50 **14 ms**, p95 **76 ms**, max 108 ms |
| `/fiber/daily` (n=20) | p50 20 ms, p95 59 ms |
| Heap delta per call | ~0.3 MB |
| Error rate | 0/40 |
| Repeated nutrition calc | none — rollup is in-memory over the single fetch; `suggestFoods` is a static catalog (0 queries) |

## 6. Issues found

| ID | Sev | Issue | Status |
|---|---|---|---|
| I-1 | P2 | **Stale flag cache suppresses the card on Android**: the emulator's cached `featureConfig` predated flag enablement; `DashboardScreen`'s effect intentionally omits `isEnabled` (documented warning), so the fiber fetch was skipped until next focus. The 60 s flag poll refreshed the cache, but without a focus change the card stays hidden for that session. Expected bound: next app focus/navigation. | documented — acceptable for Stage 1 (bounded, self-healing on refocus); consider a flag-change-triggered refetch before Stage 2 |
| I-2 | P2 | **Android emulator unstable on this host** — ADB sockets drop, SystemUI ANRs (host ~16 GB RAM starved by sim+metro+2 backends). One complete run succeeded; two further runs died at the ADB layer, not the app. | environment limitation — FAILURE_REGISTER already tracks it; not a fiber defect |
| I-3 | P3 | No physical devices available — evidence is simulator/emulator. | environment limitation |

## 7. Monitoring state (env provider)

- Request logging: per-request `GET /path status ms` lines on the dev server — error rate and latency observable directly.
- `flags.diagnostics()`: provider=`env`, cache size, TTL, `envAiShutdown` — exposed via RBAC-gated `/admin/feature-flags`.
- No PostHog events / no APM / no crash reporting wired — mobile crashes would only surface in Metro/logcat during internal testing.
- Flag-exposure check: `GET /config/features` per user is the ground truth; the `environments` guard means exposure outside dev/test is impossible even under misconfiguration.

## 8. Rollback verification

- `FF_FIBER_*=false` + process restart → flags false, dependents cascade off. (env-provider rollback = restart-bound; PostHog rollback would be 60 s cache-bound — noted for staging.)
- Verified: off → `/fiber/*` returns `FEATURE_DISABLED` 403; mobile card disappears on next flag poll.
- Data written during Stage 1 is read-only evaluation + `FiberDailyRecommendation` persistence — nothing to undo.

## 9. Stage 1 verdict: **CONDITIONAL PASS**

Passed: flags live, correctly scoped (dev/test-only by code), endpoints
verified, perf clean, iOS device flow green, OFF-surfaces verified gated,
rollback proven. Deviations: PostHog targeting absent (mitigated — no
public users on this instance), Android visual assert blocked by emulator
instability (API-level verified instead), no physical devices.

**Recommendation**: proceed to Android verification when a stable
emulator/device is available; do NOT deploy to any shared environment
until PostHog per-account targeting is configured. Stage 2 remains
blocked pending explicit approval.

## 10. Test accounts used

`fl-device-verify@syn.local` (device flows), `stage1-perf@syn.local`
(seeded perf fixture — 27 logs, retained for monitoring), plus read-only
evaluation on the top-3 existing test users.
