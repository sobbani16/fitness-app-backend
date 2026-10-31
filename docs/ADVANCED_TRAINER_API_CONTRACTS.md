# Advanced Trainer — API Contracts

Date: 2026-10-31 · Verified against `src/routes/{trainerWorkoutPlans,myWorkoutPlans,trainerNutritionPlans,myNutritionPlans,conversations,pushTokens,trainerSchedule,myBookings,trainerCommerce,myPurchases,paymentWebhooks}.js` + `src/routes/index.js`, `src/app.js` mounts. Same conventions as `TRAINER_API_CONTRACTS.md`: flag gate first (`403 {error:{code:'FEATURE_DISABLED'}}`), then role/identity, service-layer relation/consent checks; `{error:string}` bodies; 400/403/404/409.

## Workout plans (`trainer_workout_plans_enabled`)

Trainer router `/trainer/workout-plans` — flag + `requireRole('TRAINER')` + `requireApprovedTrainer` in service:

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| POST | `/` | `{title*, …scalars, days?[]}` | 201 plan+days | 400, 403 |
| PATCH | `/:id` | scalars and/or `days[]` | plan (draft only) | 409 |
| POST | `/:id/publish` | — | plan | 400 no content, 409 |
| POST | `/:id/revise` | — | 201 draft v+1 | 409 not published |
| POST | `/:id/assign` | `{clientId*}` | 201 assignment | 400, 403 no active relation, 409 dup/unpublished |
| GET | `/` | `?status&take(1–100)&cursor` | `{plans, nextCursor}` | 400 |
| GET | `/:id/progress` | — | `{plannedSessions, assignments:[{completedSessions, workoutRecordsConsent, sessions}]}` | 404 |
| GET | `/:id` | — | plan+days+assignments | 404 |

Client router `/me/workout-plans` — flag + `identifyUser` (ownership in service):

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/` | `?take&cursor` | `{assignments, nextCursor}` | — |
| GET | `/:assignmentId` | — | assignment+plan+feedback+sessions | 404 |
| POST | `/:assignmentId/respond` | `{action: accept\|decline}` | assignment | 400, 404, 409 |
| POST | `/:assignmentId/feedback` | `{rating?1–5, note?, workoutSessionId?}` | 201 feedback | 400, 409 |
| POST | `/:assignmentId/complete` | `{workoutSessionId*}` | assignment | 400, 403 foreign session, 409 |

## Nutrition plans (`trainer_nutrition_guidance_enabled`)

Trainer router `/trainer/nutrition-plans` — flag + `requireRole('TRAINER')`:

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| POST | `/` | `{title*, guidanceText?, clientId?, meals?[], targets?}` | 201 `{…plan, disclaimer}` | 400, 403 |
| GET | `/clients/:clientId/progress` | — | `{relation, grantedCategories, assignments, nutritionSummary?}` | 403 |
| GET | `/` | `?status=` | `{disclaimer, plans}` | 400 |
| GET | `/:id` | — | plan + computed nutrition + assignments + disclaimer | 404 |
| GET | `/:id/preview` | — | `{meals, totals, partialTotals, complete, allergyCheckConsent, allergyConflicts, disclaimer}` | 404 |
| PATCH | `/:id` | draft-only patch | `{…plan, disclaimer}` | 409 |
| POST | `/:id/publish` `/archive` | — | `{…plan, disclaimer}` | 400/409 |
| POST | `/:id/revise` | optional overrides | 201 `{…plan, disclaimer}` | 409 |
| POST | `/:id/assign` | `{clientId*}` | 201 `{assignment, disclaimer, allergyCheckConsent, allergyConflicts}` | 400, 403, 409 |

Client router `/me/nutrition-plans` — flag + `identifyUser`:

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/` | — | `{disclaimer, assignments}` | — |
| GET | `/:assignmentId` | — | assignment + plan + own-allergy conflicts + disclaimer | 404 |
| POST | `/:assignmentId/respond` | `{action}` | `{assignment, disclaimer}` | 400, 409 |
| POST | `/:assignmentId/feedback` | `{rating?, note?}` | 201 `{feedback, disclaimer}` | 400, 409 |
| POST | `/:assignmentId/log` | `{mealId*, loggedAt?, items?}` | 201 `{logs:[FoodLog], disclaimer}` — own rows only | 400 (+`items` needing input), 404, 409 |

