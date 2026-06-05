// Seeds the default supplement catalog.
// Run with:  npm run db:seed   (requires DATABASE_URL + migrated schema)

const { getPrisma } = require('../src/lib/prisma');

const DEFAULT_SUPPLEMENTS = [
  { name: 'Creatine', category: 'Performance', defaultDose: '5 g' },
  { name: 'Fish oil', category: 'General health', defaultDose: '1-2 g' },
  { name: 'Vitamin D', category: 'Vitamin', defaultDose: '1000-2000 IU' },
  { name: 'Protein', category: 'Macronutrient', defaultDose: '1 scoop' },
  { name: 'Multivitamin', category: 'Vitamin', defaultDose: '1 tablet' },
];

async function main() {
  const prisma = getPrisma();
  for (const s of DEFAULT_SUPPLEMENTS) {
    await prisma.supplement.upsert({
      where: { name: s.name },
      update: { category: s.category, defaultDose: s.defaultDose, isDefault: true },
      create: { ...s, isDefault: true },
    });
  }
  console.log(`Seeded ${DEFAULT_SUPPLEMENTS.length} default supplements.`);
}

main()
  .then(async () => {
    await getPrisma().$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await getPrisma().$disconnect();
    process.exit(1);
  });
