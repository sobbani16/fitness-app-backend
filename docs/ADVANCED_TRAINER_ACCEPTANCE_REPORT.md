# Advanced Trainer — Acceptance Report

Date: 2026-10-31 · Scope: `ADVANCED_TRAINER_ARCHITECTURE.md` milestones M1–M7. Verified against code + executed suites.

## Test evidence (executed, real counts)

| Suite | Tests | Result |
|---|---|---|
| `tests/trainerWorkoutPlans.test.js` | 8 | ✅ pass |
| `tests/trainerNutrition.test.js` | 20 | ✅ pass |
| `tests/messaging.test.js` | 15 | ✅ pass |
| `tests/scheduling.test.js` | 25 | ✅ pass |
| `tests/trainerCommerce.test.js` | 19 | ✅ pass |
| **Module total** | **87** | all green (`npx jest <5 files> --runInBand`, 1.4s) |
| `tests/trainerPlatform.test.js` (base) | 27 | ✅ pass — combined trainer total **114** |

Repo-wide: 68 test files (`npx jest --listTests`). All counts above are from actual runs; nothing claimed for files that don't exist.

## Flag defaults — all-off confirmation

Verified in `src/config/featureRegistry.js`: every `trainer_*` entry has `default: false` and `failOpen: false`. The 5 module flags + 2 AI flags + advanced parent + 4 base surface flags + master — **12 feature flags plus the `trainer_dashboard` master (13 `trainer_*` keys total)** ship off by default. Tests explicitly verify: flag-off → 403 on both routers of each module, and parent-off cascades override child env-enables.

## Spec checklist per module

### M1 — Flags

| Spec | Status |
|---|---|
| Registry entries w/ `dependsOn` chain | ✅ all 8 advanced + AI keys (ADVANCED_TRAINER_FEATURE_FLAGS.md) |
| Parent control forces children off | ✅ evaluator behavior + tests |
| PostHog flag creation | ⏳ operational step (instructions written) |
| Mobile `featureKeys.ts` sync | ✅ all 13 clientKeys present |

### M2 — Workout plans

| Spec | Status |
|---|---|
| Draft→publish→assign→respond→complete lifecycle | ✅ |
| Days + rest/tempo/progression/warm-up/cool-down | ✅ `TrainerWorkoutDay`/`TrainerWorkoutExercise` |
| Versioning (revise→version+1→supersedes) | ✅ |
| Completion link `WorkoutSession.planAssignmentId` | ✅ never touches log semantics |
| Feedback | ✅ rating/note + optional session link |
| Consent gating on session lists | ✅ `workout_records` |
| Notifications on assign | ✅ inbox `Notification`; ➖ no push on assign |

### M3 — Nutrition guidance

| Spec | Status |
|---|---|
| Plan/meal/item/targets + assignment/feedback | ✅ |
| Ingredient/recipe nutrition reuse | ✅ `nutrition.scale`/`fromIngredient` |
| Versioning + archive | ✅ |
| Scope-of-practice disclaimer | ✅ `DISCLAIMER` on every payload |
| Allergy-conflict system | ✅ consent-gated canonical table; never drops items |
| Client log → own FoodLog `source:'trainer_plan'` | ✅ the only FoodLog write path |
| Trainer progress summary (consent-gated) | ✅ |

### M4 — Messaging

| Spec | Status |
|---|---|
| 1:1 conversation keyed to relation | ✅ `relationId @unique` |
| REST + polling (no WS) | ✅ **deferred by design** — WS transport not built |
| Cursor pagination + read state | ✅ id-cursor; ⚠ see ordering caveat below |
| Ended-relation read-only archive | ✅ sends 403, history readable |
| Rate limit | ✅ 30/min on sends (`MESSAGE_RATE_LIMIT`) |
| Expo push, generic body | ✅ `pushService` + `DevicePushToken` |
| Notification inbox rows | ✅ `trainer.message` |
| Retention (disable ≠ delete) | ✅ |
| `/report` abuse endpoint | ✅ audit metadata only |

