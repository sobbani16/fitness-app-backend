// Seeds the safety engine: health conditions, condition rules, ingredient attributes,
// supplement attributes, and supplement rules.
// Run with: node prisma/seed-safety.js

const { getPrisma } = require('../src/lib/prisma');

// ============================================================================
// Health Conditions
// ============================================================================
const CONDITIONS = [
  { name: 'Type 2 Diabetes', description: 'Impaired insulin sensitivity and blood sugar regulation.' },
  { name: 'Type 1 Diabetes', description: 'Autoimmune destruction of insulin-producing cells.' },
  { name: 'Hypothyroidism', description: 'Underactive thyroid gland.' },
  { name: 'Hyperthyroidism', description: 'Overactive thyroid gland.' },
  { name: 'CKD', description: 'Chronic Kidney Disease — reduced kidney function.' },
  { name: 'Hypertension', description: 'High blood pressure.' },
  { name: 'GERD', description: 'Gastroesophageal reflux disease.' },
  { name: 'Celiac Disease', description: 'Autoimmune reaction to gluten.' },
  { name: 'Nut Allergy', description: 'Allergic reaction to tree nuts and/or peanuts.' },
  { name: 'Shellfish Allergy', description: 'Allergic reaction to shellfish.' },
  { name: 'Dairy Allergy', description: 'Allergic reaction to dairy proteins.' },
  { name: 'Egg Allergy', description: 'Allergic reaction to eggs.' },
  { name: 'Soy Allergy', description: 'Allergic reaction to soy.' },
  { name: 'Gout', description: 'Elevated uric acid causing joint inflammation.' },
  { name: 'IBS', description: 'Irritable Bowel Syndrome.' },
  { name: 'Pregnancy', description: 'Currently pregnant.' },
];

