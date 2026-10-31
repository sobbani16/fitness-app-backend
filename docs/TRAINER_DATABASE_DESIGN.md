# Trainer Platform — Database Design

Date: 2026-10-31 · Source of truth: `prisma/schema.prisma` (lines 764–830, 1979–2333), `src/services/trainerAccess.js`, `src/services/trainerRelations.js`, `prisma/backfill-trainer-platform.js`. Additive-only: every trainer-table change was a new column or new table; no destructive migration.

## 1. Core models

### TrainerProfile (schema:764)

One row per trainer applicant **and** per approved trainer — the same table doubles as the application record (see §3 state machine).

| Field | Type | Notes |
|---|---|---|
| `id` | String uuid PK | referenced everywhere as `trainerId` |
| `userId` | String @unique | **scalar, no FK to User** — see §7 |
| `bio`, `philosophy`, `website` | String? | application/display fields |
| `certifications` | String[] | legacy flat cert names — kept in sync, backfilled into `TrainerCertification` |
| `specialties` | String[] | stable taxonomy ids via `config/specialties.js` `normalizeSpecialties` (labels accepted as aliases, unknown → 400) |
| `yearsExperience` | Int | required at submit |
| `hourlyRate` | Float? | **dead — no API writes it** (audit F6; seed writes it for realism) |
| `tier` | String @default("standard") | standard \| pro \| elite; self-declared at signup, admin-changeable |
| `location`, `country`, `timeZone` | String? | discovery filters + scheduling tz fallback |
| `languages` | String[] | discovery filter (`has`) |
| `coachingMode` | String @default("both") | online \| in_person \| both |
| `verified` | Boolean | public "verified" badge; set only by admin approve/verify path |
| `active` | Boolean | kill switch; un-approved or rejected trainers are `active:false` |
| `rating`, `ratingCount` | Float?, Int | only writer is client drop survey (`trainerRating`) |
| `profilePicture` | String? | |
| `maxClients` | Int @default(10) | roster cap (pending+active counted at request time, active-only at accept) |
| `displayName` | String? | trainer-chosen public name; falls back to `User.firstName lastName` |
| `isDiscoverable` | Boolean @default(true) | extra opt-out from public listing |
| `applicationStatus` | String @default("submitted") | see §3 |
| `applicationNote` | String? | admin-visible decision note, shown to applicant via `GET /applications/me` |
| `approvedAt`, `approvedBy` | DateTime?, String? | written by `reviewTrainer(approve)` |

Relations out: `clients`, `workoutPlans`, `coachNotes` (SetNull), `dropForms`, `certificationsV2`, `availabilities`, `sessionTypes`, `schedulingPref`, `packages`, `payouts`, `nutritionPlans`. All Cascade except `coachNotes`/`payouts` (SetNull — preserves history).

### TrainerClient (schema:808) — the relationship

| Field | Type | Notes |
|---|---|---|
| `id` | String uuid PK | `relationId` everywhere else |
| `trainerId` | String FK→TrainerProfile Cascade | |
| `clientId` | String | **scalar, no FK to User** — see §7 |
| `status` | String @default("pending") | pending \| active \| paused \| completed \| dropped — see §4 |
| `requestedBy` | String? | "client" \| "trainer" — decides who confirms |
| `assignedAt` | DateTime | request creation time |
| `startedAt` | DateTime | start of current engagement; progress `from` floor |
| `lockedUntil` | DateTime? | first day of next month UTC; blocks subscribe/drop until then (423) |
| `droppedBy`, `dropReason` | String? | dropReason = JSON `{reasons,notes}` on survey drops; plain `'declined'`/`'cancelled'` on request decline |

`@@unique([trainerId, clientId])` — one relation row per pair, reused across the whole lifecycle (re-requests upsert, never insert a second row). Indexes on `trainerId`, `clientId`.

### TrainerClientConsent (schema:1997)

| Field | Type | Notes |
|---|---|---|
| `relationId` | FK→TrainerClient Cascade | |
| `category` | String | one of 8 categories (§2) |
| `status` | String @default("pending") | pending \| granted \| revoked |
| `policyVersion` | String @default("v1") | `"v0-legacy"` for backfilled/seeded grants |
| `grantedAt`, `revokedAt` | DateTime? | revoke writes `revokedAt`, effective immediately server-side |

`@@unique([relationId, category])`. Rows are **proposed** (all-`pending`) at request creation; grant/revoke is client-only via `PUT /trainer-relationships/:id/consents`. Consents stay `pending` after accept — activation does not imply consent. Decline/end flips all non-revoked rows to `revoked`.

### TrainerDropForm (schema:836)

Structured exit survey. `relationId` FK Cascade, `trainerId` FK Cascade, `clientId` scalar. `reasons String[]` from fixed code lists; trainer-side fields `candidateGoals`, `adherenceRating`; client-side `trainerRating` (1–5, aggregated into `TrainerProfile.rating`).

### TrainerCertification (schema:1979)

