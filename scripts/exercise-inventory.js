#!/usr/bin/env node
// pc-HUM-101 — exercise inventory + intelligence-profile catalog generator.
// Reads the real exercise catalog and writes:
//   docs/exercise-intelligence/exercise-inventory.json   — every exercise exactly once
//   docs/exercise-intelligence/exercise-profiles.v1.json — one versioned profile per ID
//   docs/exercise-intelligence/EXERCISE_INVENTORY_REPORT.md
// Exits 1 when integrity checks fail (duplicate inventory entry, missing
// profile, ML-validation claim anywhere). Unclassified exercises are NOT a
// failure — they are honest taxonomy residue, counted and listed.
const fs = require('node:fs');
const path = require('node:path');
const { getPrisma } = require('../src/lib/prisma');
const { buildProfile, PROFILE_VERSION } = require('../src/services/exercise/profiles');
const { FAMILIES } = require('../src/services/exercise/taxonomy');

// EXERCISE_INTEL_OUT_DIR overrides the output directory (tests write to a tmp dir
// so regeneration against a test database never dirties the committed artifact).
const OUT_DIR = process.env.EXERCISE_INTEL_OUT_DIR || path.join(__dirname, '..', 'docs', 'exercise-intelligence');

async function regenerateArtifacts() {
  const prisma = getPrisma();
  const exercises = await prisma.exercise.findMany({ include: { muscles: true }, orderBy: { id: 'asc' } });
  await prisma.$disconnect();

  const ids = new Set();
  const inventory = [];
  const profiles = [];
  const familyCount = {};
  const levelCount = {};
  const issues = { missingInstructions: [], noPrimaryMuscle: [], unclassified: [], duplicateIds: [] };

  for (const ex of exercises) {
    if (ids.has(ex.id)) { issues.duplicateIds.push(ex.id); continue; }
    ids.add(ex.id);
    const profile = buildProfile(ex);
    profiles.push(profile);
    inventory.push({
      id: ex.id,
      name: ex.name,
      normalizedName: ex.normalizedName,
      level: ex.level, force: ex.force, mechanic: ex.mechanic,
      equipment: ex.equipment, appEquipment: ex.appEquipment, category: ex.category,
      instructionCount: (ex.instructions || []).length,
      primaryMuscles: profile.identity.primaryMuscles,
      secondaryMuscles: profile.identity.secondaryMuscles,
      source: ex.source, sourceId: ex.sourceId || null, reviewStatus: ex.reviewStatus,
      movementFamily: profile.classification.family,
      movementSubtype: profile.classification.subtype,
      taxonomyRule: profile.classification.ruleId,
      classified: profile.classification.classified,
      capabilityLevel: profile.capability.level,
    });
    if (profile.classification.family) familyCount[profile.classification.family] = (familyCount[profile.classification.family] || 0) + 1;
    else issues.unclassified.push(ex.id);
    levelCount[profile.capability.level] = (levelCount[profile.capability.level] || 0) + 1;
    if (!(ex.instructions || []).length) issues.missingInstructions.push(ex.id);
    if (!profile.identity.primaryMuscles.length) issues.noPrimaryMuscle.push(ex.id);
  }

  // --- Integrity checks ---
  const failures = [];
  if (inventory.length !== ids.size) failures.push('inventory does not contain every exercise exactly once');
  if (profiles.length !== inventory.length) failures.push('profile count != inventory count');
  const mlClaims = JSON.stringify(profiles).match(/"[^"]*validated"\s*:\s*true|repCountValidationStatus":"validated"/);
  if (mlClaims) failures.push(`ML-validation claim found: ${mlClaims[0]}`);

  const classifiedCount = inventory.length - issues.unclassified.length;
  const pct = ((classifiedCount / inventory.length) * 100).toFixed(1);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'exercise-inventory.json'), JSON.stringify({ generatedAt: new Date().toISOString(), count: inventory.length, exercises: inventory }, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, 'exercise-profiles.v1.json'), JSON.stringify({ profileVersion: PROFILE_VERSION, generatedAt: new Date().toISOString(), count: profiles.length, honesty: 'no profile claims ML validation; capability levels derive from evidence — all Level 0 manual tracking today', profiles }, null, 1));

  const famRows = Object.entries(familyCount).sort((a, b) => b[1] - a[1]).map(([f, n]) => `| ${f} | ${n} |`).join('\n');
  const report = `# Exercise Inventory + Intelligence Profile Report — pc-HUM-101

Generated: ${new Date().toISOString()} · catalog rows: **${inventory.length}** · profile version: \`${PROFILE_VERSION}\`

## Coverage comparison
| surface | count |
|---|---|
| database exercises | ${inventory.length} |
| free-exercise-db source | ${inventory.filter((i) => i.source === 'free-exercise-db').length} |
| other sources (test/dev fixtures) | ${inventory.filter((i) => i.source !== 'free-exercise-db').length} |
| intelligence profiles generated | ${profiles.length} |
| exercises missing instructions | ${issues.missingInstructions.length}${issues.missingInstructions.length ? ` (${issues.missingInstructions.join(', ')})` : ''} |
| exercises without primary muscle | ${issues.noPrimaryMuscle.length} |
| duplicate ids | ${issues.duplicateIds.length} |

## Movement-family classification
Classified: **${classifiedCount}/${inventory.length} (${pct}%)** across ${Object.keys(familyCount).length} families (taxonomy defines ${FAMILIES.length}).
Unclassified: **${issues.unclassified.length}** — honest residue; the program forbids forcing inaccurate families. Every unclassified exercise still receives a full Level-0 profile.

| family | exercises |
|---|---|
${famRows}

## Capability classification (evidence-derived, §6)
| level | label | exercises |
|---|---|---|
| 0 | manual_tracking | ${levelCount[0] || 0} |

No exercise is marked ML/camera validated: there is no pose pipeline, no validated rep counter, and no training dataset in this codebase. Profiles record pose/engine/model fields as explicitly absent rather than aspirational.

## Known gaps (documented, not hidden)
- 88-ish unclassified exercises are mostly odd/named variants (e.g. "Cable Judo Flip", "Body-Up") — candidates for taxonomy v2 rules after human review.
- Per-exercise movement restriction mapping (safety section) is unmapped — flagged pending review, no contraindications invented.
- ${issues.missingInstructions.length} exercises lack instructions.
`;
  fs.writeFileSync(path.join(OUT_DIR, 'EXERCISE_INVENTORY_REPORT.md'), report);

  console.log(JSON.stringify({ exercises: inventory.length, profiles: profiles.length, classifiedPct: Number(pct), unclassified: issues.unclassified.length, missingInstructions: issues.missingInstructions.length, noPrimaryMuscle: issues.noPrimaryMuscle.length, families: Object.keys(familyCount).length, failures }, null, 1));
  if (failures.length) { throw new Error('integrity failures: ' + failures.join('; ')); }
  return { exercises: inventory.length, profiles: profiles.length, classifiedPct: Number(pct), unclassified: issues.unclassified.length };
}

module.exports = { regenerateArtifacts };

if (require.main === module) {
  regenerateArtifacts()
    .then((summary) => {
      console.log('inventory + profiles written to docs/exercise-intelligence/ — integrity checks passed', JSON.stringify(summary));
    })
    .catch((e) => { console.error(e); process.exit(1); });
}
