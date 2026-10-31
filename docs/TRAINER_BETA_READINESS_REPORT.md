# Humai Trainer Platform — Beta Readiness Report

**Generated:** 2026-10-31 · Backend `e9a38ff` · Mobile `804ff07`
**Overall verdict:** **NOT READY FOR BETA DEPLOY.** Core functionality and security are implemented and well-tested in suite, but the production deploy of this code has already failed once, staging validation was not possible, and live end-to-end journey + device UI validation remain unverified. Critical security behavior is covered by automated tests (all passing), not by live adversarial probing.

---

## 1. Feature flag verification

| Requirement | Status | Evidence |
|---|---|---|
| Enumerate all 12 flags + exact keys | **PASS** | `src/config/featureRegistry.js` + `docs/ADVANCED_TRAINER_FEATURE_FLAGS.md`: `trainer_registration`, `trainer_discovery`, `trainer_coaching`, `trainer_insights`, `trainer_advanced_features_enabled`, `trainer_workout_plans_enabled`, `trainer_nutrition_guidance_enabled`, `trainer_messaging_enabled`, `trainer_scheduling_enabled`, `trainer_paid_coaching_enabled`, `trainer_workout_plan_ai_enabled`, `trainer_nutrition_ai_enabled` |
| Secure default when PostHog unavailable | **PASS** | `src/middleware/requireFeature.js` `evalKey()` — evaluation errors return true ONLY when `FEATURES[key].failOpen`; all 12 trainer flags are fail-closed (default `false`) in the registry → PostHog outage → `403 FEATURE_DISABLED`, not exposure |
| Parent-child dependencies | **PASS** | Registry `dependsOn`: every `trainer_*_enabled` module flag → `trainer_advanced_features_enabled` → `trainer_dashboard`. Child cannot resolve true while a parent resolves false (dependency resolution tests pass) |
| Every advanced screen gated | **PASS (code)** | All new screens registered in `RootNavigator` via `gateScreen`/`feature flag` checks; route params carry `relationId`. Visual proof on device = NOT TESTED (§4) |
| Every advanced backend route gated | **PASS** | Verified by grep: router-level `requireFeature` on `trainerWorkoutPlans`, `myWorkoutPlans`, `trainerNutritionPlans`, `myNutritionPlans`, `conversations`, `trainerSchedule`, `myBookings`, `trainerCommerce`, `myPurchases`; per-route gates on `trainers.js` (`trainer_registration`/`trainer_discovery`/`trainer_coaching`/`trainer_insights`) and `trainerRequests.js` |
| Disabled features inaccessible via direct API | **PASS (tested in suite)** | Flag-off `403 FEATURE_DISABLED` cases are asserted in each module test suite (workout plans 8/8, nutrition 20/20, messaging 15/15, scheduling 25/25, commerce 19/19). No live PostHog-off probing was run against a deployed env |
| Manual food/exercise logging works with all trainer+AI flags off | **PASS** | `foodLogs.js` and `exercises.js` contain **no `requireFeature`** — manual logging is ungated by design; AI-assisted endpoints carry their own flags. Mobile tests 380/380 incl. logging flows |
| PostHog setup instructions + `distinct_id` | **PASS** | §A below |
| Do not enable advanced features globally | **PASS** | All 12 created at 0%/disabled; nothing enabled globally |

### A. PostHog setup (production)

Flags already created per `ADVANCED_TRAINER_FEATURE_FLAGS.md`. To enable for your account only: add release condition `distinct_id = <your User.id UUID>` (backend sends the Postgres `User.id`, **not email**, as `distinct_id`). Minimum enabling set for base features: `trainer_dashboard`, `trainer_registration`, `trainer_discovery`, `trainer_coaching`, `trainer_insights`. Then `trainer_advanced_features_enabled` plus each desired module flag. **Never enable `trainer_paid_coaching_enabled`** (mock provider only); leave the two AI flags off. Retrieve your UUID: `SELECT id FROM "User" WHERE email='<you>'`.

## 2. Database and migration verification

