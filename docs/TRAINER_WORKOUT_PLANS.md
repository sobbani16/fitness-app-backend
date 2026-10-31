# Trainer Workout Plans

Date: 2026-10-31 · Verified against `src/services/trainerPlanService.js`, `src/routes/{trainerWorkoutPlans,myWorkoutPlans}.js`, `prisma/schema.prisma` (models at 941–1047). Flag: `trainer_workout_plans_enabled`. Tests: `tests/trainerWorkoutPlans.test.js` (8).

## 1. Lifecycle

### Plan (WorkoutPlan row)

```
createDraft → draft ──publish──→ published ──revise──→ (old → archived, new draft v+1 supersedesId→old)
                 └──────── archive via revise only ──┘
```

| Transition | Rules |
|---|---|
| `createDraft` | approved trainer required; optional `days[]` written atomically |
| `updateDraft` | **only `draft`** (else 409 "Revise a published plan instead"); scalar patch + full `days[]` replace (deleteMany + recreate); merged startAt<endAt checked |
| `publish` | requires ≥1 day containing ≥1 exercise (400); `status:'published', active:true` |
| `revise` | only `published`; clones scalars+days+exercises into a new `draft` with `version+1` and `supersedesId`→old; old row → `archived, active:false`. Returns 201 |
| `archive` | no standalone endpoint — archiving happens only via `revise` |
| `assign` | requires `published` + **active relation**; open assignment (status `assigned`\|`accepted`) for same plan+client → 409; creates `TrainerWorkoutAssignment(status:'assigned')` + `Notification(trainer.plan_assigned)` |

### Assignment (TrainerWorkoutAssignment row)

```
assigned ──respond accept──→ accepted ──complete(+workoutSessionId)──→ completed
        └─respond decline──→ declined   (declined → re-assign allowed)
accepted|completed ──feedback──→ TrainerWorkoutFeedback rows
```

- `respond` maps `accept`→`accepted`, `decline`→`declined`, sets `respondedAt`; only from `assigned`.
- `feedback` allowed on `accepted`|`completed`; `rating` 1–5 and/or `note` required; optional `workoutSessionId` must reference the client's own session.
- `complete` requires `accepted` + caller-owned `workoutSessionId` → sets `WorkoutSession.planAssignmentId` then `status:'completed'`. 403 if session belongs to another user.
- No `archived` transition is reachable via API today (status exists in schema comments).

## 2. Schema

| Model | Key fields | Notes |
|---|---|---|
| `WorkoutPlan` | `status draft\|published\|archived` (default `published` — legacy rows), `version`, `supersedesId` self-FK, `goal`, `difficulty beginner\|intermediate\|advanced`, `durationWeeks 1–52`, `daysPerWeek 1–7`, `startAt/endAt`, `clientId?` (legacy per-client plans) | also still serves legacy `/workout-plans` flat system |
| `TrainerWorkoutDay` | `@@unique(planId,dayIndex)` (0..daysPerWeek−1), `label`, `warmup`, `cooldown`, `notes` | daysPerWeek null → index max 6 |
| `TrainerWorkoutExercise` | `exerciseName*`, `exerciseId?` (must resolve in Exercise catalog → 400), `sets 1–100*`, `reps\|repsText` (one required), `targetWeight`, `weightGuidance`, `restSeconds`, `tempo`, `progression`, `order` | FK-less `exerciseId` — validated at write |
| `TrainerWorkoutAssignment` | `status`, `assignedAt`, `respondedAt` | **no unique constraint** — open-status `findFirst` dedupes |
| `TrainerWorkoutFeedback` | `rating 1–5`, `note`, `workoutSessionId?` | multiple rows per assignment |
| `WorkoutSession.planAssignmentId` | nullable, indexed | the prescribed-vs-actual link |
| `WorkoutPlanExercise` | legacy flat list | still used by old routes; new system never writes it |

## 3. API

Trainer router `/trainer/workout-plans` — `requireFeature` then `requireRole('TRAINER')`; approved-trainer + relation checks inside service:

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/trainer/workout-plans` | `{title*, description?, goal?, difficulty?, durationWeeks?, daysPerWeek?, startAt?, endAt?, days?[]}` | 201 plan + days/exercises |
| PATCH | `/trainer/workout-plans/:id` | partial scalars and/or `days[]` | plan |
| POST | `/trainer/workout-plans/:id/publish` | — | plan |
| POST | `/trainer/workout-plans/:id/revise` | — | 201 new draft (version+1) |
| POST | `/trainer/workout-plans/:id/assign` | `{clientId*}` | 201 assignment |
| GET | `/trainer/workout-plans` | `?status=&take=1..100&cursor=` | `{plans(+_counts), nextCursor}` |
| GET | `/trainer/workout-plans/:id` | — | plan + days + assignments |
| GET | `/trainer/workout-plans/:id/progress` | — | `{planId, plannedSessions, assignments:[{status, completedSessions, workoutRecordsConsent, sessions}]}` |

Client router `/me/workout-plans` — `requireFeature` + `identifyUser`:

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/me/workout-plans` | `?take=&cursor=` | `{assignments(+plan summary), nextCursor}` — own rows only |
| GET | `/me/workout-plans/:assignmentId` | — | assignment + plan(+trainer display) + feedback + linked `sessions` |
| POST | `/me/workout-plans/:assignmentId/respond` | `{action: accept\|decline}` | assignment |
| POST | `/me/workout-plans/:assignmentId/feedback` | `{rating?, note?, workoutSessionId?}` | 201 feedback |
| POST | `/me/workout-plans/:assignmentId/complete` | `{workoutSessionId*}` | assignment `completed` |

Errors: 400 validation · 403 flag-off/unapproved/foreign session · 404 non-owned plan/assignment (ownership hidden as 404) · 409 wrong-state.

## 4. Consent gating

`GET /trainer/workout-plans/:id/progress`: per assignment, `workoutRecordsConsent` is computed via `hasConsent(relation,'workout_records')` — the **session list is `[]` unless granted**, while assignment metadata (status, counts) stays visible. Client-side plan/assignment reads require no consent (it's their own data).

## 5. `WorkoutSession.planAssignmentId` — prescribed vs actual

`completeAssignment` is the **only** writer: sets the nullable link on a session verified to belong to the caller. `getForClient`/`progressForPlan` read sessions via `where: { planAssignmentId }`.

**"Never overwrites client logs" guarantee:** no code path writes `ExerciseSet`, `FoodLog`, or session contents — only the link column. The client's manually logged session keeps its own rows; the plan merely references it. Declined assignments block `complete` (409) but don't prevent re-assignment later.

## 6. Notes / limits

- `Notification` is the shared inbox model (type `trainer.plan_assigned`) — no push send on assign today.
- Pagination: `take` 1–100 default 50, cursor = last row id (`id desc/asc` by list).
- `active` boolean on WorkoutPlan is kept in sync with publish/revise but is not otherwise meaningful.
- Validation caps: title 200, description 2000, daysPerWeek ≤7, dayIndex ≤6, sets ≤100.
