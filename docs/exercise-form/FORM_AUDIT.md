# Exercise Form Audit — pc-HUM-7

_Source-based review only. No production logic, cue text, thresholds, flags,
or migrations changed. "Source trace" = read from code; "observed runtime" =
not exercised — no device/runtime verification was performed._

Repos & SHAs (worktrees):
- backend `fitness-app-backend-form-audit` @ `466657e` (branch `humai/dev-04/pc-HUM-7-form-audit`, base `origin/main`)
- mobile `fitness-app-mobile-form-audit` @ `5cc1831` (detached, read-only)

## 1. Where form guidance lives

| Layer | Location | Role |
|---|---|---|
| Curated exercise catalog | backend `src/services/exerciseCatalog.js` | 27 exercises; the only IDs AI plans + mobile camera registry may reference (`CATALOG_VERSION` v1) |
| Suitability engine | backend `src/services/exerciseSuitability.js` | deterministic classify → `suitable`/`adapt`/`needs-info`/`review`; consumed by `workoutPlanner.candidatesFor` (**only `suitable` becomes a plan candidate — adapt/review/needs-info are excluded, not warned**), `personalPlans` picker (downgrades blocked categories to `review`), `/suggestions` (conflicts → `direction:'review'`) |
| Safety derivation | backend `src/services/activitySafety/gate.js` | maps injuries/restrictions/mobility → limitation tokens + `blockedCategories` fed into suitability |
| Big exercise library | backend `data/exercises.json` (876 rows → Exercise/ExerciseMuscle tables) | static `instructions[]` + images per exercise; demand-classification audited in `docs/audits/exercise-library-safety-quality.md` |
| Form-check video | backend `src/services/formChecks.js` + `src/routes/formChecks.js` | trainer requests → member uploads (explicit `consentToTrainerReview`) → timestamped feedback; signed 5-min URLs, hard-deletable; trainer request carries a privacy-preserving `clientSafetyNotice` via `safetyGate` |
| Coaching session store | backend `src/services/poseCoaching.js` + routes | landmark-derived analytics only (no frames); consent-gated `coachingSession`; `requireFeature('pose_detection')` |
| Camera capability registry | mobile `src/detection/exerciseRegistry.ts` | per-exercise: rep config, camera angle, required joints, support levels, `validationStatus`, limitations — honest "provisional/unvalidated/restricted" vocabulary |
| Rep FSM | mobile `src/detection/repCounter.ts` | pure FSM, hysteresis + debounce + visibility gate + flicker guard (maxJump 75°) |
| Per-frame overlay rules | mobile `src/detection/posture.ts` (`POSTURE_RULES`) | angle ranges → red/green skeleton + directional arrows; `insufficient_evidence`/`unsupported`/`not_evaluated` statuses — never a pass without evidence |
| Rep-complete form rules | mobile `src/detection/formRules.ts` (`RULES_BY_EXERCISE`) | whole-rep-window verdicts; ≤1 coaching event per rep, highest severity wins; view-blocked primary → `view.unsuitable` cue |
| Cue library | mobile `src/detection/coachingLibrary.ts` | only legal cue text; all 5 cues `review:'pending'` → per its own contract, rendered under flag but **never spoken** (`PoseCameraScreen` gates TTS on `review === 'reviewed'`) |
| Camera screen | mobile `src/screens/PoseCameraScreen.tsx` | flag-gated: `poseRepCounting` (on), `poseFormCoaching` (**off by default**, featureKeys.ts:109), `poseDiagnostics` (off + server allowlist); banner shows coaching msg only when `formCoachingOn && safeToDisplay && tracking` |
| Entry point | mobile `src/screens/LogExerciseScreen.tsx:315` | "Camera rep count and form" offered iff `poseDetection` flag AND `support.repCounting !== 'none'` |

## 2. Exercises reviewed vs total

- Curated catalog: **27/27 reviewed** (table below). Camera-coached subset prioritized.
- Big library: **876 rows** — schema + representative sample + prior audit; per-row instruction review out of scope this pass.
- Aliased variants (13) reuse base rep configs — reviewed via base.

