// Idempotent importer for licensed exercise datasets.
// Source: free-exercise-db (public dataset). Vendored copy at data/exercises.json
// so re-imports never re-download. Run: node scripts/import-exercises.js
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { canonicalMuscle, canonicalEquipment, slugify } = require('../src/services/muscles');

const prisma = new PrismaClient();
const catalogArg = process.argv.find((a) => a.startsWith('--catalog='));
const DATA = catalogArg ? catalogArg.split('=').slice(1).join('=') : path.join(__dirname, '..', 'data', 'exercises.json');
const PATCH = path.join(__dirname, '..', 'data', 'exercise-metadata-patch.json');

// §33 automatic onboarding: after a successful upsert + muscle mapping, stage
// exactly one deterministic draft profile + coverage entry per exercise ID.
// Reuses the profiles builder + onboarding staging helper — no parallel
// implementation. Failures in staging never roll back the exercise import
// itself; they are reported so the draft can be recovered on retry.
const DRAFTS_OUT = path.join(__dirname, '..', 'docs', 'exercise-intelligence');

async function importRow(prisma, raw, stageDraft) {
  const name = String(raw.name || '').trim();
  const id = slugify(name);
  if (!name || !id) return { skipped: true };
  const primary = [...new Set((raw.primaryMuscles || []).flatMap(canonicalMuscle))];
  const secondary = [...new Set((raw.secondaryMuscles || []).flatMap(canonicalMuscle))]
    .filter(m => !primary.includes(m));
  const appEquipment = [...new Set([raw.equipment].filter(Boolean).map(canonicalEquipment))];
  const persisted = await prisma.exercise.upsert({
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
  // The persisted row id is authoritative — an existing row matched on
  // normalizedName may carry a legacy id that differs from the derived slug.
  // Muscle writes, draft identity/provenance and the result must all use it;
  // never rekey the exercise itself.
  const pid = persisted.id;
  await prisma.exerciseMuscle.deleteMany({ where: { exerciseId: pid } });
  await prisma.exerciseMuscle.createMany({
    data: [
      ...primary.map(m => ({ exerciseId: pid, muscle: m, role: 'primary' })),
      ...secondary.map(m => ({ exerciseId: pid, muscle: m, role: 'secondary' })),
    ],
    skipDuplicates: true,
  });
  let draft = null;
  if (stageDraft) {
    const { stageExerciseDraft } = require('./exercise-inventory');
    draft = stageExerciseDraft({
      id: pid, normalizedName: persisted.normalizedName || id, name, level: raw.level || null,
      force: raw.force || null, mechanic: raw.mechanic || null,
      equipment: raw.equipment || null, appEquipment,
      category: raw.category || null, instructions: raw.instructions || [],
      source: persisted.source || 'free-exercise-db', sourceId: raw.id || null, reviewStatus: persisted.reviewStatus || null,
      muscles: [...primary.map((muscle) => ({ muscle, role: 'primary' })), ...secondary.map((muscle) => ({ muscle, role: 'secondary' }))],
    }, stageDraft.outDir || DRAFTS_OUT, { fixedDate: stageDraft.fixedDate });
  }
  return { id: pid, draft };
}

async function importCatalog(prisma, rows, opts = {}) {
  let imported = 0, skipped = 0;
  const drafts = [];
  const seen = new Set();
  for (const raw of rows) {
    const name = String(raw.name || '').trim();
    const id = slugify(name);
    if (!name || seen.has(id)) { skipped++; continue; }
    seen.add(id);
    try {
      const r = await importRow(prisma, raw, opts.stageDraft === false ? null : (opts.stageDraft || {}));
      imported++;
      if (r.draft) drafts.push({ id: r.id, ...r.draft });
    } catch (e) {
      // a failed import produces no draft — the row is reported, never half-staged
      skipped++;
      console.error(`import failed for ${id}: ${String(e.message || e).slice(0, 120)} — no draft staged`);
    }
  }
  return { imported, skipped, drafts };
}

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
  const { imported, skipped, drafts } = await importCatalog(prisma, rows, {});
  console.log(`Imported ${imported} exercises (${skipped} duplicates/invalid skipped)`);
  const staged = drafts.filter((d) => d.staged);
  console.log(`§33 onboarding: ${staged.length} draft profile(s) staged for review — Level 0 manual tracking only, no validated capabilities; retries recover missing drafts without duplication`);
}

module.exports = { importCatalog, importRow };

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
