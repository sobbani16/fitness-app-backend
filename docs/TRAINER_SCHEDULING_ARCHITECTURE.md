# Trainer Scheduling — Architecture

Date: 2026-10-31 · Verified against `src/services/schedulingService.js`, `src/routes/{trainerSchedule,myBookings}.js`, `prisma/schema.prisma` (models 2147–2219). Flag: `trainer_scheduling_enabled`. Tests: `tests/scheduling.test.js` (25).

## 1. Data model

| Model | Fields | Notes |
|---|---|---|
| `TrainerAvailability` | `trainerId` FK, `weekday 0–6` (0=Sun), `startMin`, `endMin` (minutes from local midnight), `timeZone` IANA, `effectiveFrom?`, `effectiveTo?` | **weekly windows stored as local wall-clock in the trainer's tz**, not UTC |
| `TrainerSessionType` | `name*` (≤128), `durationMin*` (5–480), `mode virtual\|in_person`, `meetingLink?` (≤512), `bufferMin` (0–240, def 0), `minNoticeMin` (0–10080, def 1440), `cancelWindowMin` (0–43200, def 1440), `active` | per-trainer |
| `TrainerSchedulingPreference` | `trainerId @unique`, `timeZone` (def `UTC`) | tz fallback: window tz → pref → `trainer.timeZone` → `'UTC'` |
| `TrainerBooking` | `relationId` FK, `sessionTypeId` FK, `startAtUtc`, `endAtUtc`, `status`, `requestedBy client\|trainer`, `meetingLink?`, `clientNote?` (≤1000), `trainerNote?` | **UTC instants only** |
| `TrainerBookingEvent` | `bookingId` FK, `actorId`, `action`, `fromStart?`, `toStart?`, `createdAt` | full history incl. reschedule chain |

`PUT /trainer/schedule/availability` is replace-all (≤100 windows/tx) inside `coachingTransaction`; session-type `DELETE` hard-deletes only while unreferenced — once bookings exist it deactivates (`active:false`) so history keeps its FK.

## 2. Booking state machine

```
requestBooking ──→ requested ──respond confirm──→ confirmed ──markCompleted(past)──→ completed
      │               │└─respond decline──→ declined          │
      │               └─reschedule──→ rescheduled ──respond──→ confirmed|declined
      └─ cancel ──────┴──────────────┴────canceled (requested|confirmed|rescheduled)
```

| Rule | Detail |
|---|---|
| Requester | either participant of an **active** relation (`requestedBy` derived server-side) |
| `respond` | trainer only; valid from `requested` **or `rescheduled`** (reschedule = pending re-confirmation) |
| `cancel` | either participant; client cancel of `confirmed`/`rescheduled` must be ≥`cancelWindowMin` before start → 409 `CANCEL_WINDOW`; `requested` withdrawable anytime; trainer cancel unwindowed |
| `reschedule` | either participant; re-checks overlap excluding self; status → `rescheduled` awaiting `respond` |
| `markCompleted` | trainer only; `confirmed` + `endAtUtc` past |
| Notifications | `trainer.booking_requested|responded|canceled|rescheduled|completed` inbox rows to the other party |
| Audit | `booking.<action>` rows inside the tx |

## 3. Slot computation (`computeSlots`, pure)

Input: `{availability, bookings(blocking), sessionType, fromUtc, toUtc, nowUtc}` → sorted `Date[]` starts.

Algorithm:
1. `notBefore = max(fromUtc, now + minNoticeMin)`.
2. For each window: resolve its tz; iterate **local calendar days** intersecting `[from−36h, to+36h]` (padding so days whose UTC span clips the range still generate).
3. Keep days matching `weekday`; convert the day's `startMin`/`endMin` wall-clock to UTC via `zonedTimeToUtcMs`.
4. Step candidate starts by `durationMin`; drop if `t < notBefore`, `t ≥ toUtc`, outside `effectiveFrom/To`.
5. Drop when `[t − buffer, t + duration + buffer]` overlaps any blocking booking (`bufferMin` applies on **both** sides of existing bookings).
6. Dedupe via `Set`, sort, return.