| ID | Rep config | Posture rules | Rep-complete form rules | Registry claim | Status |
|---|---|---|---|---|---|
| squat | ✓ knee 100/160° | depth + back (phase `down`) | depth, torso-lean, asymmetry, tempo | rep+form provisional | **fullest path** |
| bench-press | ✓ elbow 85/155° | elbow 70–115° | **none** | rep+form provisional | posture only |
| push-up | ✓ elbow 95/155° | elbow + body-line | none | rep+form provisional | posture only |
| overhead-press | ✓ elbow 95/160° | lockout 150–200° | none | rep+form provisional | posture only |
| deadlift | ✓ hip 110/165° | back 150–210° | none | rep+form provisional | posture only |
| barbell-row | ✓ elbow 150/95° inv | pull + torso | none | rep+form provisional | posture only |
| pull-up | ✓ elbow 150/80° inv | pull 40–95° | none | rep+form provisional | posture only |
| lunge / split-squat / leg-press / glute-bridge | ✓ own configs | none | none | rep provisional | counting only |
| 13 aliases (goblet/box/chair-squat, incl/knee-push-up, db-floor/seated-db/band-press, db/band-row, lat/band-pulldown, rdl-db) | via `aliasOf` | none | none | rep provisional, `formFeedback:'none'` | counting only — honest |
| plank / dead-bug / farmer-carry | none | none | none | `validationStatus:'restricted'` | camera honestly declined |

Direction-of-cue spot check (source trace): squat depth flags small knee angle → "sit deeper" arrow down ✓; torso-lean `<40°` at bottom → "chest more upright" ✓; push-up elbow `<70` → arrow up, `>110` → arrow down ✓. No opposite-movement cue found.

## 3. Correction & safety-path traces (source)

**Correction path (squat shallow rep):** pose → `resolveAngleSample` (best-visibility side) → FSM rep completes (minAngle ∈ (95,100]) → `evaluateRepForm` → `squat.depth` deviation → `COACHING_CUES['squat.depth.shallow']` → cooldown (`cooldownReps:3`, keyed per correctionKey in realEngine) → `coaching` event → banner if `poseFormCoaching` on; **not** spoken (review pending).

**Abstention paths:** missing/low-visibility joints → `angleBetween` NaN → samples dropped → `incomplete_body`/`low_confidence` status banners (non-tracking, attention) → posture `insufficient_evidence` ("tracking too weak to judge"), rep-form `not_visible` → no verdict. Front view on squat → primary rules `not_visible` → `view.unsuitable` cue (reposition guidance, not a false pass). Fail-closed throughout. ✓

**Eligibility path:** recorded injury/restriction → `gate.deriveLimitations` → tokens + `blockedCategories` → `classify`/`evaluateAll` → planner admits `suitable` only; picker downgrades; suggestions pause as `review`. Exclusion — not merely warning — verified for the plan path (workoutPlanner.js:91 `status !== 'suitable'` → dropped).

## 4. Findings

**F1 — `'back'` limitation token is dead code (eligibility gap).**
Trigger: injury on `lower_back|back|spine|neck|ribs|abdomen` (gate.js:44) or a `TRUNK_LOAD` restriction at `severity:'modify'` (gate.js:90) → emits limitation token `'back'`. But `exerciseSuitability.LIMITATION_BLOCKS` has **no `'back'` key** — `blocks?.(e)` is undefined → token ignored. Result: `classify('deadlift', {limitations:['back']})` → `suitable`; the exercise stays a plan candidate and picker entry with no warning. Contrast: `severity:'prohibited'` TRUNK_LOAD works via `blockedCategories`, and `'hip'` token does catch hinge exercises — so the hole is specifically the back-token path. Basis: `workoutPlanner.candidatesFor` admits `suitable` only; the mapping table's own comment says these tokens feed exerciseSuitability. Prior audit (exercise-library-safety-quality.md, E-1/E-2) flagged analogous catalog gaps; this one is a code-level token no-op not previously recorded.
Smallest verifier: `tests/exerciseSuitability.test.js` — `classify('deadlift', {limitations:['back']})` (currently returns `suitable`); plus a gate unit test asserting `deriveLimitations` output lands on a handled token.

