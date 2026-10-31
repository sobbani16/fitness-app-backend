# Advanced Trainer Platform — Architecture

Date: 2026-10-31 · Extends `TRAINER_PLATFORM_ARCHITECTURE_AUDIT.md` / `TRAINER_PLATFORM_IMPLEMENTATION_PLAN.md` (base platform, pending approval). **This document is Phase 1 — no code yet.**

## Verdict

One of five modules has a real head start (workout plans — `WorkoutPlan`/`WorkoutPlanExercise` exist), one has a parallel to copy (nutrition — `MealPlan`/`MealPlanItem` exist for nutritionists), one has a one-way primitive (messaging — `CoachNote`), two are **greenfield** (scheduling, payments). Push notifications are the hidden prerequisite — today the app has **local** reminders only; no device push tokens or server-initiated push exist.

**Sequencing constraint:** this platform consumes the base platform's `TrainerClientConsent` and `applicationStatus` models. Advanced milestones land after base M2–M4.

---

## 1. Existing → proposed mapping

| Spec module | Exists today | Gap |
|---|---|---|
| Workout plans | `WorkoutPlan(trainerId, clientId, title, description, active)` + `WorkoutPlanExercise(exerciseName, sets, reps, targetWeight, order)`; `POST/GET /workout-plans` behind `CREATE_WORKOUT_PLAN` + active-relation check | Flat: no days, rest, tempo, warm-up/cool-down, difficulty, duration, versioning, assignment lifecycle, completion-vs-prescribed tracking, feedback |
| Nutrition guidance | `MealPlan` + `MealPlanItem` (nutritionist-scoped: caloriesTarget/proteinTarget/carbs/fat + items w/ ingredientId+quantityG); `Ingredient`/`Recipe`/`RecipeIngredient` + `ingredientNutrition.calculate`; `MacroGoal.source='trainer'` allowed but no writer route | Nutritionist-only scoping; no targets/guidance text/versioning/assignment/review flow for trainers; no scope-of-practice guardrails |
| Messaging | `CoachNote` (one-way, private|client_visible); `Notification` in-app inbox model | No conversations/messages/read-state/unread-count; no push transport |
| Scheduling | nothing | All new: availability, session types, bookings, events, tz handling, double-book prevention |
| Paid coaching | nothing | All new: packages, purchases, entitlements, transactions, payouts, refunds, promos |
| Notifications | `Notification` table + `ReminderInbox` UI; `expo-notifications` **local scheduled** reminders; **no push tokens, no server push** | Need Expo push-token registration + send worker for remote events |
| Flags | PostHog system live (`/config/features`, `requireFeature`, mobile gates); `trainer_dashboard` exists | Register 8 new flags w/ parent→child `dependsOn` |
| Consent | none (base plan adds `TrainerClientConsent`) | Advanced reads must check consent categories |

## 2. Feature flags (exact spec keys, registry `dependsOn`)

| Key | dependsOn | Gates |
|---|---|---|
| `trainer_advanced_features_enabled` | `trainer_dashboard` | parent — all modules below |
| `trainer_workout_plans_enabled` | parent | `/trainer/workout-plans/*`, plan UI |
| `trainer_nutrition_guidance_enabled` | parent | `/trainer/nutrition/*`, guidance UI |
| `trainer_messaging_enabled` | parent | `/conversations/*`, messages UI |
| `trainer_scheduling_enabled` | parent | `/trainer/schedule/*`, bookings UI |
| `trainer_paid_coaching_enabled` | parent | `/trainer/commerce/*` — stays OFF until legal/store review |
| `trainer_workout_plan_ai_enabled` | `trainer_workout_plans_enabled` | future AI draft assist |
| `trainer_nutrition_ai_enabled` | `trainer_nutrition_guidance_enabled` | future AI guidance assist |

Evaluator already supports `dependsOn` (child forced off when parent off) — verified behavior. Naming note: spec's `_enabled` suffix is kept verbatim as PostHog keys.

## 3. Data model (all new tables additive; no destructive changes)

### Workout plans — evolve, don't fork

Existing `WorkoutPlan` is minimal. Proposal: keep it as the plan header (add columns), add normalized children — avoids duplicating a second plan system:

- `WorkoutPlan` +: `status String @default("draft")` (draft|published|archived), `goal`, `difficulty`, `durationWeeks`, `daysPerWeek`, `startAt`, `endAt`, `version Int @default(1)`, `supersedesId String?` (self-FK → prior version), `assignmentStatus` lives on a new `TrainerWorkoutAssignment`
- `TrainerWorkoutDay(id, planId FK, dayIndex, label?, warmup?, cooldown?, notes?)`
- `TrainerWorkoutExercise` replaces/extends `WorkoutPlanExercise` (+ `restSeconds`, `tempo`, `progression`, `weightGuidance`, `dayId FK`, `exerciseId` FK→existing exercise catalog where resolvable)
- `TrainerWorkoutAssignment(id, planId, clientId, status: assigned|accepted|declined|completed|archived, assignedAt, respondedAt, @@unique(planId, clientId, version semantics))`
- `TrainerWorkoutFeedback(id, assignmentId, clientId, workoutSessionId?, rating?, note, createdAt)`
- Completion = link `WorkoutSession.planAssignmentId?` (nullable col) — **never writes into ExerciseSet/FoodLog semantics**; prescribed vs actual stays separate

