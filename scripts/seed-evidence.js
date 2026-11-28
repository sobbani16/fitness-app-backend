// Controlled, idempotent evidence-profile seed job.
//
// Runs the same repairSeeds() the service uses lazily, but as an explicit
// operator step (deploy/QA/local bootstrap) instead of a user-facing request
// path. Safe to re-run: inserts missing profiles as NEEDS_REVIEW and refreshes
// + demotes stale seeded rows; human-set APPROVED/ACTIVE on non-seed rows is
// untouched (repairSeeds only manages seed-owned ingredientKeys).
//
// Usage: node scripts/seed-evidence.js
require('dotenv').config({ quiet: true });
const { getPrisma } = require('../src/lib/prisma');
const { repairSeeds, EVIDENCE_SEED } = require('../src/services/foodIntel');

(async () => {
  const p = getPrisma();
  const before = await p.ingredientEvidenceProfile.groupBy({ by: ['status'], _count: true });
  await repairSeeds();
  const after = await p.ingredientEvidenceProfile.groupBy({ by: ['status'], _count: true });
  console.log(JSON.stringify({
    seedProfiles: EVIDENCE_SEED.length,
    before: Object.fromEntries(before.map((r) => [r.status, r._count])),
    after: Object.fromEntries(after.map((r) => [r.status, r._count])),
    note: 'seeded rows are NEEDS_REVIEW — publication requires editorial approval via /super-admin/ingredient-evidence',
  }, null, 2));
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
