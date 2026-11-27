# HUM-100-I Backend APIs & Workout Persistence — Verification (2026-11-25)

Audit + verification of pc-HUM-108 against `origin/main` (`3650bbb`). The
backend surface for the pose-ML epic was already implemented; this record
documents the end-to-end verification, one input-validation fix landed on
this branch, and the residual external items.

## 1. Pose-coaching session APIs

`src/routes/poseCoaching.js` mounted at `/pose-coaching` (`routes/index.js:107`),
gated on `requireFeature('pose_detection')` + `identifyUser`:

| Endpoint | Verified behavior |
|---|---|
| `POST /sessions` | consent gate — `consentToStore !== true` → 204, nothing persisted; provenance fields (`devicePlatform`/`appBuild`/`modelVersion`/`ruleVersion`/`cameraView`) length-capped; `repDiagnostics` ≤500 entries, enums/bounds sanitized; `observations` ≤200; audit-logged `pose_coaching.session_created` |
| `GET /sessions` | cursor pagination (`take`+1 pattern, `nextCursor`), `exerciseId` filter, limit clamped 1–200 |
| `GET /sessions/:id` | owner-only — cross-user reads 404 (no existence leak) |
| `PATCH /sessions/:id` | finalize: `confirmedReps` int 0–100000 / `discarded` (clears confirmed) / `corrections {adjust,final,note≤200}` / `endedAt`; empty body → 400; audit-logged |
| `DELETE /sessions/:id` | owner-only hard delete — correct for consent withdrawal (the record is the sensitive artifact); audit-logged |
| `GET /diagnostics-access` | server-side tester allowlist verdict (`POSE_DIAGNOSTIC_TESTER_IDS` env + admin) |

Privacy contract verified in service: landmark-derived analytics only — no
frames/images/video fields exist in the payload or schema. Mobile client
(`src/api/poseCoaching.ts`) never sends diagnostics unless the user opts in
on the summary screen.

**Fix landed on this branch:** `endedAt` was unvalidated in both create and
finalize — `'junk'` produced an `Invalid Date` passed into the prisma write,
crashing as a 500 (and leaking through the codebase-wide `err.message`
convention). New `optionalDate()` helper rejects invalid dates with 400.
Failing tests written first, both confirmed red, now green. PATCH semantics
note: explicit `endedAt: null` now clears the field (previously no-op → 400)
— coherent with PATCH, mobile never sends null.

## 2. Workout persistence (`/exercises`)

`src/controllers/exerciseController.js` + `src/models/persistentExerciseStore.js`
(production store; in-memory only when `NODE_ENV=test && AUTH_TEST_BYPASS`):

| Property | Evidence |
|---|---|
| Prisma persistence | `WorkoutSession` + nested `ExerciseSet` create; `@@index` absent on `userId` queries — `take: 200` bound, acceptable |
| Idempotency | client `id` is the operation key: replay-safe `checkReplay` (same user/type/sets → returns committed; divergent payload → 409), P2002 race → re-read + replay-check |
| Concurrency | `addSet`/`finish` in `$transaction` with `SELECT … FOR UPDATE` row lock |
| Validation | reps int 1–1000, weight 0–2000 lb, ≤100 sets/session, start within trailing 7 days, duration capped 240 min |
| Lifecycle | finish requires ≥1 set; finished sessions reject further sets (409) |
| Identity | userId from authenticated session only — body `userId` never trusted |

Integration verified: `PoseCameraScreen.persistSession` → analytics only;
confirmed reps flow via `onCountedChange` → `useExerciseSession` →
`createSession`/`appendSet`/`finishSession` — the documented design in the
service header ("Neither is written to WorkoutSession/ExerciseSet here —
the client logs workouts through the existing path after review") is what
the mobile client actually implements.

## 3. Schema & deploy readiness

- Migration `20261225000000_pose_coaching_sessions` exists on main — auto-covered
  by `assertDeploymentReady`'s `migrationManifest()`.
- `CoachingSession` model fields match the mobile payload exactly (verified
  field-by-field against `src/api/poseCoaching.ts` types).
- Flags: `pose_detection` registered (`featureRegistry.js:126`) with two
  dependent flags — registry integrity asserted by `tests/featureFlagRegistry.test.js`
  (pc-HUM-97 branch, unmerged).

## 4. Test evidence (this branch)

```
npx jest tests/poseCoaching.test.js tests/exercises.route.test.js \
    tests/exerciseService.test.js tests/workoutPlanner.test.js --runInBand
→ 4 suites passed, 38/38 tests
```

## Residual items (external / out of card scope)

1. Push + merge — all pc-HUM branches are local pending merge policy.
2. The `fail()`/`err.message` 500-exposure pattern is codebase-wide (36 route
   files) — platform-level hardening candidate, not a pose defect.
3. Mobile offline-queue does not cover pose finalize or workout-set writes
   (documented in `docs/deployment/PLATFORM_INFRA_STATUS.md`, pc-HUM-97) —
   a dropped finalize leaves the analytics session unconfirmed but never
   blocks workout logging; acceptable per design comment.
