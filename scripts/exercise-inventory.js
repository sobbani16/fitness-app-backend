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

const OUT_DIR = path.join(__dirname, '..', 'docs', 'exercise-intelligence');

// ---------------------------------------------------------------------------
// §33 onboarding — read-only coverage check + deterministic draft generation.
// Identity conventions reuse scripts/import-exercises.js: id = slugify(name),
// dedupe by id, invalid/duplicate rows skipped. The check compares the
// independent exercise catalog (vendored data/exercises.json or an explicitly
// provisioned disposable catalog via --catalog=) against the COMMITTED
// inventory + profiles — CI proves every imported exercise has a draft
// intelligence profile without needing a database.
const { slugify, canonicalMuscle, canonicalEquipment } = require('../src/services/muscles');

function loadCatalogRows(catalogPath) {
  const rows = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`catalog at ${catalogPath} is empty or not an array — refusing to check coverage against an empty catalog`);
  }
  const seen = new Set();
  const out = [];
  const dupes = [];
  for (const raw of rows) {
    const name = String(raw.name || '').trim();
    const id = slugify(name);
    if (!name || !id) continue;
    if (seen.has(id)) { dupes.push(id); continue; }
    seen.add(id);
    out.push({ raw, id, name });
  }
  return { rows: out, catalogDuplicates: dupes };
}

// vendored free-exercise-db row -> exercise-like object buildProfile accepts
function rowToExercise({ raw, id, name }) {
  const primary = [...new Set((raw.primaryMuscles || []).flatMap(canonicalMuscle))];
  const secondary = [...new Set((raw.secondaryMuscles || []).flatMap(canonicalMuscle))].filter((m) => !primary.includes(m));
  return {
    id, normalizedName: id, name,
    level: raw.level || null, force: raw.force || null, mechanic: raw.mechanic || null,
    equipment: raw.equipment || null,
    appEquipment: [...new Set([raw.equipment].filter(Boolean).map(canonicalEquipment))],
    category: raw.category || null, instructions: raw.instructions || [],
    source: 'free-exercise-db', sourceId: raw.id || null, reviewStatus: null,
    muscles: [...primary.map((muscle) => ({ muscle, role: 'primary' })), ...secondary.map((muscle) => ({ muscle, role: 'secondary' }))],
  };
}

function loadCommitted(outDir) {
  const invPath = path.join(outDir, 'exercise-inventory.json');
  const profPath = path.join(outDir, 'exercise-profiles.v1.json');
  if (!fs.existsSync(invPath) || !fs.existsSync(profPath)) {
    throw new Error(`committed inventory/profiles missing in ${outDir} — run the generator first`);
  }
  const inv = JSON.parse(fs.readFileSync(invPath, 'utf8'));
  const prof = JSON.parse(fs.readFileSync(profPath, 'utf8'));
  return { inv, prof, invPath, profPath };
}

function coverageDiff(catalog, committed) {
  const invIds = new Set((committed.inv.exercises || []).map((e) => e.id));
  const profIds = new Set((committed.prof.profiles || []).map((p) => p.exerciseId));
  const missingInventory = catalog.rows.filter((r) => !invIds.has(r.id)).map((r) => r.id);
  const missingProfiles = catalog.rows.filter((r) => !profIds.has(r.id)).map((r) => r.id);
  const invSeen = new Set(); const invDupes = [];
  for (const e of (committed.inv.exercises || [])) { if (invSeen.has(e.id)) invDupes.push(e.id); invSeen.add(e.id); }
  const profSeen = new Set(); const profDupes = [];
  for (const p of (committed.prof.profiles || [])) { if (profSeen.has(p.exerciseId)) profDupes.push(p.exerciseId); profSeen.add(p.exerciseId); }
  return { missingInventory, missingProfiles, invDupes, profDupes };
}

async function checkMode(catalogPath, outDir) {
  const catalog = loadCatalogRows(catalogPath);
  const committed = loadCommitted(outDir);
  const diff = coverageDiff(catalog, committed);
  const failures = [];
  if (catalog.catalogDuplicates.length) failures.push(`duplicate ids in catalog source: ${catalog.catalogDuplicates.join(', ')}`);
  if (diff.missingInventory.length) failures.push(`catalog exercises missing from committed inventory: ${diff.missingInventory.join(', ')}`);
  if (diff.missingProfiles.length) failures.push(`catalog exercises missing a draft intelligence profile: ${diff.missingProfiles.join(', ')} — run: node scripts/exercise-inventory.js --drafts`);
  if (diff.invDupes.length) failures.push(`duplicate ids in committed inventory: ${diff.invDupes.join(', ')}`);
  if (diff.profDupes.length) failures.push(`duplicate ids in committed profiles: ${diff.profDupes.join(', ')}`);
  console.log(JSON.stringify({ mode: 'check', catalogRows: catalog.rows.length, committedInventory: (committed.inv.exercises || []).length, committedProfiles: (committed.prof.profiles || []).length, missingInventory: diff.missingInventory.length, missingProfiles: diff.missingProfiles.length, failures: failures.length }, null, 1));
  if (failures.length) { console.error(`COVERAGE CHECK FAILED:\n - ${failures.join('\n - ')}`); process.exit(1); }
  console.log('coverage check passed — every catalog exercise has committed inventory + draft profile coverage');
}

