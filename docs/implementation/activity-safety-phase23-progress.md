# Phase 23 — Progress

Mission: staging sync, device-validation closure, release-gate verification.
No merges, no production changes, no clinical activation.

## Status by task

| # | Task | Status | Evidence |
|---|---|---|---|
| 1 | Staging sync | **PASS** | Deployed `4650908` (verified commitHash). First attempt crashed on untracked `ingredientImpact.js` — committed, redeployed. Health/auth/isolation/rules-DRAFT/flags all verified. Live PATCH matrix: 7/7 cases PASS incl. 409 clinician-lock + `injury_updated` invalidation — `docs/audits/activity-safety-phase23-staging-validation.md` |
| 2 | Dead-token sign-out | **PASS** | `signOut()` in `accountLifecycle.ts` — best-effort server revocation, unconditional local clear, concurrent-login guard. Wired into SummaryScreen + AuthGate verify-email path. 11/11 unit tests. Mobile commit `6f2868e` |
| 3 | Android flows 7–15 | **BLOCKED** | No physical device; sole AVD's NAT degraded across 4 cold boots (PIA ruled out this phase). Flow 7 additionally BLOCKED by missing injury-edit UI (product gap). Live server-side evidence: invalidation + PATCH matrix. `docs/audits/activity-safety-phase23-device-closure.md` |
| 4 | Release compat + new APK | **PASS** | Old APK contract-compatible (mobile sends only editable PATCH fields). New staging build `fcc9a14b` finished — bundle verified to embed staging URL only; installed + launched on-device (login blocked by dead NAT) |
| 5 | iOS staging prep | **BLOCKED** | `eas device:list` — zero registered devices on team `8FQ5RQS3P8`; `--non-interactive` build fails on credentials. Exact steps in `ios-staging-build-procedure.md` |
| 6 | Clinical/regulatory gates | **PASS** | 71/71 DRAFT on staging DB (re-queried); assignment matrix real — all UNASSIGNED, P1 16 first, hashes pinned; claims handoff current; no prod rollout |
| 7 | Final regression | **PASS w/ noted pollution** | Safety 14/14 (4,163); mobile 82/82 (521) + tsc/eslint clean. Full backend 148/150 — 2 failures are uncommitted `tests/setup.js` pool-limit WIP (pass isolated 124/124), documented in staging-validation doc |
| 8 | Documentation | **DONE** | This file + 3 audit docs; commits `4650908` (backend), `6f2868e` (mobile) |

## Commits

- Backend: `4650908` fix(fiber): commit ingredientImpact (deploy fix)
- Mobile: `6f2868e` fix(auth): dead-token sign-out

## Human-owned actions remaining

1. Physical Android device → install `fcc9a14b` → flows 12–15 (+13 sign-out
   verification) per device-closure doc.
2. iOS: register a device UDID → interactive `eas build --profile staging --platform ios`.
3. Injury-edit UI: product decision — API ready, no surface exists (flow 7).
4. Clinical reviewers for P1×16 then P2/P3; regulatory counsel for claims handoff.
5. Merge/production decision — still gated on all of the above.
