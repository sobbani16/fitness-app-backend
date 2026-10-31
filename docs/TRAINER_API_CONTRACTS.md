# Trainer Platform — Base API Contracts

Date: 2026-10-31 · Verified against `src/routes/{trainers,trainerRequests,admin}.js` + `src/services/{trainerService,trainerApplications,trainerRelations,trainerAccess}.js` and `src/routes/index.js` mounts. Advanced-module endpoints live in `ADVANCED_TRAINER_API_CONTRACTS.md`.

## Conventions

| Item | Behavior |
|---|---|
| Auth | `identifyUser`/`requireRole`/`requirePermission` read session-derived `x-user-id` (AUTH_TEST_BYPASS in tests); no `?userId=` trust anywhere |
| Flag gate | `requireFeature('<flag>')` runs **before** role checks → `403 { error: { code:'FEATURE_DISABLED', message:'This feature is temporarily unavailable.' } }` |
| `/trainers` router | `router.use(requireFeature('trainer_dashboard'))` — master gate on every path below |
| `/trainer-requests` + `/trainer-relationships` | **same router mounted twice**; `requireFeature('trainer_coaching')` + `identifyUser` on all paths |
| Errors | `{ error: string }`; validation 400, authz 403, not-found 404, state conflicts 409, lock 423 |
| Audit | every mutating route writes an audit row inside `coachingTransaction` (Serializable tx, ≤3 P2034 retries) |

## Discovery (`trainer_discovery`)

| Method | Path | Checks | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/trainers` | flag | `?q=&tier=&specialty=&mode=&language=&country=&cursor=&take=` (take ≤50, default 20) | `{trainers:[profile + displayName + currentClients + spotsLeft], nextCursor}` — only `verified&&active&&applicationStatus='approved'&&isDiscoverable` | 400 invalid `mode`; 403 flag |
| GET | `/trainers/:id` | flag | — | trainer profile + `certificationsV2[]`, `displayName`, `currentClients`, `spotsLeft` | 404 when not approved/discoverable (F2) |
| GET | `/trainers/drop-reasons` | master flag only | — | `{trainerReasons:[6], clientReasons:[6]}` | 403 flag |

`q` matches `displayName`/`location` (insensitive). `specialty` resolves id-or-label → id filter (`hasSome` incl. legacy label values). `mode=online|in_person` matches `both` too; `mode=both` requires `both`.

## Registration (`trainer_registration`)

| Method | Path | Checks | Request | Response | Errors |
|---|---|---|---|---|---|
| POST | `/trainers/signup` | flag + auth | profile fields (allowlist) | 201 profile — `verified:false, active:false, applicationStatus:'submitted'` | 409 profile exists; 400 invalid specialty/mode |
| POST | `/trainers/applications` | flag + auth | same allowlist | 201 profile — draft saved/overwritten; 409 if `submitted`/`under_review`/`approved` | 400, 409 |
| GET | `/trainers/applications/me` | flag + auth | — | `{id, applicationStatus, applicationNote, approvedAt, …profile fields}` | 404 none |
| PATCH | `/trainers/applications/me` | flag + auth | field patch | updated profile; editable only in `draft`/`changes_requested` | 404, 409 |
| POST | `/trainers/applications/me/submit` | flag + auth | — | profile `→ submitted`; requires bio, yearsExperience ≥0, ≥1 specialty | 400 missing fields, 409 wrong state |

Certifications (master flag + auth only — no separate flag):

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/trainers/me/certifications` | — | `{certifications:[]}` | 404 no profile |
| POST | `/trainers/me/certifications` | `{name*, issuingOrganization, credentialId, issuedAt, expiresAt}` | 201 row — `verificationStatus` forced `'unverified'` | 400 |
| PATCH | `/trainers/me/certifications/:certId` | partial | updated row — any edit resets `unverified`, clears verifiedAt/By | 404 not own |
| DELETE | `/trainers/me/certifications/:certId` | — | `{ok:true}` | 404 |

## Trainer-side client management (master flag + `requireRole('TRAINER')`)

| Method | Path | Extra checks | Request | Response | Errors |
|---|---|---|---|---|---|
| PATCH | `/trainers/me/profile` | role | profile allowlist | updated profile | 400 |
| GET | `/trainers/me/clients` | role | — | `{clients:[relation + clientName + grantedCategories + daysWithTrainer]}` — all statuses except dropped | 404 no profile |
| GET | `/trainers/clients/:clientId/progress` | `trainer_insights` + role + approved + **active relation** | `?period=daily|weekly|monthly|6months|all&from=` | `{period, rangeStart, rangeEnd, engagementStart, daysWithTrainer, grantedCategories}` + only-granted sections: `weight`, `macroScores`, `workoutSessions`, `healthScores`, `steps`, `sleep` | 403 unapproved/no-active-relation (F1) |
| POST | `/trainers/clients/:clientId/drop` | role | `{reasons[]*, notes, candidateGoals, adherenceRating}` | `{relation(dropped), dropForm}` | 400 no reasons |
| PATCH | `/trainers/clients/:clientId/status` | role | `{status: pending|active|paused|completed}` | updated relation | 400 |
| POST | `/trainers/clients/assign` | `MANAGE_TRAINERS` | `{trainerId*, clientId*}` | 201 relation `active` + lockedUntil | 400 |