| Requirement | Status | Evidence |
|---|---|---|
| Review all new Prisma migrations | **PASS** | Single new migration `20261031191524_trainer_platform_advanced/migration.sql` (616 lines) reviewed in full: additive `CREATE TABLE`/`ALTER ... ADD COLUMN`/FKs for TrainerCertification, TrainerClientConsent, workout-plan v2, nutrition plans, Conversation/Message, scheduling, payments/entitlements, DevicePushToken |
| No deletion/overwrite of existing user records | **PASS** | Only existing-schema change: `ALTER "WorkoutPlan" ALTER "clientId" DROP NOT NULL` (widening, non-destructive). Zero `DELETE`/`DROP TABLE`/`UPDATE` statements |
| Validate against staging database | **BLOCKED** | **No reachable staging DB exists.** Local env points at `postgres.railway.internal` (private DNS, unreachable off-platform). Applied to local dev Postgres successfully — not a staging substitute |
| Verify all new models | **PASS** | Models exercised by 775 backend tests incl. certification lifecycle, 8-category consent, request/accept relations, plan versioning, allergy-conflict nutrition, conversation scoping, booking overlap tx, entitlement idempotency |
| Seed scripts idempotent | **PASS** | `seed-trainers.js` + `backfill-trainer-platform.js` use upsert/find-or-create; backfill grants `v0-legacy` consent without overwriting existing decisions. **Caveat:** run-twice on a clean DB not explicitly re-executed this pass |
| Fictional data restricted to dev/staging | **PASS** | Seeds ran on local dev only; `humai-seed.example` domains; not executed on prod |
| No production migration without approval | **PASS** | Not executed. Note: Railway `deploy:prepare` **auto-runs `prisma migrate deploy`** on the next prod deploy — approval gate is the deploy itself |

## 3. Test suite results

| Requirement | Status | Evidence |
|---|---|---|
| Timezone failure investigated + root-caused | **PASS** | `reminderPlan.test.ts` — quiet-hours reschedule added raw `86_400_000` ms across a DST boundary (test date near Nov fall-back), landing a 07:00 target at 06:00 local. **Fix:** advance the calendar day via `setDate(getDate()+1)` — wall-clock preserving |
| Fix does not change intended tz behavior | **PASS** | Verified `TZ=UTC`, `TZ=America/New_York`, `TZ=Australia/Sydney`, `TZ=Asia/Kolkata` — 21/21 in each; behavior identical except across DST transitions (the bug itself) |
| Backend full suite | **PASS** | **68 suites / 775 tests** green |
| Mobile full suite | **PASS** | **67 suites / 380 tests** green (previously 379 — the DST fix closed the last failure) |
| Mobile typecheck/lint | **PASS** | `tsc --noEmit` clean; eslint clean (pre-existing warnings only) |

## 4. Real-device UI validation

| Requirement | Status | Evidence |
|---|---|---|
| All trainer screens vs Humai theme, light/dark, safe areas, typography, nav, loading/empty states, mic placement; screenshots | **NOT TESTED** | No completed simulator/device run with screenshots exists for the trainer surfaces. Earlier reminders-nudge UI was device-verified; trainer screens were verified only by typecheck/lint + design-system code review (all legacy screens migrated off hardcoded styling). iOS simulators exist on this machine but no build/launch was completed |

## 5. End-to-end trainer testing (live journey)

| Requirement | Status | Evidence |
|---|---|---|
| Full synthetic journey (application→approval→discovery→request→consent→plan→progress→guidance→messages→booking lifecycle→revocation→flag-off) | **PASS (suite) / NOT TESTED (live)** | Every step is covered by integration tests in the module suites (775 tests): application lifecycle + admin review, pending-request accept, per-category consent gating, plan assign→client log→trainer progress, guidance that never overwrites FoodLog, participant-only messaging, book/reschedule/cancel, revocation→403, flag-off→403. **No scripted live HTTP journey against a running server was executed** — the runtime doing so was interrupted; recommend executing `docs/TRAINER_SECURITY_TEST_PLAN.md` on staging before beta |

## 6. Security verification