Structured certs: `name`, `issuingOrganization`, `credentialId`, `issuedAt`, `expiresAt`, `verificationStatus` (`unverified | pending_review | verified | rejected | legacy`), `verifiedAt`, `verifiedBy`. Every trainer write forces `verificationStatus:'unverified', verifiedAt/By:null` — only admin tooling may mark verified (no public endpoint does today).

### TrainerWaitlist (schema:866)

Stub. `@@unique([userId, trainerId])`. Never wired — reserved for a "notify me" feature.

## 2. Consent categories (enum is code, not schema)

`CONSENT_CATEGORIES` in `src/services/trainerAccess.js:6`:

| Category | Gates |
|---|---|
| `workout_records` | `workoutSessions` progress section; plan-progress session lists |
| `food_logs` | allergy-conflict check (with `nutrition_summaries`); food-log summary |
| `nutrition_summaries` | `macroScores` section; nutrition summary; allergy check |
| `weight_trends` | `weight` section |
| `sleep_summaries` | `sleep` section |
| `step_counts` | `steps` section |
| `body_measurements` | declared; **no query consumes it yet** |
| `health_scores` | `healthScores` section (added post-audit — the 8th category) |

Rule: ungranted categories are **omitted** from responses, never an error (`trainerService.getClientProgress`).

## 3. `applicationStatus` state machine

```
draft → submitted → under_review → approved
                     ↓              rejected | changes_requested
changes_requested/rejected → (resubmit) → submitted
approved → (reject/request_changes review) → un-verified + inactive
```

| Transition | Writer | Effect |
|---|---|---|
| `signup` / `POST /applications` | user | creates profile `submitted` (signup) or `draft` (applications endpoint) with `verified:false, active:false` |
| `PATCH /applications/me` | user | only `draft`/`changes_requested` editable → else 409 |
| `POST /applications/me/submit` | user | validates bio+yearsExperience+≥1 specialty → `submitted` |
| `PATCH /admin/trainers/:id/review {approve}` | MANAGE_TRAINERS | atomic: `verified:true, active:true, applicationStatus:'approved', approvedAt/By` + `UserRole(TRAINER)` upsert + **session revoke** + audit |
| `…/review {reject|request_changes}` | MANAGE_TRAINERS | `verified:false, active:false`, status `rejected`/`changes_requested`, TRAINER role deactivated, sessions revoked — cannot appear in discovery until re-approved |
| `PATCH /admin/trainers/:id/verify` | MANAGE_TRAINERS | legacy path: verified+active toggle + role + session revoke (does **not** set applicationStatus) |

Self-approval is impossible: both admin paths require `MANAGE_TRAINERS` via in-tx `authorize()` re-check.

## 4. `TrainerClient.status` lifecycle

```
subscribe (client) ──→ pending ──accept──→ active ──→ completed | dropped
invite (trainer) ────→ pending ──accept──→ active
pending ──decline/cancel──→ dropped (dropReason 'declined'|'cancelled')
active ──survey drop──→ dropped (dropReason JSON)   active ──pause──→ paused
completed/dropped ──re-request──→ pending (upsert resets startedAt/lock)
```

| Rule | Where |
|---|---|
| Only `active` grants data access | `requireActiveRelation` throws 403 otherwise (F1 fix) |
| Accept = non-requesting party only | `assertConfirmer`; requester self-accept → 403 |
| Accept sets `startedAt`, `lockedUntil` = 1st of next month | `acceptRequest`, `activatePending`, mutual-intent paths |
| Mutual intent auto-accepts | client-invite on existing client-request → active (and vice-versa via subscribe on trainer-invite) |
| Capacity: `active`+`pending` count at request creation; `active`-only count at accept | `subscribeToTrainer`/`inviteClient` vs `acceptRequest` |
| One outstanding client-initiated request per client | 409 in `subscribeToTrainer` |
| Re-request on dropped/completed row upserts → `pending` | `upsert(trainerId_clientId)` |

`paused` is settable only via `PATCH /clients/:clientId/status` and is treated as non-active for all reads (progress 403) while remaining in the trainer's roster list.

## 5. Backfill semantics (`prisma/backfill-trainer-platform.js`)

| Step | Effect |
|---|---|
| 1 | `verified:true` profiles → `applicationStatus:'approved'`, `approvedAt` = existing or now |
| 2 | `TrainerProfile.certifications[]` strings → `TrainerCertification(verificationStatus:'legacy')`, dedupe via `findFirst(trainerId,name)` |
| 3 | `active`/`paused` relations → all 8 consent rows `status:'granted', policyVersion:'v0-legacy', grantedAt=startedAt` — `update:{}` in upsert so **later explicit grant/revoke is never overwritten** |

Fully idempotent; safe to re-run. See `TRAINER_SEED_DATA.md` for run instructions.

## 6. Indexes