## Client-facing (master flag)

| Method | Path | Flag | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/trainers/me/assigned` | master | — | `{assigned: relation + trainer(+displayName, spotsLeft)}` or `null` | — |
| POST | `/trainers/:id/subscribe` | `trainer_coaching` | — | 201 relation — **`status:'pending'`** + 8 pending consent rows; idempotent re-request; mutual-intent → `active` | 423 `TRAINER_LOCKED` `{lockedUntil,daysRemaining,currentTrainerId}`; 409 already subscribed / pending elsewhere / at capacity; 400 unavailable |
| POST | `/trainers/me/drop` | master | `{reasons[]*, notes, trainerRating}` | `{relation(dropped), dropForm}`; `trainerRating` re-aggregates `rating` | 423 lock; 400 |

## Requests & relationships (`trainer_coaching`; same router at `/trainer-requests` and `/trainer-relationships`)

| Method | Path | Checks | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/` | approved trainer (or `?mine=1` client) | `?mine=1` | `{requests:[pending relations + consents + clientName/trainer.displayName]}` | 403 |
| POST | `/invite` | approved trainer | `{clientId*}` | 201 relation `pending(requestedBy:'trainer')`; existing client-request → auto-accept to `active` | 400 self-invite; 409 active/conflict/at-capacity |
| POST | `/:id/accept` | **non-requesting party** + pending | — | relation `active` + `lockedUntil`; Notification to requester | 403 requester/non-participant; 409 not-pending/at-capacity |
| POST | `/:id/decline` | any participant + pending | — | relation `dropped` (`dropReason` `'declined'` or `'cancelled'`); pending consents → revoked | 403 non-participant; 409 |
| GET | `/:id/consents` | relation participant | — | `{relationId, relationStatus, consents:[{category,status,grantedAt,revokedAt,policyVersion} ×8]}` | 403/404 |
| PUT | `/:id/consents` | **client only**; relation `pending`/`active` | `{grants:[], revokes:[]}` | full consent map; grants set `grantedAt`, revokes set `revokedAt` (immediate server-side) | 400 unknown/both-listed category; 403 trainer; 409 ended |
| POST | `/:id/end` | any participant | — | relation `dropped`, all consents → `revoked` | 403; 409 already ended |

## Admin (`/admin`, `MANAGE_TRAINERS` unless noted)

| Method | Path | Permission | Request | Response |
|---|---|---|---|---|
| GET | `/admin/trainers` | MANAGE_TRAINERS | `?applicationStatus=` | `{trainers:[profiles desc createdAt]}` |
| PATCH | `/admin/trainers/:id/verify` | MANAGE_TRAINERS | `{verified: bool}` | profile; atomic verify+role+session revoke+audit (`trainer.verify`) |
| PATCH | `/admin/trainers/:id/review` | MANAGE_TRAINERS | `{decision: approve|reject|request_changes, note?}` | profile; approve = verify path + `approved` fields; reject/request_changes = un-verify + deactivate + role off + session revoke (`trainer.review.<decision>`) |
| GET | `/admin/users` | MANAGE_USERS | — | `{users:[{userId, roles[]}]}` |
| POST | `/admin/roles/assign` `/admin/roles/remove` | MANAGE_ROLES | `{userId, roleName}` | role change + session revoke |
| GET | `/admin/analytics` | VIEW_PLATFORM_ANALYTICS | — | counts |

## Error-code quick map

| Code | Meaning | Seen on |
|---|---|---|
| `FEATURE_DISABLED` (403 body `{error:{code}}`) | surface flag or `dependsOn` parent off | every flagged route |
| `TRAINER_LOCKED` (423) | inside monthly lock window | subscribe, /me/drop |
| 409 | state-machine conflicts (not pending, at capacity, duplicate application/assignment, already dropped) | requests, applications, assign |
| 403 | unapproved trainer, non-participant, wrong party, non-active relation, client-only consent write | all service-level checks |
| 404 | hidden-by-design (unapproved profile on `GET /trainers/:id`, non-owned rows) | discovery, certs |

## Known contract notes

- Registry lists `GET /trainer/dashboard` under `trainer_insights` endpoints — **no such route exists**; dashboard aggregation from the plan was not built (roster + progress endpoints cover it).
- `GET /trainers/drop-reasons`, `/me/certifications`, `/me/profile`, `/me/clients`, `/me/drop`, `/me/assigned` sit behind the master flag only — no per-surface flag.
- Response bodies use flat `{ error }` on service errors but `{ error: { code, message } }` on flag rejection — clients must read both shapes.