// ============================================================================
// Condition Rules: maps conditions to ingredient/supplement attributes
// ============================================================================
const CONDITION_RULES = [
  // Type 2 Diabetes
  { condition: 'Type 2 Diabetes', attribute: 'HIGH_SUGAR', target: 'ingredient', action: 'block', reason: 'High sugar foods spike blood glucose.' },
  { condition: 'Type 2 Diabetes', attribute: 'HIGH_GLYCEMIC', target: 'ingredient', action: 'warn', reason: 'High glycemic foods may cause blood sugar spikes.' },
  { condition: 'Type 2 Diabetes', attribute: 'HIGH_SUGAR', target: 'supplement', action: 'block', reason: 'Supplements with high sugar are unsafe for diabetics.' },
  { condition: 'Type 2 Diabetes', attribute: 'DIABETES_CAUTION', target: 'supplement', action: 'warn', reason: 'This supplement may affect blood sugar levels.' },

  // Type 1 Diabetes (same rules)
  { condition: 'Type 1 Diabetes', attribute: 'HIGH_SUGAR', target: 'ingredient', action: 'block', reason: 'High sugar foods spike blood glucose.' },
  { condition: 'Type 1 Diabetes', attribute: 'HIGH_GLYCEMIC', target: 'ingredient', action: 'warn', reason: 'High glycemic foods may cause blood sugar spikes.' },

  // Hypothyroidism
  { condition: 'Hypothyroidism', attribute: 'GOITROGENIC', target: 'ingredient', action: 'warn', reason: 'Goitrogenic foods may interfere with thyroid function when consumed in excess.' },
  { condition: 'Hypothyroidism', attribute: 'THYROID_CAUTION', target: 'supplement', action: 'warn', reason: 'This supplement may interfere with thyroid medication.' },

  // Hyperthyroidism
  { condition: 'Hyperthyroidism', attribute: 'CONTAINS_IODINE', target: 'ingredient', action: 'warn', reason: 'Excess iodine may worsen hyperthyroidism.' },
  { condition: 'Hyperthyroidism', attribute: 'CONTAINS_CAFFEINE', target: 'supplement', action: 'warn', reason: 'Caffeine may exacerbate hyperthyroid symptoms.' },

  // CKD (Chronic Kidney Disease)
  { condition: 'CKD', attribute: 'HIGH_POTASSIUM', target: 'ingredient', action: 'block', reason: 'High potassium is dangerous with reduced kidney function.' },
  { condition: 'CKD', attribute: 'HIGH_PHOSPHORUS', target: 'ingredient', action: 'block', reason: 'High phosphorus accelerates kidney damage.' },
  { condition: 'CKD', attribute: 'HIGH_SODIUM', target: 'ingredient', action: 'warn', reason: 'High sodium increases kidney workload.' },
  { condition: 'CKD', attribute: 'HIGH_POTASSIUM', target: 'supplement', action: 'block', reason: 'Potassium supplementation is dangerous with CKD.' },

  // Hypertension
  { condition: 'Hypertension', attribute: 'HIGH_SODIUM', target: 'ingredient', action: 'block', reason: 'Excess sodium raises blood pressure.' },
  { condition: 'Hypertension', attribute: 'HIGH_SODIUM', target: 'supplement', action: 'block', reason: 'Sodium in supplements worsens hypertension.' },
  { condition: 'Hypertension', attribute: 'CONTAINS_CAFFEINE', target: 'supplement', action: 'warn', reason: 'Caffeine may temporarily raise blood pressure.' },

  // GERD
  { condition: 'GERD', attribute: 'ACIDIC', target: 'ingredient', action: 'warn', reason: 'Acidic foods may trigger acid reflux.' },
  { condition: 'GERD', attribute: 'SPICY', target: 'ingredient', action: 'warn', reason: 'Spicy foods often worsen GERD symptoms.' },
  { condition: 'GERD', attribute: 'HIGH_FAT', target: 'ingredient', action: 'warn', reason: 'High-fat foods can relax the lower esophageal sphincter.' },

  // Celiac
  { condition: 'Celiac Disease', attribute: 'CONTAINS_GLUTEN', target: 'ingredient', action: 'block', reason: 'Gluten triggers autoimmune damage in celiac disease.' },
  { condition: 'Celiac Disease', attribute: 'CONTAINS_GLUTEN', target: 'supplement', action: 'block', reason: 'Gluten in supplements can trigger celiac reaction.' },

  // Allergies
  { condition: 'Nut Allergy', attribute: 'NUT', target: 'ingredient', action: 'block', reason: 'Contains tree nuts or peanuts — allergen.' },
  { condition: 'Shellfish Allergy', attribute: 'SHELLFISH', target: 'ingredient', action: 'block', reason: 'Contains shellfish — allergen.' },
  { condition: 'Dairy Allergy', attribute: 'DAIRY', target: 'ingredient', action: 'block', reason: 'Contains dairy — allergen.' },
  { condition: 'Egg Allergy', attribute: 'EGG', target: 'ingredient', action: 'block', reason: 'Contains egg — allergen.' },
  { condition: 'Soy Allergy', attribute: 'SOY', target: 'ingredient', action: 'block', reason: 'Contains soy — allergen.' },

  // Gout
  { condition: 'Gout', attribute: 'HIGH_PURINE', target: 'ingredient', action: 'warn', reason: 'High purine foods increase uric acid.' },

  // Pregnancy
  { condition: 'Pregnancy', attribute: 'PREGNANCY_CAUTION', target: 'supplement', action: 'block', reason: 'Not safe during pregnancy.' },
  { condition: 'Pregnancy', attribute: 'CONTAINS_CAFFEINE', target: 'supplement', action: 'warn', reason: 'Limit caffeine during pregnancy (max 200mg/day).' },
  { condition: 'Pregnancy', attribute: 'HIGH_MERCURY', target: 'ingredient', action: 'block', reason: 'High mercury fish is unsafe during pregnancy.' },
];

// ============================================================================
// Supplement Attributes (mapped to existing supplement names)
// ============================================================================
const SUPPLEMENT_ATTRIBUTES = [
  { supplement: 'Caffeine', attributes: ['CONTAINS_CAFFEINE'] },
  { supplement: 'Pre-Workout', attributes: ['CONTAINS_CAFFEINE', 'HIGH_SODIUM'] },
  { supplement: 'Electrolytes', attributes: ['HIGH_SODIUM', 'HIGH_POTASSIUM'] },
  { supplement: 'Potassium', attributes: ['HIGH_POTASSIUM'] },
  { supplement: 'Calcium', attributes: ['THYROID_CAUTION'] },
  { supplement: 'Iron', attributes: ['THYROID_CAUTION'] },
  { supplement: 'Fish oil', attributes: ['BLOOD_THINNER_INTERACTION'] },
  { supplement: 'Omega-3', attributes: ['BLOOD_THINNER_INTERACTION'] },
  { supplement: 'Mass Gainer', attributes: ['HIGH_SUGAR', 'DIABETES_CAUTION'] },
  { supplement: 'Ashwagandha', attributes: ['THYROID_CAUTION', 'PREGNANCY_CAUTION'] },
  { supplement: 'Melatonin', attributes: ['PREGNANCY_CAUTION'] },
  { supplement: 'Creatine', attributes: [] },
  { supplement: 'Whey Protein', attributes: ['DAIRY'] },
  { supplement: 'Casein Protein', attributes: ['DAIRY'] },
];