| Table | Constraints/indexes |
|---|---|
| TrainerClient | `@@unique(trainerId,clientId)`, `(trainerId)`, `(clientId)` |
| TrainerClientConsent | `@@unique(relationId,category)`, `(relationId)` |
| TrainerCertification | `(trainerId)` |
| TrainerDropForm | `(relationId)`, `(clientId)`, `(trainerId)` |
| Conversation | `relationId @unique` (+index) — 1:1 per relation |
| Message | `(conversationId, id)` — id-asc cursor pagination |
| TrainerAvailability | `(trainerId)` |
| TrainerSessionType | `(trainerId)` |
| TrainerSchedulingPreference | `trainerId @unique` (1:1) |
| TrainerBooking | `(relationId)`, `(sessionTypeId,startAtUtc)` |
| TrainerCoachingPackage | `(trainerId)` |
| TrainerPurchase | `providerRef @unique` — checkout idempotency anchor; `(clientId)` |
| TrainerSubscription | `purchaseId @unique` (1:1) |
| TrainerEntitlement | `(clientId,status)`, `(trainerId)` |
| TrainerPaymentTransaction | `providerEventId @unique` — webhook replay dedupe; `(purchaseId)` |
| TrainerNutritionTargets | `planId @unique` (1:1) |
| TrainerWorkoutDay | `@@unique(planId,dayIndex)` |
| DevicePushToken | `token @unique`, `(userId)` |
| WorkoutSession | `(planAssignmentId)` — nullable link, see TRAINER_WORKOUT_PLANS.md |

No partial/exclusion index exists for booking overlap — double-book prevention is the Serializable-tx re-check (`schedulingService.js:500`), not a DB constraint.

## 7. What has no FK, and why

| Column | Why no FK |
|---|---|
| `TrainerProfile.userId` | Pre-existing design; user deletion goes through `accountData.js` ownership registry which deletes `trainerProfile` by `userId` explicitly (tx line ~121). |
| `TrainerClient.clientId`, `TrainerDropForm.clientId`, `CoachNote.clientId` | Same — `accountData.js` maps these scalars via OR-queries on `{clientId, trainerId ∈ trainerIds}` for export/delete. Adding FKs would couple deletes to order; the registry is the enforced contract (schema-coverage test). |
| `WorkoutSession.planAssignmentId` | Nullable by design — sessions exist without assignments; `ON DELETE` behavior intentionally undefined (assignment deletion is not a supported op). |
| `TrainerNutritionPlan.supersedesId`, `WorkoutPlan.supersedesId` (nutrition side has no self-FK) | WorkoutPlan has a self-relation; TrainerNutritionPlan stores the id as a plain scalar — version lineage is read via queries, not joins. |
| `DevicePushToken.userId`, `Message.senderId`, `TrainerBookingEvent.actorId` | Lightweight actor/user references; consistency enforced at service layer; deletion cascades not required. |
| `CoachNote.trainerId`/`nutritionistId` | Optional FKs with `onDelete: SetNull` — notes survive coach removal. |
| `TrainerPayout.trainerId` | FK **without** `onDelete` — intentional: financial records must outlive the profile (schema line 2303 has no Cascade). |

## 8. Advanced-module models (summary)

| Model | Purpose | Key fields |
|---|---|---|
| `WorkoutPlan` (evolved) | plan header | `status draft\|published\|archived`, `version`, `supersedesId` self-FK, `goal/difficulty/durationWeeks/daysPerWeek/startAt/endAt` |
| `TrainerWorkoutDay` | per-day plan content | `@@unique(planId,dayIndex)`, warmup/cooldown/notes |
| `TrainerWorkoutExercise` | exercise rows under days | sets, reps\|repsText, targetWeight, weightGuidance, restSeconds, tempo, progression, `exerciseId` (optional catalog link) |
| `TrainerWorkoutAssignment` | plan→client | `status assigned\|accepted\|declined\|completed\|archived`; no unique constraint — open-status `findFirst` dedupes |
| `TrainerWorkoutFeedback` | client rating/note per assignment | optional `workoutSessionId` |
| `TrainerNutritionPlan/Meal/Item/Targets` | guidance plans | item = `ingredientId\|recipeId\|foodName` + `quantityG` + `substitutions Json`; targets 1:1 |
| `TrainerNutritionAssignment/Feedback` | mirror of workout | `assigned\|accepted\|declined\|archived` |
| `Conversation` / `Message` / `DevicePushToken` | messaging + push | see TRAINER_MESSAGING_ARCHITECTURE.md |
| `TrainerAvailability/SessionType/SchedulingPreference/Booking/BookingEvent` | scheduling | see TRAINER_SCHEDULING_ARCHITECTURE.md |
| `TrainerCoachingPackage/Purchase/Subscription/Entitlement/PaymentTransaction/Payout/Refund/Promotion` | paid coaching | see TRAINER_PAYMENTS_ARCHITECTURE.md |

`WorkoutPlanExercise` (legacy flat list) still exists for the old `/workout-plans` routes; the new system writes `TrainerWorkoutDay`/`TrainerWorkoutExercise` only. `MealPlan`/`MealPlanItem` remain nutritionist-scoped and untouched.
