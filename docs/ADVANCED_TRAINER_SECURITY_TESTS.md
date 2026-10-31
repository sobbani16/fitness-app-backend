# Advanced Trainer — Security Test Matrix

Date: 2026-10-31 · Suites: `tests/{trainerWorkoutPlans,trainerNutrition,messaging,scheduling,trainerCommerce}.test.js` — 87 tests total (8+20+15+25+19), all executed green 2026-10-31 (`npx jest <files> --runInBand`). Prisma fully mocked; auth via `x-user-id`; flags via `FF_*` env.

## Threat → executed tests

| # | Threat | Suite → test | Status |
|---|---|---|---|
| AT1 | **Unapproved-trainer writes** (application pending/rejected) | workoutPlans → `unapproved trainer cannot create plans`; commerce → `403 for TRAINER without approved profile`; scheduling → availability write requires approved (asserted via `requireApprovedTrainer` mock in route tests) | ✅ |
| AT2 | **Non-trainer on trainer routes** | workoutPlans → `non-trainer cannot reach trainer routes`; nutrition → `rejects non-trainer callers`; scheduling → `non-trainer role is rejected`; commerce → `403 for MEMBER role`, `401 without x-user-id`; messaging → `non-trainer cannot start a conversation with a client` | ✅ |
| AT3 | **Cross-trainer reads/writes** | nutrition → `plan detail hidden from non-owner trainers`, `trainer sees own plans in list only`; commerce → `PATCH rejects packages owned by another trainer`; scheduling → `sessionType of another trainer is rejected` | ✅ |
| AT4 | **Cross-participant reads** (other clients' data) | workoutPlans → `non-client cannot read assignment`; nutrition → `another user cannot read or respond to the assignment`; messaging → `non-participant cannot read, send, mark-read, or report`; scheduling → `non-participant cannot book on someone else's relation` | ✅ |
| AT5 | **Dropped-relation abuse** | messaging → `sends blocked with 403 but history stays readable for both parties`; scheduling → `inactive (dropped) relation cannot book`; nutrition → `assign is blocked before publish-state consent check without relation` | ✅ |
| AT6 | **Pending-consent data read** | nutrition → `assign warns about allergy conflicts once consent granted; items never dropped` + `no nutrition summary without consent`; workoutPlans → consent-gated session list asserted in progress flow (`workoutRecordsConsent`/`sessions:[]`) | ✅ |
| AT7 | **Flag-off direct API** | every suite: `flag OFF → 403 FEATURE_DISABLED on both routers` (workoutPlans, nutrition, messaging, scheduling, commerce) | ✅ |
| AT8 | **Parent-flag cascade bypass** (child env-enabled while parent off) | nutrition → `parent flag off => child resolves off even when env-enabled`; messaging → `advanced parent flag off forces messaging off even when child env is true`; scheduling → `parent flag off cascades to scheduling` | ✅ |
| AT9 | **Double-book race / slot theft** | scheduling → `double-booking prevented: second request on same slot → 409 SLOT_TAKEN`, `reschedule re-checks overlap`; `existing booking + buffer blocks overlapping candidates; minNotice filters` | ✅ |
| AT10 | **Cancel-window abuse / wrong-state transitions** | scheduling → `client cancel window enforced on confirmed bookings`, `requested bookings can be withdrawn`, `respond rejects bad action and non-pending states`, `markCompleted` gating | ✅ |
| AT11 | **Min-notice / tz abuse** | scheduling → `min-notice enforced on request`; `isValidTimeZone` rejects bad ids; DST tests pin correct UTC math | ✅ |
| AT12 | **Webhook forgery / replay** | commerce → `rejects a bad signature with 400`, `rejects a missing signature with 400`, `rejects an unknown provider with 400`, `webhook replay with the same providerEventId is a no-op 200` | ✅ |
| AT13 | **Entitlement forgery / client-reported success** | commerce → `checkout creates a pending purchase; webhook activates the entitlement` (only webhook path activates); `idempotent checkout replay returns the existing purchase`; `subscription package creates subscription + subscription entitlement`; `one_time package grants a single session` | ✅ |
| AT14 | **Refund abuse** | commerce → `trainer refund marks purchase refunded and revokes entitlements`; non-owner refund → 403 (package-ownership check in `refundPurchase`) | ✅ |
| AT15 | **Message abuse** | messaging → `body over 4000 chars or empty is rejected`, `missing identity is rejected`, `report writes message.report audit on Conversation, never the body`, `push transport failure never fails the send` | ✅ |
| AT16 | **Injection into FoodLog via plan log** | nutrition → `foodName-only items need macro overrides; others can be omitted`, `logging a suggested ingredient item creates own FoodLog w/ trainer_plan source`, `plan lifecycle never auto-writes FoodLog or MacroGoal` | ✅ |
| AT17 | **Invalid window/tz payloads** | scheduling → `validates windows and tz` (bad weekday, startMin≥endMin, bogus IANA) | ✅ |

## Deferred / not covered

| Gap | Note |
|---|---|
| Serializable-tx race under real DB | `SLOT_TAKEN` logic asserted on mocks; P2034→409 mapping exists in both routers but concurrent-execution proof needs a real Postgres harness |
| Message rate limit | limiter `skip`s under `NODE_ENV=test`; bucket math untested |
| Message id-ordering | cursor correctness relies on lexicographic `id` order — works but is non-chronological on uuid ids (see TRAINER_MESSAGING_ARCHITECTURE.md §4) |
| Entitlement decrement/theft | no consume path exists to test |
| Stripe-provider signature path | only MockProvider's HMAC is exercised |
| Push payload leakage | generic-body assertion covered; device-token hijack (registering another user's token) not tested — upsert re-assigns token to caller, which is the intended takeover semantics but unverified negative-case |
| Webhook raw-body drift | `JSON.stringify(req.body)` re-serialization could diverge from provider-sent bytes under a real provider — needs raw-body middleware when a live provider lands |
