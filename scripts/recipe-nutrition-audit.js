// Reproduces audit F-N drift: recompute every recipe's per-serving macros from
// resolved ingredient lines and diff against stored values.
//
//   node scripts/recipe-nutrition-audit.js           → dry-run report
//   node scripts/recipe-nutrition-audit.js --apply   → repair drifted rows
//
// Repair rule (never weakens data):
//  - Only recipes whose lines ALL resolve to catalog ingredients are eligible —
//    recomputing with unresolved lines would undercount and overwrite better
//    stored values.
//  - nutritionSource is rewritten with provenance + the previous stored values,
//    so the change is auditable and reversible.
//  - Unknown is not zero: fiber stays null when no line carries it.
const { getPrisma } = require('../src/lib/prisma');
const { KEYS, DRIFT_PCT, recompute, driftPct } = require('../src/services/recipeReconcile');

async function main() {
  const apply = process.argv.includes('--apply');
  const prisma = getPrisma();
  const recipes = await prisma.recipe.findMany({
    where: { isSystem: true },
    include: { ingredients: true },
  });
  const ids = [...new Set(recipes.flatMap(r => r.ingredients.map(l => l.ingredientId).filter(Boolean)))];
  const ingredients = await prisma.ingredient.findMany({ where: { id: { in: ids } } });
  const byId = new Map(ingredients.map(i => [i.id, i]));
  const report = { scanned: recipes.length, fullyResolved: 0, drifted: [], repaired: 0, skippedUnresolved: 0, skippedNoRecompute: 0 };
  for (const r of recipes) {
    const re = recompute(r, byId);
    if (!re) { report.skippedNoRecompute++; continue; }
    if (re._unresolvedLines > 0) { report.skippedUnresolved++; continue; }
    report.fullyResolved++;
    const drifts = {};
    for (const k of KEYS) {
      const d = driftPct(r[k], re[k]);
      if (d != null && d > DRIFT_PCT) drifts[k] = { stored: r[k], recomputed: re[k], pct: Math.round(d * 10) / 10 };
    }
    if (!Object.keys(drifts).length) continue;
    report.drifted.push({ id: r.id, name: r.recipeName, drifts });
    if (apply) {
      await prisma.recipe.update({
        where: { id: r.id },
        data: {
          calories: re.calories, proteinG: re.proteinG, carbsG: re.carbsG, fatG: re.fatG,
          ...(re.fiberG != null ? { fiberG: re.fiberG } : {}),
          nutritionSource: {
            kind: 'RECOMPUTED_FROM_INGREDIENT_LINES',
            auditedAt: new Date().toISOString(),
            previousStored: { calories: r.calories, proteinG: r.proteinG, carbsG: r.carbsG, fatG: r.fatG, fiberG: r.fiberG },
            priorSource: r.nutritionSource || null,
          },
        },
      });
      report.repaired++;
    }
  }
  console.log(JSON.stringify(report, null, 1));
  if (!apply) console.log('\nDry run — rerun with --apply to repair drifted recipes.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => getPrisma().$disconnect());
