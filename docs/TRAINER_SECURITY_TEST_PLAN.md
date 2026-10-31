# Trainer Platform — Security Test Plan (Base)

Date: 2026-10-31 · Scope: base trainer platform (registration, discovery, relationships, consent, progress). Advanced-module negative tests live in `ADVANCED_TRAINER_SECURITY_TESTS.md`. All suites run Prisma fully mocked (no DB) under `tests/`.

## Threat → test mapping (executed)

| # | Threat | Test (file → case) | Status |
|---|---|---|---|
| T1 | **Revoked-access read (F1)** — dropped/paused/completed/pending trainer keeps reading client progress | `trainerPlatform.test.js` → "F1 — relation status required for progress": `dropped relation → 403`, `paused relation → 403; pending → 403` | ✅ executed |
| T2 | **Unapproved-trainer data access** — application pending/rejected but calling trainer APIs | same file → `unapproved trainer → 403 even with active relation`; `trainer pending list requires approved trainer` | ✅ executed |
| T3 | **Cross-trainer / cross-participant access** | `requester cannot self-accept; non-participant gets 403`; `trainer cannot write consents` (`client grants + revokes; trainer cannot write consents`) | ✅ executed |
| T4 | **Pending-consent read** — data returned before explicit client grant | `consent-filtered progress categories`: `only granted categories are returned`, `no consent rows → no data sections` | ✅ executed |
| T5 | **Consent-revoke bypass** — revoked category still served (incl. cached UI) | `revoked category disappears from progress` | ✅ executed |
| T6 | **Self-approve** — trainer approves own application or marks own cert verified | `trainer cannot self-approve (MANAGE_TRAINERS required)`; `create forces verificationStatus unverified even when body says verified` | ✅ executed |
| T7 | **Flag-off direct API** — surface disabled but route hit directly | `granular trainer flags`: discovery / registration / coaching off → 403 each; `trainer_dashboard master off → everything 403 (dependsOn children too)` | ✅ executed |
| T8 | **Identity leak** — raw userId rendered as a name (F3) | `list returns displayName (never raw userId as name)`; `detail returns displayName + certificationsV2` | ✅ executed |
| T9 | **Info leak via id (F2)** — unverified/inactive/non-discoverable profile fetchable | `non-approved / non-discoverable profile detail → 404` | ✅ executed |
| T10 | **Duplicate / replayed application** | `duplicate live application blocked; resubmit allowed from changes_requested` | ✅ executed |
| T11 | **Request-state abuse** — accept non-pending, end twice | `decline → dropped; trainer invite is client-accepted`; `end relationship → dropped + all consents revoked`; 409 paths asserted via mocked conflicts | ✅ executed |
| T12 | **Submit-validation bypass** — incomplete application submitted | `submit validates required fields` | ✅ executed |

## Positive-path coverage in the same suite (context)

`subscribe creates pending relation + pending consents, accept activates` · `save draft → submit → admin approve sets approved fields + audit` · `reject + request_changes set status/note and un-verify` · `filters q/specialty/mode/language/country + cursor reach the query` · `GET consents returns all 8 categories for participants`.

## Test infrastructure

| Piece | Where |
|---|---|
| Fully mocked Prisma (no DB) | per-file `mockPrisma` + `jest.mock('../src/lib/prisma')` — `$transaction` resolves callback against the mock |
| AuthN bypass | `x-user-id` header (`AUTH_TEST_BYPASS` via `tests/setup.js`) |
| RBAC fixtures | per-file `mockRoles(userId, roleNames)` against `userRole.findMany` (`tests/helpers/authz.js` pattern inlined) |
| Flags | `tests/setup.js` force-enables all non-`control` flags via `FF_*` env; suites flip per-case + `flags.resetCache()` |

## Deferred / not covered

| Gap | Why |
|---|---|
| Real-DB unique-constraint races (concurrent subscribe) | Prisma mocked — race semantics asserted only at service-logic level |
| Rate-limit behavior on trainer routes | global limiter skipped under `NODE_ENV=test` |
| Session-revoke integration on approve (real `authSession` delete) | asserted via mock call, not a live login |
| `paused` write-path authorization depth | `PATCH /clients/:clientId/status` allows arbitrary pending/active/paused/completed transitions by owner trainer — covered only at role level |
| NutritionistClient parity (F11) | confirmed out of scope |
| N+1 regression (F8) under real query counting | `groupBy` batch asserted, no query-count harness |
