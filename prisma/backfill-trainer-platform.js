// Backfills trainer-platform data consistency after the advanced-trainer
// migration:
//   1. verified trainer profiles -> applicationStatus 'approved' + approvedAt
//   2. TrainerProfile.certifications (legacy String[]) -> TrainerCertification
//      rows with verificationStatus 'legacy'
//   3. TrainerClient rows in status active/paused -> TrainerClientConsent rows
//      for every consent category, status 'granted', policyVersion 'v0-legacy'
//
// Idempotent: every write is keyed on a natural key (upsert / findFirst), and
// existing consent rows are never modified — a client may have revoked since.
// Run with: node prisma/backfill-trainer-platform.js

const { getPrisma } = require('../src/lib/prisma');
const { CONSENT_CATEGORIES } = require('../src/services/trainerAccess');

// 1. verified trainers -> approved application status
async function backfillApplicationStatus(prisma) {
  console.log('Backfilling application status for verified trainers...');
  const profiles = await prisma.trainerProfile.findMany({
    where: { verified: true, OR: [{ applicationStatus: { not: 'approved' } }, { approvedAt: null }] },
    select: { id: true, approvedAt: true },
  });
  for (const p of profiles) {
    await prisma.trainerProfile.update({
      where: { id: p.id },
      data: { applicationStatus: 'approved', approvedAt: p.approvedAt || new Date() },
    });
  }
  console.log(`  ✓ ${profiles.length} trainer profiles marked approved`);
}

// 2. TrainerProfile.certifications String[] -> TrainerCertification 'legacy' rows
async function backfillCertifications(prisma) {
  console.log('Backfilling legacy certifications...');
  const profiles = await prisma.trainerProfile.findMany({
    where: { certifications: { isEmpty: false } },
    select: { id: true, certifications: true },
  });
  let created = 0, skipped = 0;
  for (const profile of profiles) {
    for (const raw of profile.certifications) {
      const name = (raw || '').trim();
      if (!name) continue;
      // No unique constraint on (trainerId, name) — skipExisting via findFirst.
      const existing = await prisma.trainerCertification.findFirst({
        where: { trainerId: profile.id, name },
        select: { id: true },
      });
      if (existing) { skipped++; continue; }
      await prisma.trainerCertification.create({
        data: { trainerId: profile.id, name, verificationStatus: 'legacy' },
      });
      created++;
    }
  }
  console.log(`  ✓ certifications: ${created} created, ${skipped} already present`);
}

// 3. active/paused relations -> v0-legacy granted consents for all categories
async function backfillConsents(prisma) {
  console.log('Backfilling v0-legacy consents for active/paused relations...');
  const relations = await prisma.trainerClient.findMany({
    where: { status: { in: ['active', 'paused'] } },
    select: { id: true, startedAt: true },
  });
  let upserted = 0;
  for (const rel of relations) {
    for (const category of CONSENT_CATEGORIES) {
      await prisma.trainerClientConsent.upsert({
        where: { relationId_category: { relationId: rel.id, category } },
        // skipExisting: never overwrite an explicit grant/revoke written later.
        update: {},
        create: {
          relationId: rel.id,
          category,
          status: 'granted',
          policyVersion: 'v0-legacy',
          grantedAt: rel.startedAt,
        },
      });
      upserted++;
    }
  }
  console.log(`  ✓ ${upserted} consent rows ensured across ${relations.length} relations (${CONSENT_CATEGORIES.length} categories each)`);
}

async function main() {
  const prisma = getPrisma();
  await backfillApplicationStatus(prisma);
  await backfillCertifications(prisma);
  await backfillConsents(prisma);
  console.log('\n✅ Trainer platform backfill complete!');
}

main()
  .then(async () => { await getPrisma().$disconnect(); })
  .catch(async (err) => { console.error(err); await getPrisma().$disconnect(); process.exit(1); });
