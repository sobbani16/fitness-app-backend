// Re-materializes the usda-preview-1 review batch into fitness_test after a
// test-DB reseed wiped the inserted rows. Read-only by default; pass --apply
// to write. Refuses to run unless DATABASE_URL points at fitness_test.
// Idempotent: profiles upsert on deterministic identityKey (= sourceRecordKey),
// ingredient binding remapped by fdcId (reseed rotates UUIDs).
const { PrismaClient } = require('@prisma/client');
const manifest = require('../data/usda-preview-manifest.json');
const APPLY = process.argv.includes('--apply');

const MACRO = new Set(['ENERGY_KCAL', 'PROTEIN', 'FAT_TOTAL', 'FAT_SATURATED', 'FAT_TRANS', 'CARBOHYDRATE_TOTAL', 'SUGAR_TOTAL', 'FIBER', 'CHOLESTEROL']);
const MINERAL = new Set(['CALCIUM', 'IRON', 'MAGNESIUM', 'PHOSPHORUS', 'POTASSIUM', 'SODIUM', 'ZINC', 'SELENIUM', 'IODINE']);
const categoryOf = (code) => (MACRO.has(code) ? 'MACRO' : MINERAL.has(code) ? 'MINERAL' : code.startsWith('VITAMIN') || code === 'FOLATE_TOTAL' ? 'VITAMIN' : 'OTHER');

(async () => {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes('fitness_test')) {
    console.error('REFUSED: DATABASE_URL must target fitness_test'); process.exit(1);
  }
  const prisma = new PrismaClient();
  const rows = manifest.rows;
  const missing = [];
  const plan = [];
  for (const r of rows) {
    const ing = await prisma.ingredient.findUnique({ where: { fdcId: r.fdcId } });
    if (!ing) { missing.push(`${r.name} (${r.fdcId})`); continue; }
    plan.push({ r, ingredientId: ing.id });
  }
  console.log(`plan: ${plan.length}/${rows.length} profiles; missing ingredients: ${missing.length}`);
  missing.forEach(m => console.log('  MISSING', m));
  if (!APPLY) { console.log('dry run — pass --apply to write'); await prisma.$disconnect(); return; }

  await prisma.$transaction(async (tx) => {
    for (const code of manifest.summary.codesUsed) {
      const unit = (rows.flatMap(r => r.nutrients).find(n => n.code === code) || {}).unit || 'g';
      await tx.nutrient.upsert({ where: { code }, update: {}, create: { code, name: code.replace(/_/g, ' ').toLowerCase(), unit, category: categoryOf(code) } });
    }
    for (const { r, ingredientId } of plan) {
      const p = r.profile;
      const profile = await tx.ingredientNutritionProfile.upsert({
        where: { identityKey: p.sourceRecordKey },
        update: {},
        create: {
          ingredientId, preparationType: p.preparationType, source: p.source, sourceFoodId: p.sourceFoodId,
          sourceDataset: p.sourceDataset, sourceRecordKey: p.sourceRecordKey, sourceCitation: p.sourceCitation,
          identityKey: p.sourceRecordKey,
        },
      });
      for (const n of r.nutrients) {
        const nut = await tx.nutrient.findUnique({ where: { code: n.code } });
        await tx.ingredientNutrient.upsert({
          where: { nutritionProfileId_nutrientId: { nutritionProfileId: profile.id, nutrientId: nut.id } },
          update: {}, create: { nutritionProfileId: profile.id, nutrientId: nut.id, amountPer100g: n.amount },
        });
      }
    }
  });
  const count = await prisma.ingredientNutritionProfile.count({ where: { sourceDataset: 'usda_fdc_usda-preview-1' } });
  console.log(`done: ${count} usda-preview-1 profiles present, all verifiedAt NULL`);
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
