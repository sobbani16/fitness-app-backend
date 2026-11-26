// Regression guard for NUTR-004: run AFTER tests/mealSuggest.test.js (the
// filename sorts after it) to assert that suite leaves no shared-table
// residue — no `ms*` fixtures, no 'Test Fixture' RuleEvidence, no
// source='test-fixture' ingredients. Run twice in a row against the same
// disposable test DB; both runs must stay at zero.
const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();

describe('mealSuggest fixture residue (NUTR-004)', () => {
  it('leaves no ms*-prefixed rows in shared tables', async () => {
    const counts = {
      ingredients: await prisma.ingredient.count({ where: { name: { startsWith: 'ms' } } }),
      healthConditions: await prisma.healthCondition.count({ where: { name: { startsWith: 'ms' } } }),
      allergies: await prisma.allergy.count({ where: { name: { startsWith: 'ms' } } }),
      recipes: await prisma.recipe.count({ where: { recipeName: { startsWith: 'ms' } } }),
      users: await prisma.user.count({ where: { email: { startsWith: 'ms' } } }),
      ruleEvidence: await prisma.ruleEvidence.count({ where: { code: { startsWith: 'ms' } } }),
    };
    expect(counts).toEqual({ ingredients: 0, healthConditions: 0, allergies: 0, recipes: 0, users: 0, ruleEvidence: 0 });
  });

  it('leaves no fixture-marked rows behind', async () => {
    expect(await prisma.ruleEvidence.count({ where: { organization: 'Test Fixture' } })).toBe(0);
    expect(await prisma.ingredient.count({ where: { source: 'test-fixture' } })).toBe(0);
  });
});
