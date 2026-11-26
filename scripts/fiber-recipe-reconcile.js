// Fiber recipe reconciliation — Stage 2 data-quality follow-up.
//
// Recomputes Recipe.fiberG (per serving) from RecipeIngredient lines ×
// Ingredient.fiberPer100g for SYSTEM recipes whose stored values drifted
// from their ingredient sums (FIBER_DATA_AUDIT §8.2.1).
//
// SAFETY CONTRACT (defect #18 hardening):
//   - Dry-run by default: prints before/after + computation. No writes.
//   - Discovery is exact-match only — substring matching never selects a
//     row for any purpose. Similarly named personal recipes cannot match.
//   - `--apply` REQUIRES `--plan <file>`: an explicit, human-reviewed plan
//     of exact recipe IDs (generated via `--write-plan`, reviewed by the
//     catalog owner). There is no apply path that resolves names at runtime.
//   - Pre-write validation rejects duplicate, missing, ambiguous, stale, or
//     non-SYSTEM targets. ANY invalid target aborts the whole run with zero
//     writes — a partially applied review is worse than none.
//   - Inside the transaction every row is re-validated (SYSTEM identity,
//     exact name, expected prior fiberG) and written with a conditional
//     compare-and-set UPDATE — a row changed between validation and write
//     rolls the transaction back instead of being overwritten.
//   - Rows with unresolved ingredient lines are HELD, never written.
//   - Re-applying an already-applied plan is a successful no-op.
//   - Never run against a shared/production database without the catalog
//     owner's sign-off recorded in the rollout tracker.
//
// Usage:
//   node scripts/fiber-recipe-reconcile.js                         # dry-run report
//   node scripts/fiber-recipe-reconcile.js --write-plan plan.json  # dry-run + write candidate plan for review
//   node scripts/fiber-recipe-reconcile.js --apply --plan plan.json  # apply a reviewed plan (local DB only)
require('dotenv').config({ quiet: true });

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
    // Dry-basis catalog rows must not be multiplied into a cooked recipe
    // portion — 150 g of dry lentils is not the 150 g of lentils in a soup.
    // Flag them as unresolved so the recipe is held for catalog review rather
    // than silently overstated.
    const dryBasis = /\(dry\)|\bdry\b|uncooked/i.test(ing.name);
    const g = dryBasis ? 0 : (Number(l.amountG) || 0) * ing.fiberPer100g / 100;
    total += g;
    if (dryBasis) unresolved.push(`${l.ingredientName} (dry-basis catalog row "${ing.name}" — cooked basis needed)`);
    else parts.push(`${l.ingredientName}: ${l.amountG}g × ${ing.fiberPer100g}/100g = ${g.toFixed(2)}g`);
  }
  const servings = recipe.servings || 1;
  return { perServing: total / servings, parts, unresolved };
}

const round1 = (v) => Math.round(v * 10) / 10;

// Exact-match discovery. `recipeName` uniqueness is case-sensitive at the DB
// level, so a case-insensitive exact match can still return multiple rows —
// those are genuinely ambiguous and must be excluded, never first-matched.
async function discoverTargets(p, names) {
  const out = [];
  for (const name of names) {
    const rows = await p.recipe.findMany({
      where: { recipeName: { equals: name, mode: 'insensitive' } },
      select: { id: true, recipeName: true, fiberG: true, servings: true, reviewStatus: true, isSystem: true },
    });
    if (!rows.length) { out.push({ name, status: 'missing' }); continue; }
    if (rows.length > 1) { out.push({ name, status: 'ambiguous', matches: rows.map((r) => r.id) }); continue; }
    out.push({ name, status: 'found', row: rows[0] });
  }
  return out;
}

// Build a candidate plan entry from a discovered row. Returns null when the
// row is not eligible (non-SYSTEM or unresolved lines) — held rows are never
// silently written into a plan.
async function planEntryFor(p, row) {
  const { perServing, parts, unresolved } = await computeRecipe(p, row);
  const after = round1(perServing);
  return {
    id: row.id,
    recipeName: row.recipeName,
    isSystem: row.isSystem,
    reviewStatus: row.reviewStatus,
    expectedBefore: row.fiberG,
    computedAfter: after,
    unresolved,
    parts,
    eligible: row.isSystem === true && unresolved.length === 0,
  };
}

