// Auto-onboarding for new exercises — pc-HUM-101 §5/§6.
//
// Architecture decision (documented in PR): intelligence profiles are pure
// deterministic derivations of exercise rows via buildProfile(). Persisting
// separate per-exercise profile rows would create drift between the derivation
// logic and stale stored copies, so there is exactly ONE source of truth:
//   derive-on-read  — any exercise row yields a complete draft profile at any
//                     moment through buildProfile(); a new exercise is therefore
//                     never without a profile, by construction.
//   artifact snapshot — docs/exercise-intelligence/exercise-profiles.v1.json is
//                     a CI-audited snapshot, regenerated at every catalog write
//                     so the CI completeness detection (tests/
//                     exerciseProfileArtifact.test.js) always audits current
//                     reality rather than a stale artifact.
// Write-time onboarding therefore means: every catalog write path must call
// onboardCatalog() after it mutates exercises. Today the ONLY write path is
// scripts/import-exercises.js (verified by repo-wide scan 2026-11-28: no API
// route, seed script, or service creates exercise rows — src/routes/exercises.js
// manages workout *sessions*, not catalog entries).
const { buildProfile } = require('./profiles');

/**
 * Derive the draft intelligence profile for one exercise row on read.
 * New exercises are never profile-less: derivation is total and deterministic.
 * Review status is always auto_generated_unreviewed — never ML-validated.
 */
function deriveDraftProfile(exerciseRow) {
  return buildProfile(exerciseRow);
}

/**
 * Write-time hook: regenerate the versioned profile artifact so every exercise
 * — including rows created by the write that just completed — has its draft
 * profile materialized in the CI-audited snapshot. Implemented as a lazy
 * require to avoid a module cycle (the inventory script uses prisma).
 * Returns the regeneration summary or throws on integrity failure.
 */
async function regenerateProfileArtifacts() {
  const { regenerateArtifacts } = require("../../../scripts/exercise-inventory");
  return regenerateArtifacts();
}

module.exports = { deriveDraftProfile, regenerateProfileArtifacts };