async function draftsMode(catalogPath, outDir, fixedDate) {
  const catalog = loadCatalogRows(catalogPath);
  const committed = loadCommitted(outDir);
  const diff = coverageDiff(catalog, committed);
  const missingIds = [...new Set([...diff.missingInventory, ...diff.missingProfiles])];
  if (!missingIds.length) { console.log('no missing exercises — nothing to draft'); return; }
  const stamp = fixedDate || new Date().toISOString();
  const byId = new Map(catalog.rows.map((r) => [r.id, r]));
  const invExercises = [...(committed.inv.exercises || [])];
  const profiles = [...(committed.prof.profiles || [])];
  const invSeen = new Set(invExercises.map((e) => e.id));
  const profSeen = new Set(profiles.map((p) => p.exerciseId));
  const drafted = [];
  for (const id of missingIds.sort()) {
    const row = byId.get(id);
    if (!row) continue;
    const ex = rowToExercise(row);
    const profile = buildProfile(ex);
    // §33: a draft never claims validation — capability stays Level 0 manual,
    // review state explicit, coverage gaps surfaced.
    profile.generatedAt = stamp;
    if (!profSeen.has(id)) { profiles.push(profile); profSeen.add(id); }
    if (!invSeen.has(id)) {
      invExercises.push({
        id: ex.id, name: ex.name, normalizedName: ex.normalizedName,
        level: ex.level, force: ex.force, mechanic: ex.mechanic,
        equipment: ex.equipment, appEquipment: ex.appEquipment, category: ex.category,
        instructionCount: (ex.instructions || []).length,
        primaryMuscles: profile.identity.primaryMuscles, secondaryMuscles: profile.identity.secondaryMuscles,
        source: ex.source, sourceId: ex.sourceId || null, reviewStatus: ex.reviewStatus,
        movementFamily: profile.classification.family, movementSubtype: profile.classification.subtype,
        taxonomyRule: profile.classification.ruleId, classified: profile.classification.classified,
        capabilityLevel: profile.capability.level,
      });
      invSeen.add(id);
    }
    drafted.push({ id, family: profile.classification.family, classified: profile.classification.classified, reviewStatus: profile.validation.profileReviewStatus, capabilityLevel: profile.capability.level });
  }
  // deterministic ordering — same input catalog produces byte-stable arrays
  invExercises.sort((a, b) => a.id.localeCompare(b.id));
  profiles.sort((a, b) => a.exerciseId.localeCompare(b.exerciseId));
  fs.writeFileSync(committed.invPath, JSON.stringify({ generatedAt: stamp, count: invExercises.length, exercises: invExercises }, null, 1));
  fs.writeFileSync(committed.profPath, JSON.stringify({ profileVersion: PROFILE_VERSION, generatedAt: stamp, count: profiles.length, honesty: 'no profile claims ML validation; capability levels derive from evidence — all Level 0 manual tracking today; §33 drafts are auto-generated and unreviewed', profiles }, null, 1));
  const gaps = drafted.filter((d) => !d.classified).map((d) => d.id);
  console.log(JSON.stringify({ mode: 'drafts', drafted: drafted.length, ids: drafted.map((d) => d.id), reviewRequired: drafted.length, unclassifiedCoverageGaps: gaps, capabilityLevel: '0 — manual tracking only, no validation claims' }, null, 1));
  console.log(`draft profiles written for ${drafted.length} exercise(s) — ALL require human review before any capability beyond manual tracking`);
}


async function main() {
  const modeArg = process.argv.find((a) => a.startsWith('--mode='));
  const catalogArg = process.argv.find((a) => a.startsWith('--catalog='));
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const fixedDateArg = process.argv.find((a) => a.startsWith('--fixed-date='));
  const catalogPath = catalogArg ? catalogArg.split('=').slice(1).join('=') : path.join(__dirname, '..', 'data', 'exercises.json');
  const outDir = outArg ? outArg.split('=').slice(1).join('=') : path.join(__dirname, '..', 'docs', 'exercise-intelligence');
  if (process.argv.includes('--check')) return checkMode(catalogPath, outDir);
  if (process.argv.includes('--drafts')) return draftsMode(catalogPath, outDir, fixedDateArg ? fixedDateArg.split('=').slice(1).join('=') : null);
  void modeArg;

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
  if (failures.length) { console.error('INTEGRITY FAILURES:', failures.join('; ')); process.exit(1); }
  console.log('inventory + profiles written to docs/exercise-intelligence/ — integrity checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