function validatePlanShape(plan) {
  const errors = [];
  if (!Array.isArray(plan) || !plan.length) return ['plan must be a non-empty array'];
  const seen = new Set();
  plan.forEach((e, i) => {
    const at = `entry[${i}]`;
    if (!e || typeof e !== 'object') { errors.push(`${at}: not an object`); return; }
    if (typeof e.id !== 'string' || !e.id) errors.push(`${at}: missing exact recipe id`);
    else if (seen.has(e.id)) errors.push(`${at}: duplicate id ${e.id}`);
    else seen.add(e.id);
    if (typeof e.recipeName !== 'string' || !e.recipeName) errors.push(`${at}: missing recipeName`);
    if (!(typeof e.expectedBefore === 'number' || e.expectedBefore === null)) errors.push(`${at}: expectedBefore must be a number or null`);
    if (typeof e.computedAfter !== 'number') errors.push(`${at}: computedAfter must be a number`);
  });
  return errors;
}

// Validate every plan entry against live state. Classifies each entry:
//   invalid  — plan defect or review invalidated (missing, non-SYSTEM, name
//              mismatch, stale prior value, changed inputs) → aborts the run
//   held     — unresolved ingredient lines → skipped, not written, not fatal
//   noop     — already at the recomputed value (idempotent reapply)
//   ready    — passes every check, eligible for the conditional write
async function classifyPlan(p, plan) {
  const classified = [];
  for (const e of plan) {
    const row = await p.recipe.findUnique({
      where: { id: e.id },
      select: { id: true, recipeName: true, fiberG: true, servings: true, reviewStatus: true, isSystem: true },
    });
    if (!row) { classified.push({ e, verdict: 'invalid', reason: 'missing — no recipe with this exact id' }); continue; }
    if (row.recipeName !== e.recipeName) {
      classified.push({ e, verdict: 'invalid', reason: `name mismatch — plan "${e.recipeName}" vs row "${row.recipeName}"` });
      continue;
    }
    if (row.isSystem !== true) { classified.push({ e, verdict: 'invalid', reason: 'non-SYSTEM recipe — personal/owned rows are never written' }); continue; }
    const { perServing, unresolved } = await computeRecipe(p, row);
    if (unresolved.length) { classified.push({ e, row, verdict: 'held', reason: `unresolved lines: ${unresolved.join(', ')}` }); continue; }
    const after = round1(perServing);
    if (after !== e.computedAfter) {
      classified.push({ e, row, verdict: 'invalid', reason: `stale inputs — recomputed ${after} ≠ plan computedAfter ${e.computedAfter} (ingredient data changed since review)` });
      continue;
    }
    if (row.fiberG === e.expectedBefore) { classified.push({ e, row, after, verdict: 'ready' }); continue; }
    if (row.fiberG === after) { classified.push({ e, row, after, verdict: 'noop', reason: 'already at recomputed value' }); continue; }
    classified.push({ e, row, verdict: 'invalid', reason: `stale — current fiberG ${row.fiberG} is neither expectedBefore ${e.expectedBefore} nor computedAfter ${after}` });
  }
  return classified;
}

// Apply a validated classification inside one transaction. Each write is a
// conditional compare-and-set: the UPDATE only matches while the row still
// carries the exact reviewed prior value, SYSTEM identity and exact name —
// any concurrent change makes count≠1 and rolls everything back.
async function applyClassified(p, classified, log) {
  const ready = classified.filter((c) => c.verdict === 'ready');
  const applied = [];
  await p.$transaction(async (tx) => {
    for (const c of ready) {
      const current = await tx.recipe.findUnique({
        where: { id: c.e.id },
        select: { fiberG: true, isSystem: true, recipeName: true },
      });
      if (!current || current.isSystem !== true || current.recipeName !== c.e.recipeName || current.fiberG !== c.e.expectedBefore) {
        throw new Error(`concurrent-change guard: ${c.e.recipeName} no longer matches the reviewed plan inside the transaction — rolling back`);
      }
      const res = await tx.recipe.updateMany({
        where: { id: c.e.id, fiberG: c.e.expectedBefore, isSystem: true, recipeName: c.e.recipeName },
        data: { fiberG: c.after },
      });
      if (res.count !== 1) {
        throw new Error(`conditional write matched ${res.count} rows for ${c.e.recipeName} — rolling back`);
      }
      applied.push({ id: c.e.id, name: c.e.recipeName, before: c.e.expectedBefore, after: c.after });
      log(`APPLIED ${c.e.recipeName}: ${c.e.expectedBefore} → ${c.after}`);
    }
  });
  return applied;
}

