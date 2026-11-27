// Retained reconciliation checks — pc-HUM-20.
// Exercises the production recompute/drift logic now shared via
// src/services/recipeReconcile.js (used by scripts/recipe-nutrition-audit.js).
// Pure functions — no DB fixtures required.
const { KEYS, DRIFT_PCT, recompute, driftPct } = require('../src/services/recipeReconcile');

const ing = (over = {}) => ({ caloriesPer100g: 100, proteinPer100g: 10, carbsPer100g: 20, fatPer100g: 5, fiberPer100g: 2, ...over });
const line = (ingredientId, amountG) => ({ ingredientId, amountG });

describe('recipeReconcile.recompute', () => {
  test('resolved lines recompute to per-serving macros (1/servings scale)', () => {
    const byId = new Map([['a', ing()], ['b', ing({ caloriesPer100g: 200, fiberPer100g: 8 })]]);
    const r = recompute({ servings: 2, ingredients: [line('a', 100), line('b', 50)] }, byId);
    // a: 100g→cal 100, p10, c20, f5, fib2 · b: 50g→cal 100, p5, c10, f2.5, fib4 → /2 servings
    expect(r).toMatchObject({ calories: 100, proteinG: 7.5, carbsG: 15, fatG: 3.75, fiberG: 3, _computedLines: 2, _unresolvedLines: 0 });
  });

  test('finishedYieldG + portionG scales batch totals to the served portion', () => {
    const byId = new Map([['a', ing({ caloriesPer100g: 200, fiberPer100g: 4 })]]);
    const r = recompute({ servings: 4, finishedYieldG: 500, portionG: 250, ingredients: [line('a', 500)] }, byId);
    // batch: 500g → cal 1000, fib 20; scale 250/500 = 0.5
    expect(r).toMatchObject({ calories: 500, fiberG: 10 });
  });

  test('yield-derived portion used when portionG absent', () => {
    const byId = new Map([['a', ing({ caloriesPer100g: 200 })]]);
    const r = recompute({ servings: 2, finishedYieldG: 400, ingredients: [line('a', 400)] }, byId);
    expect(r.calories).toBe(400); // portion 200/400 = 0.5 → 800*0.5
  });

  test('fiber unknown is not zero — null when no line carries fiberPer100g', () => {
    const byId = new Map([['a', ing({ fiberPer100g: null })]]);
    const r = recompute({ servings: 1, ingredients: [line('a', 100)] }, byId);
    expect(r.fiberG).toBeNull();
    expect(r.calories).toBe(100); // other macros still compute
  });

  test('one fiber-carrying line makes fiber a real sum, not inflated by null lines', () => {
    const byId = new Map([['a', ing({ fiberPer100g: 4 })], ['b', ing({ fiberPer100g: null })]]);
    const r = recompute({ servings: 1, ingredients: [line('a', 100), line('b', 100)] }, byId);
    expect(r.fiberG).toBe(4); // only a contributes; b stays out of the sum
  });

  test('unresolved lines are counted and exclude the recipe from repair eligibility', () => {
    const byId = new Map([['a', ing()]]);
    const r = recompute({ servings: 1, ingredients: [line('a', 100), line(null, 50), line('ghost', 50)] }, byId);
    expect(r._unresolvedLines).toBe(2);
    expect(r._computedLines).toBe(1);
  });

  test('ingredient with null caloriesPer100g counts as unresolved', () => {
    const byId = new Map([['a', ing({ caloriesPer100g: null })]]);
    const r = recompute({ servings: 1, ingredients: [line('a', 100)] }, byId);
    expect(r).toBeNull(); // no computed lines → nothing to recompute
  });

  test('no resolvable lines → null (script skips these entirely)', () => {
    expect(recompute({ servings: 1, ingredients: [line('ghost', 10)] }, new Map())).toBeNull();
    expect(recompute({ servings: 0, ingredients: [line('a', 10)] }, new Map([['a', ing()]]))).toBeNull();
  });
});

describe('recipeReconcile.driftPct', () => {
  test('below/at/above the 5% repair threshold', () => {
    expect(driftPct(100, 104)).toBe(4); // below DRIFT_PCT → no drift
    expect(driftPct(100, 105)).toBe(5); // exactly at → still not >5
    expect(driftPct(100, 106)).toBe(6); // above → flagged
    expect(DRIFT_PCT).toBe(5);
  });
  test('stored 0 vs recomputed 0 is no drift; stored 0 vs nonzero is unbounded', () => {
    expect(driftPct(0, 0)).toBe(0);
    expect(driftPct(0, 5)).toBe(Infinity);
  });
  test('null on either side → null (not comparable, never auto-flagged)', () => {
    expect(driftPct(null, 5)).toBeNull();
    expect(driftPct(5, null)).toBeNull();
  });
  test('KEYS excludes fiber — fiber drift is reported, not a repair trigger', () => {
    expect(KEYS).toEqual(['calories', 'proteinG', 'carbsG', 'fatG']);
  });
});
