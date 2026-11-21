// Idempotent upsert of data/scenarioRegistry.json → ScenarioDefinition.
// reviewStatus stays pending_review until a qualified reviewer approves.
const { getPrisma } = require('../src/lib/prisma');
const registry = require('../data/scenarioRegistry.json');

async function main() {
  const prisma = getPrisma();
  let upserted = 0;
  for (const s of registry.scenarios) {
    await prisma.scenarioDefinition.upsert({
      where: { id: s.id },
      create: { id: s.id, category: s.category, priority: s.priority, expected: s.expected, data: { expected: s.expected } },
      update: { category: s.category, priority: s.priority, expected: s.expected },
    });
    upserted++;
  }
  const p0 = await prisma.scenarioDefinition.count({ where: { priority: 'P0' } });
  console.log(JSON.stringify({ upserted, p0, reviewStatus: 'pending_review' }));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