async function main() {
  const { getPrisma } = require('../src/lib/prisma');
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const planPath = (() => { const i = argv.indexOf('--plan'); return i >= 0 ? argv[i + 1] : null; })();
  const writePlanPath = (() => { const i = argv.indexOf('--write-plan'); return i >= 0 ? argv[i + 1] : null; })();
  const p = getPrisma();
  const log = (s) => console.log(s);
  const url = process.env.DATABASE_URL || '';
  const host = (url.match(/@([^:/]+)/) || [])[1] || '';
  if (apply && !/^(localhost|127\.0\.0\.1|::1)$/i.test(host)) {
    console.error(`REFUSING to apply against non-local database (${host}).`);
    process.exit(2);
  }
  if (apply && !planPath) {
    console.error('REFUSING to apply without --plan <file> — apply requires an explicit reviewed plan of exact recipe IDs.');
    process.exit(2);
  }

  if (apply) {
    const plan = JSON.parse(require('fs').readFileSync(planPath, 'utf8'));
    const shapeErrors = validatePlanShape(plan);
    if (shapeErrors.length) {
      console.error(`PLAN REJECTED — structural errors:\n  ${shapeErrors.join('\n  ')}`);
      process.exit(3);
    }
    const classified = await classifyPlan(p, plan);
    for (const c of classified) {
      const tag = c.verdict.toUpperCase();
      console.log(`${tag} ${c.e.recipeName} (${c.e.id})${c.reason ? ` — ${c.reason}` : ''}`);
    }
    const invalid = classified.filter((c) => c.verdict === 'invalid');
    if (invalid.length) {
      console.error(`\nPLAN REJECTED — ${invalid.length} invalid target(s). ZERO writes; fix the plan or re-review and re-run.`);
      process.exit(3);
    }
    const ready = classified.filter((c) => c.verdict === 'ready');
    const held = classified.filter((c) => c.verdict === 'held');
    const noop = classified.filter((c) => c.verdict === 'noop');
    if (!ready.length) {
      console.log(`Nothing to apply — ${noop.length} already applied, ${held.length} held. Idempotent no-op.`);
      await p.$disconnect();
      return;
    }
    const applied = await applyClassified(p, classified, log);
    console.log(`\nApplied ${applied.length} row(s); ${noop.length} no-op, ${held.length} held (unresolved lines — never written).`);
    console.log('Rollback (run manually to revert):');
    applied.forEach((r) => console.log(`  UPDATE "Recipe" SET "fiberG" = ${r.before} WHERE id = '${r.id}';`));
    await p.$disconnect();
    return;
  }

  // Dry-run discovery — exact matches only, read-only.
  const found = await discoverTargets(p, TARGETS);
  const candidates = [];
  for (const f of found) {
    if (f.status === 'missing') { console.log(`SKIP ${f.name}: no exact match`); continue; }
    if (f.status === 'ambiguous') { console.log(`SKIP ${f.name}: AMBIGUOUS — ${f.matches.length} rows match case-insensitively (${f.matches.join(', ')}); exact review required`); continue; }
    const entry = await planEntryFor(p, f.row);
    const delta = round1((entry.computedAfter ?? 0) - (entry.expectedBefore ?? 0));
    console.log(`== ${entry.recipeName} [${entry.reviewStatus}${entry.isSystem ? ' isSystem' : ' NON-SYSTEM'}] id=${entry.id}`);
    console.log(`   stored=${entry.expectedBefore}  proposed=${entry.computedAfter}  Δ=${delta}`);
    entry.parts.forEach((x) => console.log(`     ${x}`));
    if (!entry.isSystem) { console.log('     EXCLUDED — not a SYSTEM recipe'); continue; }
    if (entry.unresolved.length) { console.log(`     HELD — unresolved lines (excluded): ${entry.unresolved.join(', ')}`); continue; }
    candidates.push(entry);
    console.log(`     UPDATE "Recipe" SET "fiberG" = ${entry.computedAfter} WHERE id = '${entry.id}';`);
    console.log(`     ROLLBACK: UPDATE "Recipe" SET "fiberG" = ${entry.expectedBefore} WHERE id = '${entry.id}';`);
  }

  if (writePlanPath) {
    const plan = candidates.map((c) => ({
      id: c.id, recipeName: c.recipeName,
      expectedBefore: c.expectedBefore, computedAfter: c.computedAfter,
    }));
    require('fs').writeFileSync(writePlanPath, JSON.stringify(plan, null, 2) + '\n');
    console.log(`\nCandidate plan written to ${writePlanPath} (${plan.length} entries) — review every row before applying.`);
  }
  console.log('\nDRY RUN — no writes. Review, then apply with: --apply --plan <reviewed-plan.json> (local DB only).');
  await p.$disconnect();
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { TARGETS, computeRecipe, discoverTargets, planEntryFor, validatePlanShape, classifyPlan, applyClassified, round1 };
