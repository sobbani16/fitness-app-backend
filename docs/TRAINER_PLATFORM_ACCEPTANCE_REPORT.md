# Trainer Platform — Acceptance Report (Base)

Date: 2026-10-31 · Scope: audit findings F1–F12 + implementation-plan milestones M1–M6. Advanced modules reported separately in `ADVANCED_TRAINER_ACCEPTANCE_REPORT.md`.

## Test evidence (executed)

`npx jest tests/trainerPlatform.test.js --runInBand` → **27 tests, 27 passed** (fully mocked Prisma; no DB). Whole-repo suite: 68 test files via `npx jest --listTests`, of which 6 are trainer-related (incl. advanced). No claim is made for tests not present in `tests/*.test.js`.

## F1–F12 status

| # | Finding | Status | Evidence |
|---|---|---|---|
| F1 | Progress readable on dropped/paused relation | ✅ fixed | `trainerService.getClientProgress` requires `status:'active'` (line 541); tests: dropped/paused/pending → 403 |
| F2 | Unverified profile fetchable by id | ✅ fixed | `getTrainerById` applies `DISCOVERABLE_WHERE`; test → 404 |
| F3 | Raw userId as display name | ✅ fixed | `loadDisplayNames` + `publicTrainerName` (`displayName || "First Last" || 'Trainer'`); list/detail/roster/requests all name-mapped; tested |
| F4 | No consent model | ✅ built | `TrainerClientConsent` (8 categories) + consent-gated reads; **mobile consent UI deferred** |
| F5 | Instant subscribe | ✅ reworked | subscribe → `pending` + pending consents; accept/decline endpoints; tested |
| F6 | Dead fields | ⚠️ partial | `maxClients` now live (capacity checks); `hourlyRate` still no writer; `MacroGoal.source='trainer'` still no writer (nutrition module logs `FoodLog`, not goals); `TrainerWaitlist` still unwired |
| F7 | Scalars without FK | ✅ documented | intentional — `accountData.js` ownership registry is the delete contract (TRAINER_DATABASE_DESIGN.md §7) |
| F8 | N+1 client counts | ✅ fixed | `groupBy` batch in `listTrainers`; tested |
| F9 | RolesContext fetch-once | ✅ fixed (mobile) | `refresh()` after signup |
| F10 | Raw axios weekly-plan calls | ✅ fixed (mobile) | `ClientMealPlanScreen` uses `api/weeklyPlan.ts` |
| F11 | Nutritionist parity | ➖ out of scope (confirmed) |
| F12 | Audit FIELDS stripped | ✅ fixed | `auditService.js` FIELDS includes `applicationStatus, relationId, category, planId, assignmentId, bookingId, packageId, purchaseId, decision, version, sessionTypeId, startAtUtc, endAtUtc, amountCents, currency, rating` |

## Milestone status

| Milestone | Shipped | Deferred |
|---|---|---|
| M1 UI modernization | 8/8 screens on design system; 5 new primitives; F9/F10 | device-render verification; dark-mode eyeballing |
| M2 data foundation | schema + `config/specialties.js` taxonomy + discovery params + certs CRUD + `seed-trainers.js` + backfill script | — |
| M3 registration & approval | draft/submit/review machine; admin review endpoint w/ atomic role+session revoke; audit events | — |
| M4 relationships & consent | pending relation model, invite/accept/decline, consent GET/PUT, end-relationship, consent-gated progress | **mobile consent sheet + management screen + pending-requests UI (API client exists, zero screen consumers)** |
| M5 dashboard & client detail | consent-filtered progress endpoint + roster w/ names | `GET /trainer/dashboard` aggregate endpoint **not built** (registry lists it as gated endpoint — the route does not exist); mobile client-detail tabs not built |
| M6 flags/security/docs | 4 surface flags w/ `dependsOn`; this report + companion docs | PostHog flag creation + prod migration are operational steps, not code |

## Known decisions (deviations from spec, intentional)

| Decision | Detail |
|---|---|
| Decline → `dropped` + `dropReason` | declined/cancelled requests store `status:'dropped'` with plain-string `dropReason` (`'declined'`\|`'cancelled'`); survey drops store JSON `{reasons,notes}` — consumers must handle both |
| Consents stay `pending` post-accept | accept activates the relation but does NOT auto-grant categories; client grants explicitly afterwards (progress returns no sections until then) |
| Mutual-intent auto-accept | invite on an existing client-request activates immediately (and subscribe on a trainer-invite does the same) — no second confirmation needed since both parties already signaled intent |
| Capacity counts | `pending`+`active` count toward `maxClients` at request creation; `active`-only at accept time |
| `paused` ≠ active | paused relations lose all data access (403) but remain roster-visible |
| `body_measurements`, `food_logs` | declared categories with no base-platform query section yet (`food_logs` is consumed by nutrition allergy checks + summary in the advanced module) |
| Re-request semantics | dropped/completed rows are upserted back to `pending` (one relation row per pair, ever) |
| Lock rule kept | 423 `TRAINER_LOCKED` until first-of-next-month on subscribe/drop paths |

## Deferred items (carried to advanced scope)

`trainer_workout_plans_enabled`-gated plan system, nutrition guidance, messaging, scheduling, payments — see advanced report. Waitlist activation, real credential verification, AI assist flags (registered but dormant).
