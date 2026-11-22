# Phase 17 Final Report — Staging, Clinical Infra & Live Validation

- **Repo**: `fitness-app-backend` @ `feat/activity-safety-engine`, continuation of P16 `d3cabc7`
- **Scope delta**: clearance precedence model, exercise unmapped→review, notification staleness (J12/J15), reviewer infrastructure, privacy-preserving monitoring, DB-pool root cause, claims inventory, live dev-DB write-path proof.

## Deliverables

| Doc/artifact | Status |
|---|---|
| `activity-clearance-precedence.md` + `resolveClearance` + 12 tests | ✅ |
| `activity-notification-safety.md` + `Recommendation.staleAt` + `recommendationSafety.js` | ✅ |
| `reviewer-approval-package.md` | ✅ — tiers, version-pinning, SoD, export map, blank decision schema |
| `staging-e2e-validation.md` | ✅ — exact human steps; live write-path results |
| `activity-safety-claims-inventory.md` | ✅ — US/India flags |
| `observe.js` safety monitoring | ✅ — code/count-only + alert contract |
| `staging-preflight.js` | ✅ passes locally |

## PASS / FAIL / BLOCKED matrix

| Area | Verdict |
|---|---|
| Engineering implementation | **PASS** — full suite 5490/5546; sole fail = pre-existing `voice` order-dependent real-DB flake |
| Clearance precedence | **PASS** — explicit model: activity-specific > general; effective/expiry dates; restriction never overridden by clearance; urgent unaffected |
| Exercise metadata coverage | **PASS** — 884: 742 full / 134 partial / 8 review-required; unmapped now surfaces as `unevaluated` conflict, never silently safe |
| J12 cached-rec invalidation | **PASS** — stale-stamp on every safety-record write; live-verified on dev DB |
| J15 delayed notification | **PASS** — send-time re-eval + suppression verified (live + unit) |
| Live DB write-paths | **PASS** — 8 paths, real schema, synthetic-only, cleaned |
| Monitoring | **PASS** — events + alerts defined; zero PHI in telemetry |
| DB connection flake | **PASS** — root cause fixed; residual nondeterminism documented |
| Weather/AQI coverage | **PASS** — P16 evidence stands (NWS + IMD-CAP live-verified, WIS2, NDMA polygons, honest CPCB seam) |
| Privacy/security | **PASS** — P-1..P-5 remediated; trainer consent-gated detail re-verified |
| Clinical review readiness | **PASS** — package exportable; SoD enforced; no self-approval path |
| Clinical approvals | **BLOCKED — human** — 0/71 DRAFT rules approved; requires qualified external reviewers |
| Staging deployment | **BLOCKED — access** — preflight ready; zero creds; exact steps documented |
| Regulatory review | **BLOCKED — counsel** — claims inventory flags restriction-enforcement + urgent-symptom copy |
| Production readiness | **NOT READY** — gated on the three BLOCKED rows |

## Engineering vs clinical — unchanged boundary

Everything above proves *implementation* behavior. Zero rules are clinically approved; the suite green ≠ medical safety. The system correctly refuses to infer approval: rules stay DRAFT, `UNSUPPORTED_INPUT` rules stay inactive, unmapped exercises surface as review-required, missing data → `INSUFFICIENT_DATA`.

## Outstanding risks

1. `voice.test.js` UNDO flake — order-dependent real-DB state; reproduced under full-suite only; needs dedicated isolation pass (candidate: per-suite unique user IDs instead of shared `device` user).
2. `Barbell Deadlift`/`Cable Deadlifts` demand inconsistency + missing `overhead`/`balance`/`position` metadata — specialist review item E-1..E-6.
3. Trainer CDS §520(o) exposure — `summary` detail level hides clinical categories; counsel should confirm the independent-basis criterion.
4. Long-lived dev processes on this machine still hold ~27 pooled connections — kill or cap them in dev too if flakes recur.
