// Idempotent importer for licensed exercise datasets.
// Source: free-exercise-db (public dataset). Vendored copy at data/exercises.json
// so re-imports never re-download. Run: node scripts/import-exercises.js
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { canonicalMuscle, canonicalEquipment, slugify } = require('../src/services/muscles');

const prisma = new PrismaClient();
const DATA = path.join(__dirname, '..', 'data', 'exercises.json');

async function main() {
  const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
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
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
