// Idempotent importer for licensed exercise datasets.
// Source: free-exercise-db (public dataset). Vendored copy at data/exercises.json
// so re-imports never re-download. Run: node scripts/import-exercises.js
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { canonicalMuscle, canonicalEquipment, slugify } = require('../src/services/muscles');

const prisma = new PrismaClient();
const DATA = path.join(__dirname, '..', 'data', 'exercises.json');
const PATCH = path.join(__dirname, '..', 'data', 'exercise-metadata-patch.json');

async function main() {
  const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  // Verified/provenance-tracked overlay for upstream-null metadata (Phase 19
  // Workstream A). Source file stays pristine; patch entries cite the
  // source-internal convention used for each inferred value.
  const patch = fs.existsSync(PATCH) ? JSON.parse(fs.readFileSync(PATCH, 'utf8')) : { patches: [] };
  const patchByName = new Map(patch.patches.map(p => [p.name, p]));
  let patched = 0;
  for (const raw of rows) {
    const p = patchByName.get(raw.name);
    if (!p) continue;
    if (!raw.mechanic && p.mechanic) raw.mechanic = p.mechanic;
    if (!raw.equipment && p.equipment) raw.equipment = p.equipment;
    patched++;
  }
  if (patched) console.log(`Applied ${patched} provenance-tracked metadata patch(es)`);
  const seen = new Set();
  let imported = 0, skipped = 0;
  for (const raw of rows) {
    const name = String(raw.name || '').trim();
    const id = slugify(name);
    if (!name || seen.has(id)) { skipped++; continue; }
    seen.add(id);
    const primary = [...new Set((raw.primaryMuscles || []).flatMap(canonicalMuscle))];
    const secondary = [...new Set((raw.secondaryMuscles || []).flatMap(canonicalMuscle))]
      .filter(m => !primary.includes(m));
    const appEquipment = [...new Set([raw.equipment].filter(Boolean).map(canonicalEquipment))];
    await prisma.exercise.upsert({
      where: { normalizedName: id },
      update: {
        name, level: raw.level || null, force: raw.force || null,
        mechanic: raw.mechanic || null, equipment: raw.equipment || null,
        appEquipment, category: raw.category || null,
        instructions: raw.instructions || [], sourceId: raw.id || null,
      },
      create: {
        id, normalizedName: id, name, level: raw.level || null,
        force: raw.force || null, mechanic: raw.mechanic || null,
        equipment: raw.equipment || null, appEquipment,
        category: raw.category || null, instructions: raw.instructions || [],
        source: 'free-exercise-db', sourceId: raw.id || null,
      },
    });
    await prisma.exerciseMuscle.deleteMany({ where: { exerciseId: id } });
    await prisma.exerciseMuscle.createMany({
      data: [
        ...primary.map(m => ({ exerciseId: id, muscle: m, role: 'primary' })),
        ...secondary.map(m => ({ exerciseId: id, muscle: m, role: 'secondary' })),
      ],
      skipDuplicates: true,
    });
    imported++;
  }
  console.log(`Imported ${imported} exercises (${skipped} duplicates/invalid skipped)`);

  // Auto-onboarding (pc-HUM-101): every catalog write regenerates the versioned
  // profile artifact so newly imported exercises immediately carry draft
  // intelligence profiles (auto_generated_unreviewed) in the CI-audited snapshot.
  // Skip with --no-onboard for partial/dev imports where regen is handled separately.
  if (!process.argv.includes('--no-onboard')) {
    const { regenerateProfileArtifacts } = require('../src/services/exercise/onboarding');
    const summary = await regenerateProfileArtifacts();
    console.log(`Auto-onboarding: profile artifact regenerated — ${summary.profiles} draft profiles cover ${summary.exercises} exercises`);
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
