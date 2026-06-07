// Seeds the default supplement catalog.
// Run with:  npm run db:seed   (requires DATABASE_URL + migrated schema)

const { getPrisma } = require('../src/lib/prisma');

const DEFAULT_SUPPLEMENTS = [
  { name: 'Creatine', category: 'Performance', defaultDose: '5 g' },
  { name: 'Fish oil', category: 'General health', defaultDose: '1-2 g' },
  { name: 'Vitamin D', category: 'Vitamin', defaultDose: '1000-2000 IU' },
  { name: 'Protein', category: 'Macronutrient', defaultDose: '1 scoop' },
  { name: 'Multivitamin', category: 'Vitamin', defaultDose: '1 tablet' },
  { name: 'Magnesium', category: 'Mineral', defaultDose: '200-400 mg' },
  { name: 'Zinc', category: 'Mineral', defaultDose: '15-30 mg' },
  { name: 'Vitamin C', category: 'Vitamin', defaultDose: '500-1000 mg' },
  { name: 'Vitamin B12', category: 'Vitamin', defaultDose: '1000 mcg' },
  { name: 'Iron', category: 'Mineral', defaultDose: '18 mg' },
  { name: 'Calcium', category: 'Mineral', defaultDose: '500-1000 mg' },
  { name: 'Ashwagandha', category: 'Adaptogen', defaultDose: '300-600 mg' },
  { name: 'Caffeine', category: 'Performance', defaultDose: '100-200 mg' },
  { name: 'L-Theanine', category: 'Amino acid', defaultDose: '100-200 mg' },
  { name: 'Omega-3', category: 'General health', defaultDose: '1-2 g' },
  { name: 'Collagen', category: 'General health', defaultDose: '10-15 g' },
  { name: 'Glutamine', category: 'Amino acid', defaultDose: '5 g' },
  { name: 'BCAA', category: 'Amino acid', defaultDose: '5-10 g' },
  { name: 'Beta-Alanine', category: 'Performance', defaultDose: '3-5 g' },
  { name: 'Citrulline', category: 'Performance', defaultDose: '6-8 g' },
  { name: 'Electrolytes', category: 'General health', defaultDose: '1 serving' },
  { name: 'Probiotics', category: 'Gut health', defaultDose: '1 capsule' },
  { name: 'Melatonin', category: 'Sleep', defaultDose: '1-3 mg' },
  { name: 'Biotin', category: 'Vitamin', defaultDose: '5000 mcg' },
  { name: 'Turmeric / Curcumin', category: 'Anti-inflammatory', defaultDose: '500 mg' },
  { name: 'CoQ10', category: 'General health', defaultDose: '100-200 mg' },
  { name: 'Potassium', category: 'Mineral', defaultDose: '99 mg' },
  { name: 'Vitamin K2', category: 'Vitamin', defaultDose: '100 mcg' },
  { name: 'Spirulina', category: 'Superfood', defaultDose: '3-5 g' },
  { name: 'Apple Cider Vinegar', category: 'General health', defaultDose: '1-2 tbsp' },
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
