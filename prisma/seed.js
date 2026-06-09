// Seeds the default supplement catalog.
// Run with:  npm run db:seed   (requires DATABASE_URL + migrated schema)

const { getPrisma } = require('../src/lib/prisma');

const DEFAULT_SUPPLEMENTS = [
  { name: 'Creatine', category: 'Performance', defaultDose: '5 g', servingSizeG: 5, calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Fish oil', category: 'General health', defaultDose: '1-2 g', servingSizeG: 2, calories: 18, proteinG: 0, carbsG: 0, fatG: 2, fiberG: 0 },
  { name: 'Vitamin D', category: 'Vitamin', defaultDose: '1000-2000 IU', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Whey Protein', category: 'Macronutrient', brand: 'Optimum Nutrition', flavor: 'Double Rich Chocolate', defaultDose: '1 scoop (31g)', servingSizeG: 31, calories: 120, proteinG: 24, carbsG: 3, fatG: 1.5, fiberG: 1 },
  { name: 'Multivitamin', category: 'Vitamin', defaultDose: '1 tablet', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Magnesium', category: 'Mineral', defaultDose: '200-400 mg', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Zinc', category: 'Mineral', defaultDose: '15-30 mg', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Vitamin C', category: 'Vitamin', defaultDose: '500-1000 mg', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Vitamin B12', category: 'Vitamin', defaultDose: '1000 mcg', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Iron', category: 'Mineral', defaultDose: '18 mg', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Calcium', category: 'Mineral', defaultDose: '500-1000 mg', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Ashwagandha', category: 'Adaptogen', brand: 'KSM-66', defaultDose: '300-600 mg', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Caffeine', category: 'Performance', defaultDose: '100-200 mg', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'L-Theanine', category: 'Amino acid', defaultDose: '100-200 mg', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Omega-3', category: 'General health', defaultDose: '1-2 g', servingSizeG: 2, calories: 18, proteinG: 0, carbsG: 0, fatG: 2, fiberG: 0 },
  { name: 'Collagen Peptides', category: 'General health', brand: 'Vital Proteins', defaultDose: '2 scoops (20g)', servingSizeG: 20, calories: 70, proteinG: 18, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Glutamine', category: 'Amino acid', defaultDose: '5 g', servingSizeG: 5, calories: 20, proteinG: 5, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'BCAA', category: 'Amino acid', defaultDose: '5-10 g', servingSizeG: 10, calories: 40, proteinG: 10, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Beta-Alanine', category: 'Performance', defaultDose: '3-5 g', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Citrulline Malate', category: 'Performance', defaultDose: '6-8 g', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Electrolytes', category: 'General health', brand: 'LMNT', defaultDose: '1 packet', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Probiotics', category: 'Gut health', defaultDose: '1 capsule', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Melatonin', category: 'Sleep', defaultDose: '1-3 mg', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Biotin', category: 'Vitamin', defaultDose: '5000 mcg', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Turmeric / Curcumin', category: 'Anti-inflammatory', defaultDose: '500 mg', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'CoQ10', category: 'General health', defaultDose: '100-200 mg', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Potassium', category: 'Mineral', defaultDose: '99 mg', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Vitamin K2', category: 'Vitamin', defaultDose: '100 mcg', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Spirulina', category: 'Superfood', defaultDose: '3-5 g', servingSizeG: 5, calories: 15, proteinG: 3, carbsG: 1, fatG: 0.5, fiberG: 0.2 },
  { name: 'Apple Cider Vinegar', category: 'General health', defaultDose: '1-2 tbsp', calories: 3, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  { name: 'Casein Protein', category: 'Macronutrient', brand: 'Optimum Nutrition', flavor: 'Chocolate Supreme', defaultDose: '1 scoop (34g)', servingSizeG: 34, calories: 120, proteinG: 24, carbsG: 3, fatG: 1, fiberG: 0 },
  { name: 'Mass Gainer', category: 'Macronutrient', brand: 'Serious Mass', flavor: 'Chocolate', defaultDose: '2 scoops (167g)', servingSizeG: 167, calories: 627, proteinG: 25, carbsG: 126, fatG: 2.5, fiberG: 1 },
  { name: 'Pre-Workout', category: 'Performance', brand: 'C4 Original', flavor: 'Fruit Punch', defaultDose: '1 scoop (6.5g)', servingSizeG: 6.5, calories: 5, proteinG: 0, carbsG: 1, fatG: 0, fiberG: 0 },
];

async function main() {
  const prisma = getPrisma();
  for (const s of DEFAULT_SUPPLEMENTS) {
    await prisma.supplement.upsert({
      where: { name: s.name },
      update: {
        category: s.category,
        brand: s.brand || null,
        flavor: s.flavor || null,
        defaultDose: s.defaultDose,
        servingSizeG: s.servingSizeG || null,
        calories: s.calories || 0,
        proteinG: s.proteinG || 0,
        carbsG: s.carbsG || 0,
        fatG: s.fatG || 0,
        fiberG: s.fiberG || 0,
        isDefault: true,
      },
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
