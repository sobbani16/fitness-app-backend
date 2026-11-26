# Phase 5 — resumable progress

Baselines: backend `e98f430` (this phase), mobile `6dbf596`.

## Done
- P5-1 audit — 2 defects fixed (clinician provenance spoof; dry-basis reconcile), findings in PHASE5_RELEASE_AUDIT.md §1
- P5-2 device — iOS sim journeys evidenced (Stage 1–4 artifacts); HTTP voice verified
- P5-3 targeting — `FF_<KEY>_USERS` allowlist implemented + verified incl. outage path
- P5-4 reconcile — 4 recipes applied on dev, 2 held; rollback SQL printed; prod plan documented
- P5-5 safety — injection/cross-user/supplement/target probes all verified live
- P5-6 perf — p50/p95/p99 matrix in audit doc §6
- P5-7 report — PHASE5_RELEASE_AUDIT.md written

## Pending
- Commit this doc + audit doc
- Android dev APK build + journey rerun (blocked on build)
- Physical-device pass when hardware available

## Blockers
- PostHog key not configured (ops decision)
- Lentil/oats catalog rows need cooked-basis entries (owner review)
- Android dev build + host ADB stability
- Physical devices none attached

## Next actions
- Catalog owner: add "Brown lentils, cooked" + confirm overnight-oats dry basis
- Ops: POSTHOG_API_KEY for approved-provider targeting
- Then internal-cohort rollout via allowlist or PostHog

## Phase 6 checkpoint (committed b22a912)
- P6-1 flag security — outage-path bypass FIXED (13e2452), regression test added
- P6-2 Android — PASS on dev APK (Pixel_8 emu, ~/.maestro/tests/2026-11-22_173002); partial journey: sign-in, dashboard fiber, Leo grounded answer, 0 unintended logs
- P6-3 physical — none attached; repro package documented
- P6-4 recipes — lentil soup resolved 12→15.5 (cooked basis); overnight oats held (quantity, not basis)
- P6-5 77.7 g — duplicate test logs, no engine defect
- P6-6 pilot infra — allowlist + rollback verified; thresholds documented
- Open: physical devices, PostHog key, oats quantity decision, 30-vs-31 tile alignment