### Nutrition guidance

- `TrainerNutritionPlan(id, trainerId, clientId, title, guidanceText?, status draft|published|archived, version, supersedesId?)`
- `TrainerNutritionPlanMeal(id, planId, mealType, timing?, notes?)`
- `TrainerNutritionPlanItem(id, mealId, ingredientId? FK, recipeId? FK, quantityG, substitutions Json?)` — nutrition computed via existing `ingredientNutrition.calculate` at read time
- `TrainerNutritionTargets(id, planId, caloriesKcal?, proteinG?, carbsG?, fatG?, fiberG?, waterMl?)` (1:1)
- `TrainerNutritionAssignment(id, planId, clientId, status, ...)`, `TrainerNutritionFeedback(...)` — mirrors workout assignment
- Safety: `scopeDisclaimer` rendered client-side; trainer claims never relabeled as medical; allergy fields read from `UserHealthProfile` only when `nutrition` consent granted — plan items are **suggestions**, never auto-write `FoodLog`

### Messaging — polling first (no new infra)

- `Conversation(id, relationId FK→TrainerClient unique, createdAt)` — 1:1 keyed to the relationship itself; no arbitrary DMs
- `Message(id, conversationId FK, senderId, body Text, createdAt, readAt?, deletedAt?)` + `@@index([conversationId, id])` cursor pagination
- `ConversationRead(conversationId, userId, lastReadMessageId)` or derive from `Message.readAt` per-participant — simpler: `readAt` on message + `lastReadAt` on a per-user row
- Transport: **REST + polling** (`GET /conversations/:id/messages?after=<cursor>` on view-focus, `GET /conversations/unread-count` on interval piggybacking the flags refresh). Railway runs one long-lived Node — SSE upgrade path documented, not built. Rationale: spec says simplest reliable; Expo Go/dev-build WS adds fragility for marginal UX gain at launch scale.
- Push: Expo push service (free) — new `DevicePushToken(userId, token, platform, updatedAt)` + `expo-server-sdk` on send; body = generic ("New message from your coach"), never message content.
- Retention: messages preserved on relation end (read-only archive); feature-off ≠ deletion.

### Scheduling — all new

- `TrainerAvailability(id, trainerId, weekday 0–6, startMin, endMin, timeZone IANA, effectiveFrom, effectiveTo?)` — weekly windows in trainer tz
- `TrainerSessionType(id, trainerId, name, durationMin, mode virtual|in_person, meetingLink?, bufferMin, minNoticeMin, cancelWindowMin, active)`
- `TrainerBooking(id, relationId, sessionTypeId, startAtUtc, endAtUtc, status: requested|confirmed|declined|canceled|completed|rescheduled, requestedBy, meetingLink?, @@index(trainer-scoped time))`
- `TrainerBookingEvent(id, bookingId, actor, action, fromStart?, toStart?, createdAt)` — full history incl. reschedule chain
- `TrainerSchedulingPreference(trainerId, timeZone, ...)` (1:1)
- Double-booking: `INSERT … SELECT FOR UPDATE` on overlapping bookings inside `coachingTransaction`-style Serializable tx + exclusion check `startAtUtc < endAtUtc AND endAtUtc > startAtUtc` on confirmed/requested; unique partial index optional phase-2.
- tz: store UTC only; trainer windows in IANA tz converted at booking-time; DST handled by `Intl`/luxon-style conversion server-side (audit: backend currently has no tz lib — `progressRange` already validates IANA ids; reuse its validator).

### Payments — schema + interfaces now, live money never

- `TrainerCoachingPackage(id, trainerId, title, kind: subscription|one_time|session_pack, sessionCount?, interval?, priceCents, currency, active)`
- `TrainerPurchase(id, clientId, packageId, provider, providerRef @unique, status: pending|paid|failed|refunded|canceled, amountCents, currency)`
- `TrainerSubscription(id, purchaseId, status, currentPeriodEnd, cancelAt?)`
- `TrainerEntitlement(id, purchaseId?, clientId, trainerId, kind, remainingSessions?, expiresAt?, status)` — **server-side grant only**, never from client claim
- `TrainerPaymentTransaction(id, purchaseId, provider, providerEventId @unique, type, payload Json)` — webhook idempotency via unique `providerEventId`
- `TrainerPayout`, `TrainerRefund`, `TrainerPromotion` — modeled, no processing
- Provider abstraction `services/payments/provider.js` — `MockProvider` now, `StripeConnectProvider` behind config; webhook route verifies signature before any mutation.
- Store-policy note (documented, blocks activation): live 1:1 human coaching is generally IAP-exempt on both stores; digital content/packages may not be — needs counsel confirmation before `trainer_paid_coaching_enabled` ever turns on. US + India payout rails: Stripe Connect Express covers US; India requires PayPal/wise-style alternative — documented decision, not code.