## Messaging (`trainer_messaging_enabled`)

Router `/conversations` — flag + `identifyUser`; participant checks in service; send rate-limited 30/min/user (`MESSAGE_RATE_LIMIT`):

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/` | — | `{conversations}` (lastMessage, unreadCount) | — |
| GET | `/unread-count` | — | `{count}` | — |
| POST | `/with/:clientId` | — (trainer) | `{conversation}` 201/200 | 403 |
| POST | `/with-trainer/:trainerId` | — (client; trainer profile id) | `{conversation}` 201/200 | 403 |
| GET | `/:id/messages` | `?after&limit≤50` | `{messages, nextCursor}` | 400, 403 |
| POST | `/:id/messages` | `{body 1–4000}` | 201 `{message}` | 400, **403 ended relation**, 429 |
| POST | `/:id/read` | `{lastMessageId}` | `{markedRead}` | 400 |
| POST | `/:id/report` | — | `{reported:true}` | 403 |

Push tokens `/me/push-tokens` — `identifyUser` only, **unflagged**: `POST {token*, platform: ios|android}` → 201 upsert; `DELETE /:token` → `{removed:true}`.

## Scheduling (`trainer_scheduling_enabled`)

Trainer router `/trainer/schedule` — flag + `requireRole('TRAINER')` + approved-trainer in service:

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| PUT | `/availability` | `{windows[]≤100, timeZone?}` | `{availability}` | 400 |
| GET | `/availability` | — | `{timeZone, windows}` | — |
| POST | `/session-types` | `{name*, durationMin*, mode?, meetingLink?, bufferMin?, minNoticeMin?, cancelWindowMin?}` | 201 | 400 |
| GET | `/session-types` | — | `{sessionTypes}` incl. inactive | — |
| PATCH/DELETE | `/session-types/:id` | partial / — | row / `{deleted}` or `{deactivated}` | 400, 404 |
| GET | `/bookings` | `?status&from` | `{bookings}` ≤200 | 400 |
| POST | `/bookings/:id/respond` | `{action: confirm\|decline}` | booking | 400, 403, 409 |
| POST | `/bookings/:id/cancel` `/reschedule` `/complete` | `{startAtUtc?}` | booking | 409, 403 |

Client router `/me` — flag + `identifyUser`:

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| POST | `/me/bookings` | `{relationId*, sessionTypeId*, startAtUtc*, clientNote?}` | 201 booking | 400 `MIN_NOTICE`, 403, **409 `SLOT_TAKEN`** |
| GET | `/me/bookings` | — | `{bookings}` ≤100 | — |
| POST | `/me/bookings/:id/cancel` `/reschedule` | `{startAtUtc?}` | booking | 409 `CANCEL_WINDOW`/`SLOT_TAKEN` |
| GET | `/me/available-slots` | `?trainerId&from&to&sessionTypeId` (range ≤93d) | `{slots:[ISO]}` | 400, 403, 404 |

## Commerce (`trainer_paid_coaching_enabled`)

Trainer router `/trainer/commerce` — flag + `requireRole('TRAINER')` + approved:

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| POST | `/packages` | `{title*, kind*, priceCents*, currency?, sessionCount?, interval?}` | 201 | 400 |
| GET | `/packages` | `?active=1` | `{packages}` | — |
| PATCH/DELETE | `/packages/:id` | partial (kind immutable) / — | pkg | 400, 404 |
| GET | `/purchases` `/payouts` | — | `{purchases}` / `{payouts}` | — |
| POST | `/purchases/:purchaseId/refund` | `{amountCents?, reason?}` | `{refundRef, …status:'refunded'}` | 400, 403, 404 |

Client router `/me` — flag + `identifyUser`:

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| POST | `/me/purchases/checkout` | `{packageId*, idempotencyKey*}` | 201 `{purchase, checkout}` / 200 reused | 400 self-buy, 404 inactive |
| GET | `/me/purchases` | — | `{purchases}` | — |
| GET | `/me/entitlements` | — | `{entitlements}` | — |

Webhook `POST /webhooks/payments/:provider` — **public, no session, no flag**; HMAC signature headers `x-mock-signature`/`x-payment-signature`: 200 `{duplicate}` / `{processed:true, type}` / `{ignored:'unknown_purchase'}`; 400 bad/missing signature or unknown provider.
