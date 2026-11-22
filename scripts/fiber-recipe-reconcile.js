// Fiber recipe reconciliation — Stage 2 data-quality follow-up.
//
// Recomputes Recipe.fiberG (per serving) from RecipeIngredient lines ×
// Ingredient.fiberPer100g for the six SYSTEM recipes whose stored values
// drifted from their ingredient sums (FIBER_DATA_AUDIT §8.2.1).
//
// SAFETY CONTRACT:
//   - Dry-run by default: prints before/after + computation + rollback SQL.
//   - `--apply` writes ONLY the six named recipe rows, inside one transaction,
//     and prints inverse UPDATEs for rollback. Review the diff first.
//   - Never run against a shared/production database without the catalog
//     owner's sign-off recorded in the rollout tracker.
//
// Usage:
//   node scripts/fiber-recipe-reconcile.js           # dry-run report
//   node scripts/fiber-recipe-reconcile.js --apply   # apply (dev DB only)
require('dotenv').config({ quiet: true });
const { getPrisma } = require('../src/lib/prisma');

const TARGETS = [
  'Lentil soup with bread',
  'Greek yogurt with granola',
  'Eggs and whole wheat toast',
  'Salmon with quinoa',
  'Avocado toast with egg',
  'Overnight oats',
];

async function computeRecipe(p, recipe) {
  const lines = await p.recipeIngredient.findMany({
    where: { recipeId: recipe.id },
    select: { ingredientName: true, amountG: true, ingredientId: true },
  });
  let total = 0;
  const parts = [];
  const unresolved = [];
  for (const l of lines) {
    if (!l.ingredientId) { unresolved.push(l.ingredientName); continue; }
    const ing = await p.ingredient.findUnique({ where: { id: l.ingredientId }, select: { name: true, fiberPer100g: true } });
    if (!ing || ing.fiberPer100g == null) { unresolved.push(l.ingredientName); continue; }
    const g = (Number(l.amountG) || 0) * ing.fiberPer100g / 100;
    total += g;
    parts.push(`${l.ingredientName}: ${l.amountG}g × ${ing.fiberPer100g}/100g = ${g.toFixed(2)}g`);
  }
  const servings = recipe.servings || 1;
  return { perServing: total / servings, parts, unresolved };
}

(async () => {
  const apply = process.argv.includes('--apply');
  const p = getPrisma();
  const url = process.env.DATABASE_URL || '';
  const host = (url.match(/@([^:/]+)/) || [])[1] || '';
  if (apply && !/^(localhost|127\.0\.0\.1|::1)$/i.test(host)) {
    console.error(`REFUSING to apply against non-local database (${host}).`);
    process.exit(2);
  }

  const report = [];
  for (const name of TARGETS) {
    const r = await p.recipe.findFirst({
      where: { recipeName: { contains: name, mode: 'insensitive' } },
      select: { id: true, recipeName: true, fiberG: true, servings: true, reviewStatus: true },
    });
    if (!r) { console.log(`SKIP ${name}: not found`); continue; }
    const { perServing, parts, unresolved } = await computeRecipe(p, r);
    const before = r.fiberG;
    const after = Math.round(perServing * 10) / 10;
    const delta = after - (before ?? 0);
    const changed = Math.abs(delta) >= 0.5;
    report.push({ id: r.id, name: r.recipeName, before, after, delta: Math.round(delta * 10) / 10, unresolved, parts });
    console.log(`== ${r.recipeName} [${r.reviewStatus}] servings=${r.servings}`);
    console.log(`   stored=${before}  computed=${perServing.toFixed(2)}  proposed=${after}  Δ=${delta.toFixed(1)}`);
    parts.forEach((x) => console.log(`     ${x}`));
    if (unresolved.length) console.log(`     unresolved lines (excluded): ${unresolved.join(', ')}`);
    console.log(`     UPDATE "Recipe" SET "fiberG" = ${after} WHERE id = '${r.id}';`);
    console.log(`     ROLLBACK: UPDATE "Recipe" SET "fiberG" = ${before} WHERE id = '${r.id}';`);
  }

  if (!apply) {
    console.log('\nDRY RUN — no writes. Re-run with --apply (local DB only) after owner review.');
    await p.$disconnect();
    return;
  }
  const changed = report.filter((r) => r.before !== r.after);
  if (!changed.length) { console.log('Nothing to apply — all values already match.'); await p.$disconnect(); return; }
  await p.$transaction(async (tx) => {
    for (const r of changed) {
      await tx.recipe.update({ where: { id: r.id }, data: { fiberG: r.after } });
      console.log(`APPLIED ${r.name}: ${r.before} → ${r.after}`);
    }
  });
  console.log('\nRollback (run manually to revert):');
  changed.forEach((r) => console.log(`  UPDATE "Recipe" SET "fiberG" = ${r.before} WHERE id = '${r.id}';`));
  await p.$disconnect();
})();