## 4. API contracts (reconciled with existing `/trainers` mounting)

```
# plans
POST   /trainer/workout-plans                 draft create
PATCH  /trainer/workout-plans/:id             edit draft
POST   /trainer/workout-plans/:id/publish
POST   /trainer/workout-plans/:id/revise      → new version, supersedes
POST   /trainer/workout-plans/:id/assign      {clientId}
GET    /trainer/workout-plans                 trainer's
GET    /me/workout-plans                      client's assigned
POST   /me/workout-plans/:assignmentId/respond {accept|decline}
POST   /me/workout-plans/:assignmentId/feedback
# nutrition — same shape under /trainer/nutrition-plans + /me/nutrition-plans
# messaging
GET    /conversations                         mine (trainer or client)
GET    /conversations/unread-count
GET    /conversations/:id/messages?after=&limit=
POST   /conversations/:id/messages            {body}
POST   /conversations/:id/read                {lastMessageId}
POST   /conversations/:id/report              abuse
# scheduling
PUT    /trainer/schedule/availability
POST   /trainer/schedule/session-types        CRUD
GET    /trainers/:id/availability?from=&to=   computed bookable slots (client view)
POST   /me/bookings                           request slot (tx, conflict→409)
POST   /trainer/bookings/:id/respond          confirm|decline
POST   /me/bookings/:id/cancel | /reschedule
GET    /me/bookings | /trainer/bookings
# commerce (flag stays off)
GET    /trainers/:id/packages
POST   /me/purchases/checkout                 → provider session
POST   /webhooks/payments/:provider           signature-verified
GET    /me/entitlements | /trainer/payouts
```

Every route: `requireFeature(<module>)` → role/trainer-approved check → `active` relation (new M4 helper `requireActiveRelation`) → consent category where data read. New audit FIELDS: message never logs body; booking/payment events logged.

## 5. Notifications

New `DevicePushToken` + `services/push.js` (expo-server-sdk). Event map: plan.assigned/published → client; message.created → recipient (generic body); booking.requested → trainer; booking.responded → client; booking.reminder (scheduled worker — reuse reminders scheduler pattern); entitlement.activated → client. Dedup via `Notification.dedupeKey`; respect `ReminderPreference` opt-ins + a new `pushEnabled` consent. Deep links gated by flag checks client-side.

## 6. Security controls (delta from base plan)

- Conversation/message/ booking access = participant-of-relation check (no `?userId=` trust)
- Slots reserved in Serializable tx; idempotency keys on booking create + purchase checkout
- Webhook signature verify + `providerEventId` unique → replay-proof
- Message bodies excluded from `auditService` snapshots + logs
- Consent gates: nutrition plan read needs `nutrition_logs` consent; workout-plan read needs `workout_records`; scheduling needs active relation only; messaging needs active relation
- Rate limit message POST (reuse `apiLimiter` pattern, tighter bucket)
- Negative tests: cross-trainer conversation read, ended-relation message send, unapproved-trainer plan create, flag-off direct API, entitlement-forgery, duplicate webhook replay, double-book race

## 7. Implementation order (per spec milestones)

M1 flags (registry + PostHog create + mobile keys + parent/child tests) → M2 workout plans (schema → builder → assignment → client view → completion link) → M3 nutrition (mirror + ingredient reuse + scope guardrails) → M4 messaging (models → REST → push tokens → unread) → M5 scheduling (availability → bookings → tz tests incl. DST) → M6 payments (schema + mock provider + contracts doc only) → M7 validation sweep. Each ends with tests; acceptance report at end.

**Prerequisite ordering:** advanced M1 can start anytime (flags are independent); advanced M2–M5 need base-platform M4 consent + `requireActiveRelation` helper. Recommendation: approve both specs together; build base M1–M4 first, then advanced M1–M6.

## 8. Deliverables produced later, per milestone

`ADVANCED_TRAINER_FEATURE_FLAGS.md` (M1) · `TRAINER_WORKOUT_PLANS.md` (M2) · `TRAINER_NUTRITION_GUIDANCE.md` (M3) · `TRAINER_MESSAGING_ARCHITECTURE.md` (M4) · `TRAINER_SCHEDULING_ARCHITECTURE.md` (M5) · `TRAINER_PAYMENTS_ARCHITECTURE.md` (M6) · `ADVANCED_TRAINER_API_CONTRACTS.md` (M4) · `ADVANCED_TRAINER_SECURITY_TESTS.md` (M6) · `ADVANCED_TRAINER_ACCEPTANCE_REPORT.md` (M7).
