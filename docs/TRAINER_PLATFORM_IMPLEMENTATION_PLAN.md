# Trainer Platform — Implementation Plan

Follows the milestone order from the spec. Each milestone ends with tests + doc updates. Companion audit: `TRAINER_PLATFORM_ARCHITECTURE_AUDIT.md` (findings F1–F12 referenced below).

## Cross-cutting decisions

1. **Consent is the load-bearing change.** `TrainerClientConsent` gates every client-data read. Existing active relations are backfilled `granted` (policyVersion `v0-legacy`) so nothing breaks; new relations start `pending` → client grants per category.
2. **Subscribe → Request.** `POST /trainers/:id/subscribe` keeps its name/mobile contract but creates `status:'pending'`; new `POST /trainer-requests/:id/accept|decline` activates. Admin `assign` still creates `active` directly.
3. **Names come from `User`.** `firstName/lastName` (fallback `profileData.displayName`) — no new name field on TrainerProfile; `displayName` column added for trainer-chosen public name.
4. **Application status** replaces bare `verified`: `draft|submitted|under_review|approved|rejected|changes_requested`. `verified` stays as the public "verified trainer" badge; admin verify endpoint extended to set statuses.
5. **No prod migration or prod seed without explicit approval.** Dev DB only until approved.
6. **Flags**: master `trainer_dashboard` + new `trainer_registration`, `trainer_discovery`, `trainer_coaching`, `trainer_insights` (each `dependsOn: trainer_dashboard`). PostHog keys = exact snake_case.

---

## M1 — UI modernization (mobile only, zero API change)

- Migrate all 7 trainer screens to `useTheme` + design-system components (kills blue fork, gets dark mode).
- New shared primitives in `src/components/`: `Chip`, `Avatar`, `StarRating` (dedupe), `Toggle` (lift from SmartReminders), `StatTile`.
- Become-a-Trainer: `Field` inputs, `Chip` specialty grid, `Segmented`-style tier cards, `Sheet` for structured-certification editor (deferred to M2 backend), Notice explaining unverified-by-default.
- Find-a-Trainer: `Segmented` tier filter, `Skeleton` loading, better EmptyState (clear-filters CTA).
- ClientProgress: adopt `BarChart` + metric-selector pattern from HistoryScreen (weight, workouts, nutrition, steps, sleep charts from data already returned).
- Fix F9 (`RolesContext.refresh()` after signup) + F10 (route ClientMealPlanScreen through `api/weeklyPlan.ts`).
- Tests: update trainer-screen tests for context mocks; add Chip/Toggle unit tests.
- Deliverable: `TRAINER_UI_VALIDATION.md` started.

## M2 — Data foundation (schema + seed + discovery backend)

- Migration (dev): TrainerProfile columns, `TrainerCertification`, `TrainerClientConsent`, specialty taxonomy config, `applicationStatus` backfill. → `TRAINER_DATABASE_DESIGN.md`
- Fix F1 (status check in getClientProgress) + F2 (verified/active filter on `/:id`) + F8 (batch client counts, remove N+1) + F3 (return `displayName`/`firstName` in list+detail+roster).
- Discovery params: `?q=`, `specialty=`, `tier=`, `mode=`, `language=`, `country=` + cursor pagination.
- `TrainerCertification` CRUD under `/trainers/me/certifications` (trainer-managed, `verificationStatus` always `unverified` on write — only admin can mark verified).
- Seed script `prisma/seed-trainers.js`: 10 synthetic trainers (4 standard/4 pro/2 elite), real `User` rows (`passwordHash salt:hash`, `emailVerifiedAt`), `UserRole(TRAINER)`, profiles, certifications, + 3 synthetic clients w/ workouts/food/weight/steps/sleep logs, idempotent via upsert on `email @unique`. Dev DB only. → `TRAINER_SEED_DATA.md`
- Tests: status-check negative tests (F1 regression), discovery filter tests, cert validation.