**F2 — `suspend` severity / `suspendTracking` emitted but never consumed (latent stop-path).**
`formRules.js` sets `suspendTracking: cue.severity === 'suspend'`; `SEVERITY_RANK` ranks suspend highest; `sanitizeObservations` accepts the priority. But nothing in `realEngine.ts`/`PoseCameraScreen.tsx` reads `suspendTracking` — no pause/stop/demote of tracking. Latent today (no cue has severity `suspend`), but the "stop coaching" contract exists unimplemented — a future suspend cue would emit an event that doesn't suspend.
Verifier: `realEngine.test.ts` case asserting behavior on a suspend-severity event (currently undefined); `formRules.test.ts` can assert the flag is set.

**F3 — `formFeedback:'provisional'` metadata overstates coverage for 6/7 exercises.**
`repAndForm` marks bench-press, push-up, overhead-press, deadlift, barbell-row, pull-up as `formFeedback:'provisional'`; `formKey` resolves because `POSTURE_RULES[key]` exists — but `RULES_BY_EXERCISE` contains **squat only**, so rep-complete coaching emits nothing for the other six (`formRules.test.ts` "unsupported exercise produces no evaluations and no event" confirms this is the coded behavior). Per-frame overlay does work for all seven — two different feedback layers share one support flag. Not user-harmful (nothing false is shown), but registry semantics are ambiguous between "overlay" and "rep coaching".
Verifier: `exerciseRegistry.test.ts` asserting `support.formFeedback==='provisional'` ⇒ `RULES_BY_EXERCISE[configKey]` non-empty — currently fails for 6.

