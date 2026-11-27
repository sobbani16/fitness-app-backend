// HUM-4 F-1 — correct the impossible zero-energy row for a 5% glucose solution.
// Basis: the product's own labeled composition — 5% glucose in water means
// 5 g carbohydrate per 100 g; glucose yields 4 kcal/g → 20 kcal/100g. This is
// arithmetic from the label, not an inferred or proxied conversion.
// Dry-run default; --apply writes the single named row inside one transaction.
require('dotenv').config({ quiet: true });
const { getPrisma } = require('../src/lib/prisma');
const p = getPrisma();
const APPLY = process.argv.includes('--apply');
(async () => {
  const row = await p.ingredient.findFirst({ where: { name: { contains: 'Fluid replacement, 5% glucose', mode: 'insensitive' } } });
  if (!row) { console.log('SKIP: row not found'); process.exit(0); }
  console.log(`before: ${row.name} kcal=${row.caloriesPer100g} carbs=${row.carbsPer100g} protein=${row.proteinPer100g} fat=${row.fatPer100g} fiber=${row.fiberPer100g}`);
  const after = { caloriesPer100g: 20, carbsPer100g: 5, proteinPer100g: 0, fatPer100g: 0 };
  console.log(`after:  kcal=20 carbs=5 protein=0 fat=0 (5% w/v glucose — label arithmetic)`);
  if (!APPLY) { console.log('DRY RUN — pass --apply to write'); process.exit(0); }
  const host = ((process.env.DATABASE_URL || '').match(/@([^:/]+)/) || [])[1] || '';
  if (!/^(localhost|127\.0\.0\.1|::1)$/i.test(host)) { console.error(`REFUSING non-local apply (${host})`); process.exit(2); }
  await p.$transaction(async (tx) => {
    await tx.ingredient.update({ where: { id: row.id }, data: after });
    const check = await tx.ingredient.findUnique({ where: { id: row.id } });
    if (check.caloriesPer100g !== 20 || check.carbsPer100g !== 5) throw new Error('verify-after-write failed');
    console.log('APPLIED + VERIFIED');
  });
  console.log(`ROLLBACK: UPDATE "Ingredient" SET "caloriesPer100g" = ${row.caloriesPer100g}, "carbsPer100g" = ${row.carbsPer100g} WHERE id = '${row.id}';`);
  await p.$disconnect();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