### M5 — Scheduling

| Spec | Status |
|---|---|
| Weekly availability windows in trainer IANA tz | ✅ |
| Session types w/ buffer/min-notice/cancel-window | ✅ |
| Computed slots endpoint | ✅ `GET /me/available-slots` (≤93d) |
| Booking lifecycle + events | ✅ incl. `rescheduled` re-confirm |
| Double-book prevention | ✅ Serializable tx + overlap check → 409 `SLOT_TAKEN` |
| DST correctness | ✅ verified Oct-27-EDT→13:00Z / Nov-3-EST→14:00Z |
| Booking reminders (push worker) | ➖ deferred — not built |

### M6 — Payments

| Spec | Status |
|---|---|
| Schema: package/purchase/subscription/entitlement/transaction/refund/payout/promotion | ✅ all modeled |
| Provider abstraction + MockProvider | ✅ |
| Webhook HMAC + `providerEventId` idempotency | ✅ |
| "Never trusts client-reported success" | ✅ pending→paid only via verified webhook |
| Refunds | ✅ provider-confirm-first, atomic revoke |
| Live payments | ➖ **disabled by design** — flag stays off pending store/legal review |
| Payouts (US + India) | ➖ listing only; India rail gap documented |

### M7 — Validation sweep

| Spec | Status |
|---|---|
| Negative-test matrix | ✅ 17 threats → executed tests (ADVANCED_TRAINER_SECURITY_TESTS.md) |
| Contracts doc | ✅ |
| Acceptance report | ✅ this file |

## Deferrals & dormant surface

| Item | State |
|---|---|
| WebSocket transport | deferred (REST+polling documented rationale) |
| Live payments + Stripe Connect | deferred pending counsel; India payout rail unsolved |
| `TrainerWaitlist` activation | still unwired |
| `trainer_workout_plan_ai_enabled` / `trainer_nutrition_ai_enabled` | registered, **dormant** — zero endpoints consume them; in AI kill group |
| `GET /trainer/dashboard` | listed in registry endpoints, **route not built** |
| Mobile UI for all advanced modules | not built — backend/API only this milestone |
| Booking reminders worker | not built |
| Entitlement consumption (session decrement) | not built — entitlements grant/revoke only |
| `Message.deletedAt` | schema-only, no delete endpoint |

## Discrepancies found while documenting

| # | Issue | Location |
|---|---|---|
| D1 | `GET /trainer/dashboard` referenced in `featureRegistry.js` endpoints but **no route exists** | registry line ~246 vs `src/routes/` |
| D2 | `Message` pagination orders by `id` (uuid) — lexicographic, **not chronological** in production; tests pass only because mock ids are sequential | `messagingService.js:108` |
| D3 | `POST /me/push-tokens` has **no feature flag** — token registration works while `trainer_messaging_enabled` is off | `pushTokens.js` |
| D4 | `POST /me/purchases/checkout` requires **no active relation** — any authenticated user can check out any active package | `trainerCommerceService.js:141` |
| D5 | Webhook route is intentionally **not flag-gated** — `paid`/`refunded` can transition while commerce flag is off (documented as design; ops should know) | `app.js:16` |
| D6 | `trainer_coaching` registry description lists `GET /trainer/dashboard` under `trainer_insights` — same D1 | — |
| D7 | Seed file writes specialty ids like `powerlifting`, `HIIT`, `pre_natal`, `triathlon`, `olympic_lifting`, `athletic_performance`, `mobility`, `conditioning`, `endurance`, `swimming` — several are **not in `SPECIALTY_TAXONOMY`** (`hiit`/`swimming` are; others aren't) — seeded trainers bypass `normalizeSpecialties` and some filters won't match them | `seed-trainers.js:21-31` vs `config/specialties.js` |
| D8 | `verifyTrainer` admin path toggles `verified`/`active` but does **not** set `applicationStatus` — a trainer verified via this path stays non-`approved` and fails `requireApprovedTrainer` (must use `/review approve`) | `adminOperations.js:45` |