**F4 — posture rule labels are spoken without a review track.**
`PoseCameraScreen` TTS gates coaching cues on `review==='reviewed'` (all pending → silent ✓), but the fallback speaks `posture.message` for pass/needs_correction — posture labels ("Chest up — keep your back straight") carry no review field and ARE spoken while all COACHING_CUES are muted. The letter of the cue-library contract holds (posture labels aren't in that table); the spirit — no unreviewed coaching spoken — doesn't. Flag for content-review decision, not declared a defect.
Verifier: screen-level test — `postureStatus:'needs_correction'` + voice on → TTS called with rule label text.

**F5 — non-phase-gated posture rules fire in the opposite phase for inverted exercises.**
Squat rules use `phase:'down'` because "at lockout a straight knee is correct, not shallow." Pull-up `pull` (elbow 40–95°) and overhead-press `lockout` (150–200°) have no phase field → evaluate every frame, including rest positions (dead hang / bar at chest), showing "Pull until your chin clears the bar" / red skeleton at the bottom — a cue belonging to the top phase firing in the bottom phase. Direction is correct; phase discipline (which the codebase already demonstrates) is missing. Cosmetic-to-UX finding; flagging for review, not asserting a clinical error.
Verifier: `posture.test.ts` — `evaluatePosture(pullUpPose_extended, 'pull-up', 'down')` currently `needs_correction`; a phase-gated design would yield `not_evaluated`.

**F6 — camera coaching is reachable for exercises the member's restrictions would exclude from a plan.**
`LogExerciseScreen` offers camera counting on any rep-capable exercise with no suitability check. Consistent with logging being user-initiated (manual logging is also ungated), and the plan path does exclude — noted as a boundary observation, not a defect. If policy intends contraindicated exercises to be gated everywhere, the camera entry is a bypass surface.
Verifier: render test — picker/camera button for an exercise `classify`→`review`.

## 5. Coverage already verified by tests (existing)

`formRules.test.ts` (10): view gating, depth marginal-band, asymmetry, tempo, cue-library integrity ("every cue referenced by a rule exists"). `repCounter.test.ts` (18): FSM hysteresis/debounce/flicker. `realEngine.test.ts` (28): status machine, pause/resume, low-confidence. `exerciseSuitability.test.js` (15): review for `recent-injury`, seated-only exclusion, determinism — **no `'back'` limitation case (F1)**. `posture.test.ts` (12). `formChecks.test.js`, `poseCoaching.test.js`: consent/ownership paths.

## 5b. Validation addendum (increment 2 — reproduced checks)

**Source revisions inspected:** backend `466657e` + audit `1844368`; mobile `5cc1831` (detached).

**F1 reproduced end-to-end** (dependency-free `node -e`, backend worktree):
```
classify('deadlift', {equipment:[all], limitations:[]})      → suitable
classify('deadlift', {equipment:[all], limitations:['back']}) → suitable   ← token ignored
classify('deadlift', {equipment:[all], limitations:['hip']})  → adapt      ← live-token contrast
classify('barbell-row'|'squat', {…, limitations:['back']})   → suitable
deriveLimitations({injuries:[{bodyPart:'lower_back'}]})      → {limitations:['back'], blockedCategories:[], reviewRequired:false}
deriveLimitations({restrictions:[{status:'active',severity:'modify',categories:['trunk_load']}]})
                                                             → {limitations:['back'], blockedCategories:[]}
```
So a recorded lower-back injury (no prohibitedCategories) or a clinician
'modify' trunk restriction yields a token nothing consumes → deadlift, squat,
barbell-row all remain `suitable`. Only `severity:'prohibited'` (blockedCategories)
or tokens present in `LIMITATION_BLOCKS` actually constrain. **New finding — no
prior doc owns it**: `activity-safety-rule-by-rule-validation.md` and
`activity-safety-rule-audit.json` have zero `'back'`/limitation-token coverage;
`exercise-library-safety-quality.md` E-1/E-2 are catalog-shape gaps, not this
code path. HF-prefixed findings in `docs/nutrition-intelligence/` are
nutrition-scoped — no overlap, no duplicate ownership.

**F2 re-verified:** `grep -rn "suspendTracking" src/` → writes only
(formRules.ts:250,265 + types.ts:37 declaration); zero consumers.

**F4 line refs:** `PoseCameraScreen.tsx` ~lines 128–146 — `speakableCoaching`
requires `coachingCue?.review === 'reviewed'`; the TTS fallback speaks
`posture?.message` whenever status is `pass`/`needs_correction`, and
`needs_correction` message = the rule's `label` (unreviewed cue text with no
review field). Screen comment claims "never unreviewed text" — posture labels
are outside that guarantee.

**F5 re-verified:** `grep -n "phase:" posture.ts` → only lines 111, 123 (the
two squat rules). `posture.test.ts` (12 tests) never passes the `phase`
parameter — phase gating itself is untested.

**Test runs (existing facilities, all green — regression baseline, not
correctness proof):**
- mobile `npx jest formRules.test.ts posture.test.ts exerciseRegistry.test.ts` → **29/29 pass**
- backend `npx jest tests/exerciseSuitability.test.js tests/formChecks.test.js tests/poseCoaching.test.js` → **31/31 pass**
- mobile full detection suite `npx jest src/detection/__tests__/` → **111/111 pass** (7 suites incl. `realEngine`, `repCounter`, `repBenchmark`, `mockEngine` — matrix now complete)
- Blocked: nothing. TS-side findings verified by source + existing tests;
  no new test files added in this read-only increment.

**Coverage-limit correction to §2:** `classify` returns `needs-info` (not
`suitable`) when equipment is required but unprovided — the F1 repro above
supplies equipment so baseline vs token are compared at full information.

## 6. Guidance inventory & provenance (increment 3 — all user-facing instruction sources)

