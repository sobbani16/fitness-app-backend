# Exercise Intelligence — Master Execution Ledger

Coordination ledger for the HUM-100 program. Branch/file ownership entries are
the mechanism the cards specify for cross-lane coordination; each lane appends
its own rows. Do not rewrite another lane's entries.

## Spec reference correction (defect #241)

The pc-HUM-101 card pins `docs/programs/exercise-intelligence-platform.md` at
commit `d51d7fc`. Verified 2026-11-28 in fitness-app-backend:

- `git cat-file -t d51d7fc` → object absent (not reachable in any branch).
- `docs/programs/exercise-intelligence-platform.md` does not exist in
  `origin/main` or in any reachable history (`git log --all --follow`).
- The only exercise-intelligence documents in the repo are the generated
  artifacts in this directory.

Conclusion: the pinned spec object never landed in this repository — it lives
in planning material outside version control here (or the reference is stale
from a renamed/rewritten branch). This ledger records that fact rather than
fabricating spec content. The operative requirements for this lane are the card
text itself (§5/§6/§33 as quoted on pc-HUM-101). If the canonical spec is
published into the repo later, update this section with the resolvable commit.

## Lane entries — dev-03 (pc-HUM-101, profiles/onboarding)

| date | lane | files owned/touched | branch | notes |
|---|---|---|---|---|
| 2026-11 (prior) | profiles artifact | `src/services/exercise/profiles.js`, `taxonomy.js`, `scripts/exercise-inventory.js`, `docs/exercise-intelligence/*` | humai/dev-03/pc-HUM-101-exercise-profiles | merged via PR #34 — 884 versioned honest level-0 profiles |
| 2026-11 (prior) | CI detection | `tests/exerciseProfileArtifact.test.js` | humai/dev-03/pc-HUM-101-ci-detection | draft PR #83 — 7/7 structural + honesty checks, DB-less CI |
| 2026-11-28 | auto-onboarding | `src/services/exercise/onboarding.js`, `scripts/import-exercises.js` (hook), `scripts/exercise-inventory.js` (module export + EXERCISE_INTEL_OUT_DIR), `tests/exerciseAutoOnboarding.test.js` | humai/dev-03/pc-HUM-101-ci-detection | write-time draft onboarding on the sole catalog write path; derive-on-read completeness; 5/5 regression tests |

## Architecture decision record — write-time onboarding (2026-11-28)

Profiles are pure deterministic derivations of exercise rows (`buildProfile`).
Persisting per-exercise profile copies would create drift between derivation
logic and stale snapshots, so there is one source of truth:

1. **Derive-on-read** — any exercise row yields a complete draft profile at any
   moment; a new exercise is never profile-less by construction.
2. **Artifact regeneration at write-time** — the catalog's sole write path
   (`scripts/import-exercises.js`, verified by repo-wide scan: no API route or
   seed creates exercise rows; `src/routes/exercises.js` manages workout
   *sessions*) regenerates the CI-audited artifact after every import, so
   `tests/exerciseProfileArtifact.test.js` always audits current reality.
   `--no-onboard` opts out for partial dev imports.

Honesty invariants preserved: review status `auto_generated_unreviewed`,
capability level 0, zero ML-validation claims — existence of a profile is never
evidence of validation.
