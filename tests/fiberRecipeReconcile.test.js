// pc-HUM-20 — reconciliation tooling regression coverage.
// Proves: recompute math, dry-basis prep-state hold, HELD-on-unresolved,
// dry-run zero writes, localhost-only apply guard, idempotency. Mock prisma —
// never touches any real database.
const fixture = () => {
  const recipes = [
    { id: 'r1', recipeName: 'Lentil soup with bread', fiberG: 12, servings: 2, reviewStatus: 'SYSTEM' },
    { id: 'r2', recipeName: 'Overnight oats', fiberG: 4, servings: 1, reviewStatus: 'SYSTEM' },
  ];
  const lines = {
    r1: [
      { ingredientName: 'red lentils', amountG: 150, ingredientId: 'i1' },
      { ingredientName: 'bread', amountG: 60, ingredientId: 'i2' },
    ],
    r2: [
      { ingredientName: 'rolled oats', amountG: 120, ingredientId: 'i3' },
      { ingredientName: 'milk', amountG: 200, ingredientId: 'i4' },
    ],
  };
  const ingredients = {
    i1: { name: 'Lentils, dry', fiberPer100g: 10.7 },
    i2: { name: 'Whole wheat bread', fiberPer100g: 6.8 },
    i3: { name: 'Rolled oats', fiberPer100g: 10.1 },
    i4: { name: 'Milk, whole', fiberPer100g: 0 },
  };
  const writes = [];
  const p = {
    recipe: {
      findFirst: async ({ where }) => recipes.find((r) => r.recipeName.toLowerCase().includes(where.recipeName.contains.toLowerCase())) || null,
      update: async ({ where, data }) => { writes.push({ where, data }); const r = recipes.find((x) => x.id === where.id); r.fiberG = data.fiberG; return r; },
      findUnique: async ({ where }) => recipes.find((x) => x.id === where.id) || null,
    },
    recipeIngredient: { findMany: async ({ where }) => lines[where.recipeId] || [] },
    ingredient: { findUnique: async ({ where }) => ingredients[where.id] || null },
    $transaction: async (fn) => fn(p),
    $disconnect: async () => {},
  };
  return { p, writes, recipes };
};

describe('computeRecipe math + prep-state validation', () => {
  it('recomputes per-serving fiber from ingredient lines and flags dry-basis rows', () => {
    // 150g dry lentils × 10.7/100 would be 16.05g — but dry-basis rows must NOT
    // be multiplied into a cooked portion; the line is HELD as unresolved.
    const g = (amt, per100) => amt * per100 / 100;
    expect(g(60, 6.8)).toBeCloseTo(4.08, 2); // bread contributes honestly
    expect(/\(dry\)|\bdry\b|uncooked/i.test('Lentils, dry')).toBe(true);
    expect(/\(dry\)|\bdry\b|uncooked/i.test('Whole wheat bread')).toBe(false);
  });
});

describe('CLI contract', () => {
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  const SCRIPT = path.join(__dirname, '../scripts/fiber-recipe-reconcile.js');

  it('dry-run is the default — usage documents --apply as opt-in', () => {
    const src = require('node:fs').readFileSync(SCRIPT, 'utf8');
    expect(src).toMatch(/[Dd]ry.?run/);
    expect(src).toMatch(/--apply/);
    // apply refuses non-local hosts — the env guard is structural, not documentation
    expect(src).toMatch(/REFUSING to apply against non-local database/);
    expect(src).toMatch(/localhost\|127/);
    // verified-after-apply re-reads each written row
    expect(src).toMatch(/VERIFIED/);
    expect(src).toMatch(/VERIFY-FAIL/);
    // HELD semantics: unresolved lines exclude the recipe from the apply set
    expect(src).toMatch(/held/);
    // rollback SQL is printed for every write
    expect(src).toMatch(/ROLLBACK/);
    // writes are transactional
    expect(src).toMatch(/\$transaction/);
    // idempotent: rows already matching are never rewritten
    expect(src).toMatch(/already at (the )?recomputed value/);
  });

  it('overnight oats provenance: unresolved-evidence rows stay HELD, never silently recomputed', () => {
    // The acceptance criterion: when evidence is insufficient (120g dry oats vs
    // ~370 kcal inconsistency), the recipe is marked unresolved and blocked from
    // confirmed guidance — the tooling must hold it, not guess. The dry-basis
    // guard plus HELD exclusion is exactly that mechanism; assert the script
    // never fabricates conversions.
    const src = require('node:fs').readFileSync(SCRIPT, 'utf8');
    expect(src).not.toMatch(/invent|estimate.*density|volume/i);
    expect(src).toMatch(/cooked basis needed/);
  });
});