| Source | Count | Provenance / review status | Consumer & exposure path | Safety-constraint effect on presentation |
|---|---|---|---|---|
| Curated catalog `exerciseCatalog.js` | 27 exercises | authored in-repo, `CATALOG_VERSION` v1 | plans/picker via `personalPlans` + `workoutPlanner` | **constrained**: non-`suitable` excluded from plans; picker downgraded to `review` |
| Big library `data/exercises.json` → `Exercise.instructions` | **876 rows**; 871 with instructions, **5 empty** | vendored `free-exercise-db` public dataset (`source:'free-exercise-db'` on every row; `exercise-metadata-patch.json` provenance-tracked overrides only). **No clinical/content review field exists** | `GET /exercises/library/search` + `/library/:id` + `/library/:id/alternatives` → mobile `MuscleExplorerScreen` (shows first 4 steps, line ~290) + `getLibraryAlternatives` | **none**: no `requireFeature`, no `safetyGate`, no suitability check on browse/detail/alternatives; `MuscleExplorer` Stack.Screen is ungated. A member whose record contraindicates a movement can read its instructions and see muscle-similar alternatives — browse is informational, but nothing marks it constrained (extends F6) |
| Posture rule labels `posture.ts` | 12 labels across 7 exercises | in-repo, **no review field** | overlay flag + `assessment.message`; **also spoken via TTS fallback** (F4) | none — labels are cue text |
| `COACHING_CUES` | 5 entries, all `review:'pending'` | internal placeholder per file header | banner iff `poseFormCoaching`; never spoken | cooldown + `safeToDisplay` + flag |
| Curated-27 static how-to | **none in-app** — no instructions field | — | `LogExerciseScreen` offers only external YouTube "proper form" search | n/a — guidance is off-platform and unreviewed by definition |
| form-check trainer feedback | per-request | trainer-authored, consented | `/form-checks/*` signed-URL flow | `clientSafetyNotice` on request creation |

**Library scan results (876 rows, programmatic):** 0 duplicate names/IDs; instruction step counts 0–24, avg 4.3. Empty: `Iron Cross`, `One-Arm Kettlebell Swings`, `Push Press`, `Side Bridge`, `Side Jackknife`. Thin (<15-char steps, possible stub text): `Band Hip Adductions`, `Barbell Squat To A Bench`, `Body-Up`, `Clean`, `Close-Grip EZ-Bar Press`, `EZ-Bar Skullcrusher`, `On-Your-Back Quad Stretch` — `Clean` is a complex barbell lift with stub instructions; flag for content review. Equipment-text quirks (body-only/blank metadata but text names equipment — likely props or apparatus references, **review candidates not defects**): 9 rows incl. `Incline Push-Up *` variants ("machine" = smith surface), `Hamstring Stretch`/`Seated Calf Stretch` (band prop), `Inverted Row`, `Natural Glute Ham Raise`, `Close-Grip Push-Up off of a Dumbbell`, `One-Arm` entries. No name↔instruction mismatches demonstrable mechanically; no phase field exists in the dataset so "phase-inappropriate" is N/A for static text.

## 7. Clinical-review packet (exact items requiring qualified human review before publication claims)

1. **Rep-complete cue texts** — `squat.depth.shallow`, `squat.torso.lean`, `squat.asymmetry`, `squat.tempo.fast`, `view.unsuitable` (verbatim in `coachingLibrary.ts`). Exposure: banner under `poseFormCoaching` (currently off).
2. **Posture labels (12)** — e.g. `'Sit deeper — aim for thighs near parallel'`, `'Chest up — keep your back straight'`, `'Neutral spine — chest up, hinge at the hips'`, `'Pull until your chin clears the bar'`, `'Press to full lockout overhead'`, `'"Keep a straight line — don't let hips sag"'` (verbatim in `posture.ts`). Exposure: overlay + **TTS fallback today (F4)** — these are spoken NOW when voice is on and status is `needs_correction`/`pass`; the pass-status message `'No issue detected in the movements this camera can assess.'` is also spoken.
3. **Angle thresholds** — rep counters (12 configs: downBelow/upAbove per exercise in `repCounter.ts` e.g. squat 100/160° knee, pull-up 150/80° elbow inverted, glute-bridge 150/118° hip inverted); form rules (`DEPTH_MARGINAL_DEG 95`, `TORSO_LEAN_DEG 40`, `ASYMMETRY_DEG 25`, `TEMPO_FAST_MS 900`); posture ranges (e.g. squat depth 70–120° phase-gated `down`). Exposure: rep counts + corrections for 11 camera exercises; all `provisional`, none device-validated.
4. **Suitability reason strings** — user-facing `'adapt'`/`'review'` copy in `exerciseSuitability.js` (e.g. "may not suit reported …"); F1 means `'back'`-token members see no such warning on trunk-load exercises.
5. **Big-library instruction text** — unreviewed third-party content at ungated exposure; 5 empty + 7 thin + 9 equipment-quirk rows enumerated above.
6. **F1 remediation decision** — `'back'` limitation handling (map to LIMITATION_BLOCKS vs route to blockedCategories) is a clinical-policy call on which trunk-loading movements a reported back issue should adapt vs exclude; **any implementation must ship with a test asserting `deriveLimitations(lower_back injury) → classify(deadlift) ≠ 'suitable'`** (contraindication excluded) and a test that an unknown/unmapped token cannot yield `suitable` silently.