// ============================================================================
// Supplement Rules (timing/interaction rules)
// ============================================================================
const SUPPLEMENT_RULES = [
  {
    supplement: 'Calcium',
    condition: 'Hypothyroidism',
    ruleType: 'timing',
    description: 'Take calcium at least 4 hours apart from thyroid medication (levothyroxine).',
    gapHours: 4,
    conflictsWith: 'Thyroid medication (levothyroxine)',
  },
  {
    supplement: 'Iron',
    condition: 'Hypothyroidism',
    ruleType: 'timing',
    description: 'Take iron at least 4 hours apart from thyroid medication.',
    gapHours: 4,
    conflictsWith: 'Thyroid medication (levothyroxine)',
  },
  {
    supplement: 'Iron',
    condition: null,
    ruleType: 'interaction',
    description: 'Do not take iron with calcium, dairy, or coffee — they reduce absorption.',
    gapHours: 2,
    conflictsWith: 'Calcium, dairy, coffee',
  },
  {
    supplement: 'Calcium',
    condition: null,
    ruleType: 'interaction',
    description: 'Do not take calcium and iron at the same time — they compete for absorption.',
    gapHours: 2,
    conflictsWith: 'Iron supplements',
  },
  {
    supplement: 'Fish oil',
    condition: null,
    ruleType: 'interaction',
    description: 'Fish oil may increase bleeding risk with blood thinners (warfarin, aspirin).',
    gapHours: null,
    conflictsWith: 'Blood thinners (warfarin, aspirin)',
  },
  {
    supplement: 'Ashwagandha',
    condition: 'Hypothyroidism',
    ruleType: 'interaction',
    description: 'Ashwagandha may increase thyroid hormone levels — monitor closely.',
    gapHours: null,
    conflictsWith: 'Thyroid medication',
  },
  {
    supplement: 'Caffeine',
    condition: 'Hypertension',
    ruleType: 'contraindication',
    description: 'High-dose caffeine may elevate blood pressure. Limit to 200mg/day.',
    gapHours: null,
    conflictsWith: null,
  },
];

// ============================================================================
// Ingredient Attributes (for seeded ingredients)
// ============================================================================
const INGREDIENT_ATTRIBUTES = [
  // From existing seed data
  { fdcId: 'dummy-10', attributes: ['HIGH_FAT', 'NUT'] },            // Almonds
  { fdcId: 'dummy-6', attributes: ['HIGH_PROTEIN', 'HIGH_MERCURY'] }, // Salmon (some types)
  { fdcId: 'dummy-5', attributes: ['HIGH_PROTEIN', 'EGG'] },         // Eggs
  { fdcId: 'dummy-9', attributes: ['CONTAINS_GLUTEN'] },             // Oats (cross-contamination)
  { fdcId: 'dummy-4', attributes: ['HIGH_SUGAR', 'HIGH_GLYCEMIC'] }, // Banana
  { fdcId: 'dummy-7', attributes: ['HIGH_GLYCEMIC'] },               // Sweet potato (moderate GI)
  { fdcId: 'dummy-8', attributes: ['DAIRY', 'HIGH_PROTEIN'] },       // Greek yogurt
  { fdcId: 'dummy-14', attributes: ['GOITROGENIC'] },                // Spinach (mild)
  { fdcId: 'dummy-3', attributes: ['GOITROGENIC'] },                 // Broccoli
  { fdcId: 'dummy-11', attributes: ['HIGH_FAT'] },                   // Avocado
  { fdcId: 'dummy-12', attributes: ['HIGH_PROTEIN', 'VEGETARIAN'] }, // Chickpeas
  { fdcId: 'dummy-13', attributes: ['VEGETARIAN', 'VEGAN'] },        // Quinoa
  { fdcId: 'dummy-15', attributes: ['HIGH_PROTEIN', 'DAIRY'] },      // Whey protein powder
  { fdcId: 'dummy-1', attributes: ['HIGH_PROTEIN'] },                // Chicken breast
  { fdcId: 'dummy-2', attributes: ['HIGH_GLYCEMIC'] },               // Brown rice
];

