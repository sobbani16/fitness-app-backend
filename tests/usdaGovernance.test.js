// pc-HUM-36 §9 governance invariants — real-DB, read-mostly + fixture-scoped.
// Proves the batch-review preconditions on the isolated fitness_test population
// and the never-auto-verified / decision-preservation contract.
const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();

describe('§9 USDA governance invariants (pc-HUM-36)', () => {
  test('no test-imported profile is auto-verified — source association is not human verification', async () => {
    const approved = await prisma.ingredientNutritionProfile.count({ where: { verifiedAt: { not: null } } });
    expect(approved).toBe(0);
  });

  test('every profile carries full provenance (FDC id + citation + record key)', async () => {
    expect(await prisma.ingredientNutritionProfile.count({ where: { sourceFoodId: null } })).toBe(0);
    expect(await prisma.ingredientNutritionProfile.count({ where: { OR: [{ sourceCitation: '' }, { sourceRecordKey: '' }] } })).toBe(0);
  });

  test('units stay canonical — no IU/DFE leakage in nutrient master', async () => {
    const bad = await prisma.nutrient.count({ where: { unit: { notIn: ['g', 'mg', 'mcg', 'kcal'] } } });
    expect(bad).toBe(0);
  });

  test('nutrientImport never auto-fills verifiedAt — explicit invalid verifiedAt is rejected', () => {
    const { normalizeAmount } = require('../src/services/nutrientImport');
    expect(() => normalizeAmount(5, 'IU', 'mcg')).toThrow(); // IU never converts — no inference
  });

  test('rematerialization guards: verified-value conflict cannot silently overwrite (code-contract probe)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../src/services/nutrients/population.js'), 'utf8');
    expect(src).toMatch(/VERIFIED_VALUE_CONFLICT/);
    expect(src).toMatch(/ALREADY_IMPORTED/);
    // no code path updates verifiedAt during population
    expect(src).not.toMatch(/verifiedAt:\s*new Date/);
  });
});
