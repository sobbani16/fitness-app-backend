// Seed exercise-intelligence profiles for the FSM-benchmarked exercises.
// Spec §33 onboarding discipline: profiles start from REAL validated
// capabilities only — the six exercises whose rep-counter FSM passed the
// synthetic labeled-stream benchmark (mobile docs/audits/rep-benchmark.json,
// 99 rows deterministic). No capability is invented: repCounting validated,
// everything else draft. Idempotent: existing versions are never mutated —
// re-runs only create missing version-1 rows.
//
// Usage: node scripts/seed-exercise-intelligence.js [--apply]  (dry-run default)
const { getPrisma } = require('../src/lib/prisma');

const SEED = [
  { normalizedName: 'squat', movementFamily: 'squat', secondary: ['compound_full_body'], subtype: 'barbell' },
  { normalizedName: 'barbell bench press', movementFamily: 'horizontal_push', secondary: [], subtype: 'barbell' },
  { normalizedName: 'push-up', movementFamily: 'horizontal_push', secondary: ['compound_full_body'], subtype: 'bodyweight' },
  { normalizedName: 'overhead press', movementFamily: 'vertical_push', secondary: [], subtype: 'barbell' },
  { normalizedName: 'deadlift', movementFamily: 'deadlift', secondary: ['hip_hinge'], subtype: 'barbell' },
  { normalizedName: 'barbell row', movementFamily: 'horizontal_pull', secondary: [], subtype: 'barbell' },
];

const CAPABILITIES = JSON.stringify({
  repCounting: { status: 'validated', engine: 'rep-counter-fsm', engineVersion: '1' },
  holdTracking: { status: 'draft' },
  formObservation: { status: 'draft' },
});

async function main() {
  const apply = process.argv.includes('--apply');
  const prisma = getPrisma();
  const report = { created: [], skippedMissingExercise: [], alreadyPresent: [], dryRun: !apply };
  for (const seed of SEED) {
    const exercise = await prisma.exercise.findUnique({ where: { normalizedName: seed.normalizedName } });
    if (!exercise) { report.skippedMissingExercise.push(seed.normalizedName); continue; }
    const existing = await prisma.exerciseIntelligenceProfile.findUnique({
      where: { exerciseId_version: { exerciseId: exercise.id, version: 1 } },
    });
    if (existing) { report.alreadyPresent.push(seed.normalizedName); continue; }
    if (apply) {
      await prisma.exerciseIntelligenceProfile.create({
        data: {
          exerciseId: exercise.id,
          version: 1,
          movementFamily: seed.movementFamily,
          secondaryFamilies: JSON.stringify(seed.secondary),
          movementSubtype: seed.subtype,
          trackingMethod: 'rep_counter_fsm',
          coachingCapability: 'basic',
          capabilities: CAPABILITIES,
          status: 'validated',
          notes: 'repCounting validated via synthetic labeled-stream FSM benchmark — not human-camera accuracy',
        },
      });
    }
    report.created.push(seed.normalizedName);
  }
  console.log(JSON.stringify(report, null, 1));
  if (!apply) console.log('dry-run — pass --apply to write');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