## M3 — Registration & approval workflow

- `applicationStatus` transitions: `POST /trainers/applications` (draft save) → `POST .../submit` → admin `PATCH /admin/trainers/:id/review {decision: approve|reject|request_changes, note}`. Self-approval impossible (MANAGE_TRAINERS only; verify endpoint already atomic).
- `GET /trainers/applications/me` — applicant sees status + admin note.
- Duplicate-active-application guard; resubmission allowed from `changes_requested`/`rejected`.
- Mobile: application-status card on Summary/Coaching section; draft resume.
- Audit events: `trainer.apply`, `trainer.submit`, `trainer.review.<decision>` (extend FIELDS).
- Tests: transition matrix, dup prevention, self-approval denial, audit rows.

## M4 — Relationships & consent

- `POST /trainers/:id/subscribe` → `pending` relation (+ proposed consent snapshot).
- `POST /trainer-requests/:id/accept|decline` (trainer); `POST /trainer-requests` (trainer invite → client accepts — `requestedBy` field decides who confirms).
- `PUT /trainer-relationships/:id/consents` (client only, per-category grant/revoke, tx w/ relation row, audit).
- `getClientProgress` + all client-data reads → consent-aware: return only granted categories (ungranted → category omitted, never error the whole response).
- `POST /trainer-relationships/:id/end` (either party; trainer keeps `clients/:id/drop` survey path).
- Mobile: consent sheet on first request + consent management screen (`Toggle` per category, revoke anytime); ClientsScreen pending-requests section; roster shows names.
- Tests: F1-suite — cross-trainer, pending trainer, revoked consent, ended relation, consent-bypass, client-approves-own-application. → `TRAINER_SECURITY_TEST_PLAN.md`
- Deliverable: `TRAINER_API_CONTRACTS.md`.

## M5 — Trainer dashboard & client detail

- `GET /trainer/dashboard` — aggregates (active clients, pending requests, recent activity) in ≤3 queries (fix N+1 pattern).
- ClientsScreen: names/avatars, last-activity snippet, pending section, search.
- Client detail screen: tabbed Overview/Workouts/Nutrition/Body/Activity/Notes — sections render only for granted categories, `BarChart` trends, missing-data states ("no logs this period" ≠ noncompliance).
- Trainer notes surface (CoachNote reuse) + `client_visible` toggle.
- Tests: dashboard aggregation, consent-filtered sections, missing-data rendering.

## M6 — Flags, security sweep, docs, rollout

- Registry: add 4 flags w/ `dependsOn: trainer_dashboard`; PostHog create (user); mobile `featureKeys.ts` sync.
- Split-route flag gates: `requireFeature('trainer_discovery')` on `GET /`, `/:id`; `trainer_registration` on signup/applications; `trainer_coaching` on requests/consents; `trainer_insights` on progress/dashboard routes.
- Full negative-test matrix run; regression: manual food/exercise logging untouched, AI flags unaffected.
- Docs: `TRAINER_SECURITY_TEST_PLAN.md`, `TRAINER_API_CONTRACTS.md`, `TRAINER_UI_VALIDATION.md`, `TRAINER_PLATFORM_ACCEPTANCE_REPORT.md` (executed tests only).
- Prod checklist: migration approval → apply → backfill → PostHog flags → Railway envs → staged rollout (registration+discovery first, coaching later).

## Deferred (documented, not built)

Messaging · scheduling/booking · payments/payouts · real credential verification (admin manual review only) · nutritionist-platform parity · AI coach-assist · waitlist activation.

## Risk notes

- **Backfill consent as granted** preserves current behavior — but spec requires explicit consent. Compromise: legacy relations get `v0-legacy` granted + one-time client notice prompt to review sharing (screen in M4).
- `pending` semantics change is breaking for existing pending rows — backfill marks them per `requestedBy`/age; flagged in migration doc.
- User-chosen `displayName` is public — needs profanity/PII-lite validation (same as firstName handling).