`GET /me/available-slots?trainerId&from&to&sessionTypeId` caps range at 93 days; access = the trainer or a client with an active relation. Blocking statuses for both slots and double-book: `requested | confirmed | rescheduled`.

## 4. Time-zone handling (no tz library — `Intl` only)

| Helper | Behavior |
|---|---|
| `isValidTimeZone` | `Intl.DateTimeFormat` probe |
| `partsInZone` / `localDateParts` | wall-clock fields + weekday of an instant in a zone |
| `tzOffsetMs` | zone-minus-UTC offset **at a given instant** |
| `zonedTimeToUtcMs(tz, y, m, d, minuteOfDay)` | wall-clock → UTC with **double refinement**: guess offset at naive interpretation, then recompute the offset at the refined instant. Fall-back folds pick the earlier occurrence; spring-forward gaps resolve to the pre-transition offset |

**Verified DST example** (from tests): `America/New_York` Monday 09:00 — Oct 27 2025 (EDT, UTC−4) → `13:00Z`; Nov 3 2025 (EST, UTC−5) → `14:00Z`. `computeSlots` over the Nov 2 transition yields `14:00/15:00/16:00Z` and explicitly does **not** contain `13:00Z`.

## 5. Double-booking prevention

Inside `coachingTransaction` (Serializable, ≤3 P2034 retries → 409 with `code` on exhaustion): re-verify relation `active`, then `findFirst` overlapping blocking booking with buffer — clash → **409 `SLOT_TAKEN`**. Same re-check on `reschedule` (excluding the booking itself). No DB exclusion constraint — serialization is the mechanism. `MIN_NOTICE` (400) is checked pre-tx against `start < now + minNoticeMin`.

## 6. Endpoints

`/trainer/schedule` (`requireFeature` + `requireRole('TRAINER')` + service `requireApprovedTrainer`):

| Method | Path | Request | Response |
|---|---|---|---|
| PUT | `/availability` | `{windows:[{weekday,startMin,endMin,timeZone?,effectiveFrom?,effectiveTo?}], timeZone?}` | `{availability:[…]}` replace-all |
| GET | `/availability` | — | `{timeZone, windows}` |
| POST | `/session-types` | `{name*, durationMin*, …}` | 201 row |
| GET | `/session-types` | — | `{sessionTypes}` incl. inactive |
| PATCH | `/session-types/:id` | partial | row |
| DELETE | `/session-types/:id` | — | `{deleted}` or `{deactivated, sessionType}` |
| GET | `/bookings` | `?status=&from=` | `{bookings}` asc, ≤200 |
| POST | `/bookings/:id/respond` | `{action: confirm\|decline}` | booking |
| POST | `/bookings/:id/cancel` | — | booking |
| POST | `/bookings/:id/reschedule` | `{startAtUtc}` | booking `rescheduled` |
| POST | `/bookings/:id/complete` | — | booking `completed` |

`/me` (`requireFeature` + `identifyUser`; relation-participation in service):

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/me/bookings` | `{relationId*, sessionTypeId*, startAtUtc*, clientNote?}` | 201 booking `requested` |
| GET | `/me/bookings` | — | `{bookings}` desc, ≤100 |
| POST | `/me/bookings/:id/cancel` `/reschedule` | `{startAtUtc}` | booking |
| GET | `/me/available-slots` | `?trainerId&from&to&sessionTypeId` | `{slots:[ISO]}` |

Errors: 400 validation/`MIN_NOTICE`/bad tz · 403 non-participant/inactive-relation/flag · 404 booking/session/trainer · **409 `SLOT_TAKEN`, `CANCEL_WINDOW`, wrong-state, P2034**.

## 7. Notes / limits

- Listings take caps (100/200) — no cursor pagination on bookings.
- `requestedBy:'trainer'` bookings also require trainer-side `respond` (same confirmation flow — a trainer request still goes through `requested` → trainer `confirm`; the field is provenance).
- Booking reminders via push are **not** implemented (no scheduled worker consumes bookings).
- `meetingLink` copies from session type at request time (snapshot, not live).