Cross-reference: F1–F6 (§4) — F1 confirmed new vs `activity-safety-rule-*` docs (zero token coverage) and E-1…E-6 (catalog-shape, different layer); ownership is this task until a remediation increment is scoped. HF-prefixed nutrition findings do not overlap.

## 8. Remaining for runtime/clinical verification

- On-device behavior of every 'provisional' capability (`validationStatus` ≠ validated for all — nothing claims device validation).
- Every cue text/angle threshold listed in §7 — qualified review required per `coachingLibrary.ts`'s own pending-review contract; this audit verified plumbing and direction, not clinical correctness.
- Whether F1's `'back'` gap is offset clinically by prohibited-category recording practice — needs review of real restriction data.
- Per-row human review of 871 instruction sets (mechanical scan found no demonstrable name↔text mismatch; semantic correctness unreviewed).
- `formRules.ts` comment for `DEPTH_MARGINAL_DEG` describes the band backwards ("100° < min ≤ threshold" vs actual (95,100]) — cosmetic doc nit.

## 9. Remediation addendum (increment 4 — 2026-11-26)

- **F1 REMEDIATED** (pc-HUM-44, backend commit `4ed2929`, branch `humai/dev-07/pc-HUM-44-rec-safety`): `'back'` limitation token gained a `LIMITATION_BLOCKS` handler (hip-hinge mobility + carry pattern) with the §7.6-mandated test — `classify('deadlift')` under a `'back'` token is no longer `'suitable'`; clinical-standard alternatives (glute-bridge, db-row, dead-bug) remain suitable. §7 item 6 is closed except the residual clinical-policy question of adapt-vs-exclude on trunk loading.
- **Phase gating extended to non-squat posture rules** (mobile commit `344fe6a`, branch `humai/dev-07/pc-HUM-67-pose-reps`): five ungated rules fired corrections at positions where the measured angle is correct by design — push-up/bench-press elbow-depth flagged straight-arm lockouts; overhead-press lockout flagged the bent bottom; pull-up/barbell-row pull-completion flagged extended-arm bottoms. Depth rules now bind `phase: 'down'`, completion rules `phase: 'up'`. Steadiness rules (push-up body line, row torso) stay ungated intentionally. Regression: correct lockout/bottom positions draw no wrong-phase correction; 167/167 detection tests green, tsc clean.
- **NEW FINDING F7 (documented, not fixed)**: `deadlift.back` posture rule is semantically unsound independent of phase — its shoulder-hip-knee angle measures hip hinge, not spine curvature, so it cannot pass at a correctly hinged bottom regardless of form. Needs clinical/biomechanical redesign (proper spinal-alignment metric or removal); left unchanged deliberately.
- §8 cosmetic nit (`DEPTH_MARGINAL_DEG` band comment backwards) fixed in the same mobile commit.

Still requiring qualified human review (unchanged): §7 items 1–3, 5 — cue texts, posture labels, angle thresholds, big-library instruction text. This audit verifies plumbing and direction only, never clinical correctness.
