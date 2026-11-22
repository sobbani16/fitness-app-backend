# Phase 18 Release-Candidate Validation — Activity Safety Engine

**Repo**: `fitness-app-backend` @ `feat/activity-safety-engine` · **Mobile**: `fitness-app-mobile` latest
**Nature**: engineering release-candidate only. Clinical approval, staging deployment and regulatory review remain external human gates.

## Baseline verified (Step 1)

- 71 rules DRAFT, 0 approved — CHECK constraint enforced; no self-approval path.
- Clearance precedence explicit (`resolveClearance`): specific>general, dates, provenance, restriction>clearance, urgent unaffected. 12 regression tests.
- Exercises: 742 fully mapped / 134 partial / 8 review-required.
- `Recommendation.staleAt` invalidation + send-time suppression + `freshSafetyRecommendations` read guard.
- Live write-path evidence: 8 paths on real dev schema, synthetic user, cleaned.

## Step 2 — regression failures eliminated

| Item | Root cause | Fix | Evidence |
|---|---|---|---|
| `voice` UNDO flake | shared dev DB cross-suite state (confirmed by user's H1 isolation work) | `fitness_test` via `TEST_DATABASE_URL` + `connection_limit=5` under `NODE_ENV=test` | **2 consecutive full runs: 134/134 suites, 5492 + 5497 tests, 0 failures** |
| 13 mobile lint errors | `react/no-unescaped-entities` + one `no-children-prop` in Sprint-B screens | minimal typographic-apostrophe/entity fixes + nested children; no behavior/theme changes | `npx eslint src`: **0 errors** (60 pre-existing warnings) |

## Step 3 — exercise metadata risk closed

- Unmapped (8) already `status:'review'`.
- **NEW**: partial exercises (null `mechanic`/`equipment`) emit `review` — their `clear` was unqualified because weight-bearing/Valsalva derivation silently skipped. Qualified-clear test added both directions.
- `exerciseDbService` (browse/alternatives) is not safety-gated; `planSafetyConflicts` is the only restriction-evaluating consumer and now surfaces `unevaluated`/`review`/`conflict` honestly.
- Specialist-review taxonomy items recorded: `overhead`, `balance`, `position` demands not derivable from muscle metadata; `Barbell Deadlift` vs `Cable Deadlifts` inconsistency (E-1..E-6).

## Step 4 — notification & cache safety

| Step | Status | Mechanism |
|---|---|---|
| rec create → injury → invalidated | ✅ live-proven | `invalidateSafetyAdvice` on every safety-record write; `staleAt` stamped |
| API retrieval of stale | ✅ guarded | `freshSafetyRecommendations` — sole sanctioned read path, `staleAt:null` filter |
| mobile cache refresh | ✅ | `invalidateSafetyRecommendations` (mobile `safetyInvalidation`) called on report flows |
| push queued → injury before delivery → suppressed | ✅ | send-time `activityAdviceAllowed` re-evaluates gate; suppression deletes unread advice rows |
| retry/duplicate | ✅ | suppression is a `deleteMany` on unread rows — idempotent across retries |
| expired/changed restrictions | ✅ | gate derives from live rows each evaluation; no cached verdicts |
| auth boundary | ✅ | invalidation + suppression strictly `userId`-scoped; cross-user test exists |
| race conditions | ✅ bounded | send-time check runs inside the same request that persists the notification; worst case is one extra suppressed row, never an unsafe send |

## Step 5 — staging

**NOT DEPLOYED — no authorized credentials exist on this machine.** Preflight passes; ordered human steps in `docs/audits/staging-e2e-validation.md`. No deployment claimed.

## Step 6-7 — handoffs

- `docs/clinical/activity-safety-clinical-handoff.md` — per-rule package map, tier routing (29 physician-tier), SoD enforcement, version pinning, highest-risk review queue.
- `docs/audits/activity-safety-claims-inventory.md` — US + India inventory finalized with suppression recommendations pending counsel.

## Step 8 — release-candidate matrix

| Check | Verdict | Evidence |
|---|---|---|
| Producer safety gates | **PASS** | engine+gate suites; producers can't bypass (advice types enumerated + send-time check) |
| Medical restriction precedence | **PASS** | `resolveClearance` + NWB-under-blocking fix verified live |
| Exercise demand metadata | **PASS** | 742 full / 134 partial→review / 8 unmapped→review; no silent safe |
| Trainer privacy | **PASS** | consent-gated detail; summary strips categories; regression test green |
| AI recommendation validation | **PASS** | producers route through gate; LLM can't override deterministic verdicts |
| Wearable precedence | **PASS** | recovery overlays never override restrictions (verified P16/17) |
| Weather/alert coverage | **PASS** | NWS + IMD-CAP live-verified; independent availability/freshness |
| Stale recommendation handling | **PASS** | write + send-time + read guard |
| Notification delivery safety | **PASS** | J15 send-time suppression; idempotent |
| DRAFT enforcement | **PASS** | CHECK constraint; 0 approved; no code path self-approves |
| Feature-flag fail-closed | **PASS** | gate disabled → honest `available:false`; medical flags not auto-enabled |
| User data isolation | **PASS** | all safety reads/writes `userId`-scoped; cross-user tests |
| Backend regression | **PASS** | 2× green runs, 0 flakes |
| Mobile regression | **PASS** | tsc clean, 74/74 suites 426 tests, eslint 0 errors |
| Clinical approvals | **BLOCKED** | human reviewers required — package ready |
| Staging deployment | **BLOCKED** | no credentials — exact steps documented |
| Regulatory classification | **BLOCKED** | counsel — suppression list prepared |
| Production release | **NOT READY** | gated on the three BLOCKED rows |

## Residual risks

1. `Recommendation` rows have no API consumer today — `freshSafetyRecommendations` exists so any future reader can't reintroduce staleness.
2. 87 mechanic-null + 77 equipment-null exercises now produce review verdicts — correct but noisy for trainers; the clinical/taxonomy review should decide whether to backfill metadata.
3. Staging and clinical review are the only paths to production; both are human-gated, documented and unclaimed.