| Requirement | Status | Evidence |
|---|---|---|
| Cross-user / cross-trainer authz | **PASS (suite)** | `trainerAccess.js` enforces approved-trainer → active-relation → per-category consent on every client-data path; tested including dropped/paused/completed relations (F1 fix) |
| Unrelated clients | **PASS** | No active relation → 403 (tests) |
| Revoked consent | **PASS** | Revocation blocks subsequent category access (tests) |
| Unshared nutrition / workout records | **PASS** | Per-category consent (`nutrition_summaries`, `workout_records` etc.) tested |
| Another trainer's messages / bookings | **PASS** | Conversation participant check; booking ownership checks (tests) |
| Pending/rejected trainers vs approved APIs | **PASS** | `requireApprovedTrainer` + `requireRole('TRAINER')`; unverified/inactive profiles excluded from discovery (F2 fix); legacy `verify` endpoint now sets `applicationStatus:'approved'` consistently |
| Mock payments can't grant real entitlements | **PASS** | Mock provider only; `requireActiveRelation` added to checkout; HMAC webhook verify + idempotent processing; `trainer_paid_coaching_enabled` ships at 0%. No live provider code exists |
| Live adversarial probing | **NOT TESTED** | All above are suite-tested against in-memory/integration harness, not a deployed environment |

## 7. Beta deployment preparation (prepared, not executed)

**Railway env checklist:** `DATABASE_URL`, `POSTHOG_API_KEY`, `POSTHOG_HOST=https://us.i.posthog.com` (set), `EXPO_ACCESS_TOKEN` or Expo push credentials (push service), `PAYMENTS_PROVIDER=mock` + `PAYMENT_WEBHOOK_SECRET` (mock HMAC), existing auth/JWT/email vars unchanged. Verify `AUTH_TEST_BYPASS` absent in prod (boot guard exists).

**PostHog checklist:** 12 flags exist at 0%; add `distinct_id` release conditions for tester accounts only; `trainer_paid_coaching_enabled` and both AI flags remain off permanently.

**Migration plan:** `prisma migrate deploy` runs automatically via `deploy:prepare` (preDeploy) → `deploy:check` verifies manifest checksums + RBAC → healthcheck `/health/ready`. Migration is additive — safe to roll forward.

**⚠ Known prod issue:** Deploy `de28d129` (commit `e9a38ff`, 15:47 EDT) **FAILED** after a successful build+image push. Previous deploy `fee3201c` still serves traffic. All three `deploy-prepare` steps pass locally (35 migrations, 7 roles verified), so failure is likely in `prisma migrate deploy` against prod data/drift or a healthcheck race — **inspect the failed deployment's logs in Railway dashboard before redeploying.**

**TestFlight steps:** bump build → `eas build --platform ios --profile production` (or Xcode archive) → upload → TestFlight → install. **Android:** `cd android && ./gradlew assembleRelease` → `adb install` (existing USB flow).

**Rollback:** redeploy previous Railway deployment (`fee3201c`) — new tables are additive so old code runs fine; PostHog release conditions are self-contained — remove them or set 0%; no data backfill needed on rollback (new tables inert).

**Known limitations/deferred:** polling messaging (no WebSockets); mock-only payments; message `seq` column deferral; push via native device tokens (Expo Go needs `getExpoPushTokenAsync`); nutritionist-role parity; no staging environment; trainer-screen device UI unverified.

## 8. Summary

- **PASS:** flags/defaults/dependencies/gating, manual-logging independence, migration safety review, timezone fix, both full suites (775 + 380), suite-level security + E2E coverage, deployment prep docs.
- **BLOCKED:** staging-DB validation (no reachable staging); failed prod deploy `de28d129` needs log inspection/redeploy approval.
- **NOT TESTED:** device/simulator UI pass; live scripted E2E journey; live adversarial security probing.
- **Verdict: do not deploy to production or open beta** until (1) prod deploy failure is diagnosed and a clean deploy lands, (2) staging migration validation runs, (3) live E2E + security probing executes, (4) a device UI pass completes.
