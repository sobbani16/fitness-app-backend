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
