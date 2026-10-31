# Trainer Platform — Architecture Audit

Date: 2026-10-31 · Repos: `fitness-app-backend` (Express 4 + Prisma 6 + PostgreSQL) · `fitness-app-mobile` (RN 0.81.5 / Expo 54)

## Verdict

A functional trainer MVP already exists — profiles, tiers, client subscribe/drop with a 30-day lock, roster, per-client progress view, workout/meal plans, coach notes, drop surveys, admin verify. The spec's job is **modernization, authorization hardening, consent, and workflow states** — not building from zero. The audit found 2 security bugs, several dead schema fields, a hard name-leak, and a visual fork from the design system.

---

## 1. What exists today

### Data model (prisma/schema.prisma)

| Model | Status |
|---|---|
| `TrainerProfile` | ✅ tier (standard/pro/elite), verified, active, bio, `certifications String[]` (flat strings), `specialties String[]`, yearsExperience, location, rating/ratingCount, profilePicture, hourlyRate (**dead — no API writes it**), maxClients (**dead**) |
| `TrainerClient` | ✅ status pending/active/paused/completed/dropped, `lockedUntil`, drop fields, `@@unique(trainerId,clientId)` — **`clientId` is a scalar, no FK to User** |
| `TrainerDropForm` | ✅ structured drop reasons, adherence rating, trainer rating |
| `CoachNote` | ✅ private/client_visible visibility, trainer+nutritionist |
| `WorkoutPlan` + `WorkoutPlanExercise` | ✅ trainer-authored plans |
| `MealPlan` + `MealPlanItem` | ✅ nutritionist track (parallel, much thinner — no signup/subscribe/drop) |
| `TrainerWaitlist` | ⚠️ stub, never wired |
| `TrainerCertification` | ❌ does not exist — certs are `String[]` |
| `TrainerClientConsent` | ❌ does not exist — **no consent model anywhere** |
| `applicationStatus` / `isDiscoverable` | ❌ verification doubles as approval + discoverability |
| Specialty taxonomy | ❌ free-text `String[]`, display labels as identifiers |

### API surface (`/trainers`, behind `trainer_dashboard` flag)

signup · PATCH me/profile · GET me/clients · GET clients/:id/progress · POST clients/:id/drop · PATCH clients/:id/status · POST clients/assign (admin) · GET me/assigned · POST :id/subscribe · POST me/drop · GET /:id · GET / · GET /drop-reasons · `/coach-notes` · `/workout-plans` · `/meal-plans` · admin `PATCH /admin/trainers/:id/verify` (atomic: verify + TRAINER role + session revoke + audit)

### Mobile

7 screens exist (Signup, List, Detail, Clients roster, ClientProgress, ClientMealPlan, TrainerDropForm, ClientDropSurvey) — **all 7 bypass the design system**: hardcoded blue `#1e6fb8` vs theme `#137C63`, local StyleSheets, no dark mode, re-implemented chips/stars/toggles. `api/trainers.ts` is complete; `updateTrainerProfile` is dead client-side.

---

## 2. Findings that MUST be fixed (security / correctness)

| # | Finding | Severity |
|---|---|---|
| F1 | `getClientProgress` checks only that a `TrainerClient` row **exists** — status never checked. **Dropped/paused/completed trainers retain full progress access.** (`trainerService.js:320`) | 🔴 revoked-access violation |
| F2 | `GET /trainers/:id` → `getTrainerById` has no verified/active filter — unverified/inactive profiles fetchable by ID | 🟠 info leak |
| F3 | `TrainerListScreen` renders `trainer.userId` as the name; `ClientsScreen` renders `clientId`. Backend returns no display name → **raw user IDs in UI** | 🟠 PII-ish leak |
| F4 | No consent model: subscribing instantly shares 6 data categories (weight, macro scores, workouts, health scores, steps, sleep) with no per-category grant. `VIEW_CLIENT_HEALTH` permission literally says "(with consent)" — unimplemented | 🔴 spec non-negotiable |
| F5 | Subscribe = instant `active` + lock. Spec wants request → trainer accept/decline. Behavioral change required | design |
| F6 | `hourlyRate`, `maxClients`, `rating` have no API writer; `MacroGoal.source='trainer'` has no route; `TrainerWaitlist` unwired | dead surface |
| F7 | `TrainerClient.clientId`, `CoachNote.clientId`, `UserRole.userId` are scalars without FK — rely on `accountData.js` registry for deletion | referential |
| F8 | N+1 `trainerClient.count` per trainer in `listTrainers` | perf |
| F9 | RolesContext fetches once on mount — newly-approved trainer sees no Clients tab until restart | UX bug |
| F10 | `ClientMealPlanScreen` raw-axios calls `/weekly-plan/*`, bypassing `api/weeklyPlan.ts` | hygiene |
| F11 | NutritionistClient assign pending-vs-active inconsistency; no nutritionist verify endpoint | parity gap (out of scope unless requested) |
| F12 | New audit fields must be added to `auditService.js` `FIELDS` allowlist or silently stripped | operational |

---

## 3. Spec → existing mapping