// ============================================================================
// Main
// ============================================================================
async function main() {
  const prisma = getPrisma();

  // 1. Seed health conditions
  console.log('Seeding health conditions...');
  const conditionMap = {};
  for (const c of CONDITIONS) {
    const row = await prisma.healthCondition.upsert({
      where: { name: c.name },
      update: { description: c.description },
      create: c,
    });
    conditionMap[c.name] = row.id;
  }
  console.log(`  ✓ ${CONDITIONS.length} conditions`);

  // 2. Seed condition rules
  console.log('Seeding condition rules...');
  let rulesCount = 0;
  for (const r of CONDITION_RULES) {
    const conditionId = conditionMap[r.condition];
    if (!conditionId) { console.warn(`  ⚠ Condition not found: ${r.condition}`); continue; }
    await prisma.conditionRule.upsert({
      where: { conditionId_attribute_target: { conditionId, attribute: r.attribute, target: r.target } },
      update: { action: r.action, reason: r.reason },
      create: { conditionId, attribute: r.attribute, target: r.target, action: r.action, reason: r.reason },
    });
    rulesCount++;
  }
  console.log(`  ✓ ${rulesCount} condition rules`);

  // 3. Seed supplement attributes
  console.log('Seeding supplement attributes...');
  let suppAttrCount = 0;
  for (const sa of SUPPLEMENT_ATTRIBUTES) {
    const supp = await prisma.supplement.findUnique({ where: { name: sa.supplement } });
    if (!supp) { console.warn(`  ⚠ Supplement not found: ${sa.supplement}`); continue; }
    for (const attr of sa.attributes) {
      await prisma.supplementAttribute.upsert({
        where: { supplementId_attribute: { supplementId: supp.id, attribute: attr } },
        update: {},
        create: { supplementId: supp.id, attribute: attr },
      });
      suppAttrCount++;
    }
  }
  console.log(`  ✓ ${suppAttrCount} supplement attributes`);

  // 4. Seed supplement rules
  console.log('Seeding supplement rules...');
  let suppRulesCount = 0;
  for (const sr of SUPPLEMENT_RULES) {
    const supp = await prisma.supplement.findUnique({ where: { name: sr.supplement } });
    if (!supp) { console.warn(`  ⚠ Supplement not found: ${sr.supplement}`); continue; }
    const conditionId = sr.condition ? conditionMap[sr.condition] || null : null;
    await prisma.supplementRule.create({
      data: {
        supplementId: supp.id,
        conditionId,
        ruleType: sr.ruleType,
        description: sr.description,
        gapHours: sr.gapHours,
        conflictsWith: sr.conflictsWith,
      },
    });
    suppRulesCount++;
  }
  console.log(`  ✓ ${suppRulesCount} supplement rules`);

  // 5. Seed ingredient attributes
  console.log('Seeding ingredient attributes...');
  let ingAttrCount = 0;
  for (const ia of INGREDIENT_ATTRIBUTES) {
    const ing = await prisma.ingredient.findUnique({ where: { fdcId: ia.fdcId } });
    if (!ing) { console.warn(`  ⚠ Ingredient not found (fdcId): ${ia.fdcId}`); continue; }
    for (const attr of ia.attributes) {
      await prisma.ingredientAttribute.upsert({
        where: { ingredientId_attribute: { ingredientId: ing.id, attribute: attr } },
        update: {},
        create: { ingredientId: ing.id, attribute: attr },
      });
      ingAttrCount++;
    }
  }
  console.log(`  ✓ ${ingAttrCount} ingredient attributes`);

  console.log('\n✅ Safety engine seeded successfully!');
}

main()
  .then(async () => { await getPrisma().$disconnect(); })
  .catch(async (err) => { console.error(err); await getPrisma().$disconnect(); process.exit(1); });
