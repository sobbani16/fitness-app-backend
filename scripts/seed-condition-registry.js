// Seed the condition registry onto HealthCondition rows: assigns stable
// slugs/categories/evidenceClass from conditionRegistry.js and materializes
// registry entries that have no catalog row yet. Idempotent — safe to re-run.
// Catalog metadata only; no user data touched.
require('dotenv').config();
const { getPrisma } = require('../src/lib/prisma');
const R = require('../src/services/healthOutcomes/conditionRegistry');

async function main() {
  const prisma = getPrisma();
  let updated = 0, created = 0;
  for (const [slug, meta] of Object.entries(R.REGISTRY)) {
    const data = { slug, category: meta.category, evidenceClass: meta.evidenceClass, educationSummary: meta.education, registryMeta: { engineKey: meta.engineKey || null } };
    const bySlug = await prisma.healthCondition.findUnique({ where: { slug } });
    if (bySlug) { await prisma.healthCondition.update({ where: { id: bySlug.id }, data }); updated++; continue; }
    // Match an existing row by name or alias before creating a duplicate.
    const names = [meta.name, ...(meta.aliases || [])];
    const existing = await prisma.healthCondition.findFirst({ where: { OR: names.map(n => ({ name: { equals: n, mode: 'insensitive' } })) } });
    if (existing) { await prisma.healthCondition.update({ where: { id: existing.id }, data: { ...data, name: meta.name } }); updated++; continue; }
    await prisma.healthCondition.create({ data: { name: meta.name, ...data } });
    created++;
  }
  console.log(`condition registry seeded: ${updated} updated, ${created} created, ${R.SLUGS.length} registry entries`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