| Spec requirement | Exists? | Action |
|---|---|---|
| Draft→Submitted→Review→Approved/Rejected/Changes | ❌ (binary verified) | add `applicationStatus` + transitions + audit |
| Structured certifications w/ verification status | ❌ (String[]) | new `TrainerCertification` table; keep String[] for backfill |
| Stable specialty IDs | ⚠️ display labels | registry `SPECIALTY_TAXONOMY` (backend `config/`), migrate stored values |
| Tier assignment by platform rules | ⚠️ self-selected at signup | keep field, mark `tierSource: self_declared|admin_assigned`; admin can change |
| Discovery search/specialty/language/online filters | ⚠️ tier only | add query params + `languages`, `coachingMode`, `country`, `timeZone` columns |
| Trainer names/photos in cards | ❌ userId leaked | join `User.firstName/lastName` or `profileData.displayName` |
| Request → accept/decline flow | ❌ instant subscribe | rework: `pending` until trainer accepts; invitations = trainer-initiated pending |
| Per-category consent | ❌ | new `TrainerClientConsent` + consent-gated progress queries |
| Trainer dashboard w/ charts | ⚠️ sections only, zero charts | reuse `BarChart`/`Progress` + `chartPoints` pattern from HistoryScreen |
| Client detail tabs (workouts/nutrition/body/recovery/notes) | ⚠️ one flat screen | reorganize + add consent-aware sections |
| Trainer notes | ✅ CoachNote exists | reuse; verify relationship-scoping |
| 10 seeded fictional trainers | ❌ | dev-only idempotent seed (Users + Profiles + Roles + relations + logs) |
| Consent revocation blocks access | ❌ | F1 fix + consent check in service layer |
| Feature flags per surface | ⚠️ one flag (`trainer_dashboard`) | add granular flags (see §5) |
| Admin approval controls | ✅ `PATCH /admin/trainers/:id/verify` | extend: status transitions + changes-requested + reject |

---

## 4. Authorization model (proposed)

Every trainer data endpoint must pass, in order:

1. `authenticate` (exists) → session-derived `req.userId`
2. `requireFeature(<surface flag>)` (exists)
3. `requireRole('TRAINER')` (exists) **and** `TrainerProfile.verified && active && applicationStatus='approved'`
4. `TrainerClient` row exists **AND `status='active'`** — fixes F1
5. `TrainerClientConsent` row: `category ∈ requested categories AND status='granted'`
6. Trainer notes/plans scoped to `coachId`/`trainerId` of caller — already done in coachNotes/workoutPlans

Consent semantics: subscribing creates `pending` relation + proposed consent set; relationship activates on trainer accept; consent is **granted by client explicitly per category** (default all-off → client sees consent sheet on first request and can edit anytime); `revoked` writes `revokedAt`, takes effect immediately server-side regardless of cached UI.

---

## 5. Feature flags (registry additions)

Existing `trainer_dashboard` stays as the master gate. Proposed additions (PostHog keys, snake_case):

| Key | Default | Gates |
|---|---|---|
| `trainer_dashboard` | off (exists) | `/trainers` router + all trainer screens |
| `trainer_registration` | off | `/trainers/signup`, `/applications/*`, Become-a-Trainer UI |
| `trainer_discovery` | off | `GET /trainers`, `GET /trainers/:id`, Find-a-Trainer UI |
| `trainer_coaching` | off | requests/relationships/consent endpoints + CTAs |
| `trainer_insights` | off | progress/dashboard read endpoints + client detail UI |

`trainer_dashboard` is the parent; the others `dependsOn: trainer_dashboard`? — **no**: registration/discovery must be usable while dashboard is off? Spec: global disable must work. Proposal: `trainer_dashboard` remains the global kill; surface flags each depend on it via registry `dependsOn`. None join the AI kill group.

## 6. Migration plan (needs approval before any prod apply)

1. `TrainerProfile`: +`applicationStatus String @default("draft")`, `displayName`, `country`, `timeZone`, `languages String[]`, `coachingMode String @default("both")` (online|in_person|both), `website`, `philosophy`, `isDiscoverable Boolean @default(true)`
2. New `TrainerCertification(id, trainerId FK, name, issuingOrganization, credentialId, issuedAt, expiresAt, verificationStatus @default("unverified"), verifiedAt, verifiedBy)`
3. New `TrainerClientConsent(id, relationId FK→TrainerClient, category, status @default("pending"), grantedAt, revokedAt, policyVersion, @@unique(relationId, category))`
4. `TrainerClient.status` values extend: keep existing + semantics documented (`pending` now means "awaiting trainer accept", not auto-active)
5. Backfill: existing `verified=true` → `applicationStatus='approved'`; existing String[] certs → `TrainerCertification` rows `verificationStatus='legacy'`; existing active relations → consent rows `status='granted', policyVersion='v0-legacy'` (preserves current behavior; clients can revoke)

Non-destructive: additive columns + new tables + backfill only.

## 7. Reuse map

- Design system: `Card Copy Action Field Notice Skeleton Sheet BarChart Segmented IconAction ListRow Progress` — need new primitives: `Chip`, `Avatar`, `StarRating` (dedupe 2 impls), `Toggle` (lift from SmartReminders), `StatTile`
- Consent UX: SmartReminders `Toggle` + `PermissionDeniedState` + consent-copy pattern
- Charts: `BarChart` + `services/progress.chartPoints` (HistoryScreen metric-selector pattern)
- Backend: `coachingTransaction` (Serializable tx + audit), `auditService` (extend FIELDS), `identifyUser`/`requireRole`/`requireFeature`, `weeklyOwnership` relation-check pattern
- AuthZ fixtures: `tests/helpers/authz.js` for cross-user negative tests

## 8. Out of scope (confirmed or recommended)

- Compensation/payout math (spec defers) · Scheduling/booking (deferred) · Messaging (deferred) · Nutritionist parity fixes (recommend separate ticket) · Real certification verification (manual admin review only) · AI coach-assist (deferred; must follow flag rules if added)
