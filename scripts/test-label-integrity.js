// Deliberately restricted to the disposable local UX database.
const assert = require('node:assert/strict');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (url.hostname !== '127.0.0.1' || !url.pathname.startsWith('/fitness_ux_m2_')) throw new Error('Use a disposable local fitness_ux_m2_ database');
const { getPrisma } = require('../src/lib/prisma');
const { saveScannedLabel } = require('../src/services/labelScannerService');
const prisma = getPrisma();
const nonce = require('node:crypto').randomUUID();
(async () => {
  const user = await prisma.user.create({ data: { email: `${nonce}@example.test` } });
  const other = await prisma.user.create({ data: { email: `other-${nonce}@example.test` } });
  const data = { id: `label-${nonce}`, productName: 'Test oats', servingSizeG: 100, actualPortionG: 150,
    labelCalories: 200, labelProteinG: 10, labelCarbsG: 30, labelFatG: 4, labelFiberG: null, labelSugarG: 0, mealType: 'lunch' };
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => saveScannedLabel(user.id, data)));
    assert.equal(new Set(results.map(result => result.foodLog.id)).size, 1);
    assert.equal(await prisma.foodLog.count({ where: { userId: user.id } }), 1);
    assert.equal(results[0].foodLog.calories, 300);
    assert.equal(results[0].foodLog.fiberG, null);
    assert.equal(results[0].scannedLabel.labelSugarG, 0);
    console.log('PASS concurrent retries: one meal; 200 kcal/100 g × 150 g = 300; unknown fiber retained');
    await assert.rejects(() => saveScannedLabel(other.id, data), error => error.status === 409);
    console.log('PASS ownership conflict cannot expose another account label');
    await assert.rejects(() => saveScannedLabel(user.id, { ...data, id: `invalid-${nonce}`, photoUri: {} }));
    assert.equal(await prisma.foodLog.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.scannedLabel.count({ where: { userId: user.id } }), 1);
    console.log('PASS label insert failure rolls back food log atomically');
    const restored = await prisma.foodLog.findMany({ where: { userId: user.id } });
    assert.equal(restored[0].fiberG, null);
    console.log('PASS database round trip preserves unknown nutrient');
    await prisma.foodLog.delete({ where: { id: restored[0].id } });
    await assert.rejects(() => saveScannedLabel(user.id, data), error => error.status === 410);
    console.log('PASS retry does not recreate a deleted meal');
  } finally {
    await prisma.scannedLabel.deleteMany({ where: { userId: { in: [user.id, other.id] } } });
    await prisma.foodLog.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
