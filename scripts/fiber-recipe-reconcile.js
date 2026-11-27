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
//   - Every plan entry binds the review to deterministic input evidence:
//     exact ingredient IDs and line membership, nutrient values and basis,
//     quantities, preparation evidence, and serving/yield inputs. Plans
//     lacking this evidence are rejected — regenerate for a fresh review.
//   - Inside one serializable transaction every input is re-read and
//     recomputed and must match the reviewed evidence exactly; the write is
//     a conditional compare-and-set UPDATE. Any drift rolls the batch back.
//   - APPLIED is emitted only after commit + post-commit read-back verification.
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

// Line resolution shared by computation and evidence binding. Returns one
// entry per RecipeIngredient row — including unresolved ones, because line
// membership itself is reviewed evidence.
async function resolveLines(p, recipe) {
  const lines = await p.recipeIngredient.findMany({
    where: { recipeId: recipe.id },
    select: { id: true, ingredientName: true, amountG: true, ingredientId: true },
    orderBy: { id: 'asc' },
  });
  const out = [];
  for (const l of lines) {
    const ing = l.ingredientId
      ? await p.ingredient.findUnique({ where: { id: l.ingredientId }, select: { name: true, fiberPer100g: true } })
      : null;
    // Dry-basis catalog rows must not be multiplied into a cooked recipe
    // portion — 150 g of dry lentils is not the 150 g of lentils in a soup.
    const dryBasis = ing ? /\(dry\)|\bdry\b|uncooked/i.test(ing.name) : false;
    out.push({
      lineId: l.id,
      ingredientId: l.ingredientId || null,
      ingredientName: l.ingredientName,
      amountG: Number(l.amountG) || 0,
      resolvedName: ing?.name || null,
      fiberPer100g: ing?.fiberPer100g ?? null,
      dryBasis,
    });
  }
  return out;
}

// Deterministic evidence fingerprint of every input the computation depends
// on: exact ingredient ids + membership, nutrient values and basis,
// quantities, preparation evidence (resolved name + dry-basis flag), and the
// serving/yield inputs. A plan binds the review to this fingerprint — any
// change to any input is stale, even when the rounded result coincides.
function inputsEvidence(resolvedLines, servings) {
  return {
    servings,
    lines: resolvedLines.map((l) => ({
      lineId: l.lineId, ingredientId: l.ingredientId, ingredientName: l.ingredientName,
      amountG: l.amountG, fiberPer100g: l.fiberPer100g, dryBasis: l.dryBasis, resolvedName: l.resolvedName,
    })),
  };
}

function inputsMatch(evidence, live) {
  if (!evidence || !live) return 'missing evidence';
  if (evidence.servings !== live.servings) return `servings ${live.servings} ≠ reviewed ${evidence.servings}`;
  if (evidence.lines.length !== live.lines.length) return `line count ${live.lines.length} ≠ reviewed ${evidence.lines.length}`;
  for (let i = 0; i < evidence.lines.length; i++) {
    const e = evidence.lines[i], l = live.lines[i];
    if (e.lineId !== l.lineId) return `line membership changed at position ${i}`;
    if (e.ingredientId !== l.ingredientId) return `line ${e.ingredientName}: linked ingredient changed`;
    if (e.amountG !== l.amountG) return `line ${e.ingredientName}: quantity ${l.amountG} ≠ reviewed ${e.amountG}`;
    if (e.fiberPer100g !== l.fiberPer100g) return `line ${e.ingredientName}: nutrient value ${l.fiberPer100g} ≠ reviewed ${e.fiberPer100g}`;
    if (e.dryBasis !== l.dryBasis) return `line ${e.ingredientName}: preparation basis changed`;
    if (e.resolvedName !== l.resolvedName) return `line ${e.ingredientName}: preparation evidence (resolved name) changed`;
  }
  return null;
}

async function computeRecipe(p, recipe) {
  const resolvedLines = await resolveLines(p, recipe);
  let total = 0;
  const parts = [];
  const unresolved = [];
  for (const l of resolvedLines) {
    if (!l.ingredientId || l.fiberPer100g == null) { unresolved.push(l.ingredientName); continue; }
    const g = l.dryBasis ? 0 : l.amountG * l.fiberPer100g / 100;
    total += g;
    if (l.dryBasis) unresolved.push(`${l.ingredientName} (dry-basis catalog row "${l.resolvedName}" — cooked basis needed)`);
    else parts.push(`${l.ingredientName}: ${l.amountG}g × ${l.fiberPer100g}/100g = ${g.toFixed(2)}g`);
  }
  const servings = recipe.servings || 1;
  return { perServing: total / servings, parts, unresolved, inputs: inputsEvidence(resolvedLines, servings) };
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
  const { perServing, parts, unresolved, inputs } = await computeRecipe(p, row);
  const after = round1(perServing);
  return {
    id: row.id,
    recipeName: row.recipeName,
    isSystem: row.isSystem,
    reviewStatus: row.reviewStatus,
    expectedBefore: row.fiberG,
    computedAfter: after,
    inputs,
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
    const inp = e.inputs;
    if (!inp || typeof inp !== 'object' || typeof inp.servings !== 'number' || !Array.isArray(inp.lines)
        || inp.lines.some((l) => !l || typeof l.lineId !== 'string' || typeof l.amountG !== 'number'
          || !('ingredientId' in l) || !('fiberPer100g' in l) || typeof l.dryBasis !== 'boolean' || !('resolvedName' in l))) {
      errors.push(`${at}: missing input evidence (ingredient ids/membership, nutrient values, quantities, preparation, servings) — regenerate the plan with --write-plan for a fresh review`);
    }
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
    const { perServing, unresolved, inputs: liveInputs } = await computeRecipe(p, row);
    // Drift detection precedes computability: when reviewed inputs changed,
    // "stale inputs" is the precise verdict regardless of whether the row is
    // still computable — held is reserved for unchanged-but-uncomputable rows.
    const drift = inputsMatch(e.inputs, liveInputs);
    if (drift) {
      classified.push({ e, row, verdict: 'invalid', reason: `stale inputs — ${drift} (reviewed evidence no longer matches; fresh review required)` });
      continue;
    }
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

// Apply a validated classification inside one SERIALIZABLE transaction.
// Every input the review was bound to is re-read and recomputed inside the
// transaction — ingredient ids and membership, nutrient values and basis,
// quantities, preparation evidence, servings — and must match the reviewed
// evidence exactly before any write. Under PostgreSQL serializable isolation
// a concurrent committed change to any read input aborts the transaction,
// so a reviewed input cannot change unnoticed before commit. The write
// itself remains a conditional compare-and-set on the exact reviewed prior
// value + SYSTEM identity + exact name. APPLIED is reported only after the
// transaction commits AND a fresh read-back verifies the persisted value.
async function applyClassified(p, classified, log) {
  const ready = classified.filter((c) => c.verdict === 'ready');
  const written = [];
  const txOpts = { isolationLevel: 'Serializable', maxWait: 10000, timeout: 20000 };
  await p.$transaction(async (tx) => {
    for (const c of ready) {
      const current = await tx.recipe.findUnique({
        where: { id: c.e.id },
        select: { id: true, fiberG: true, isSystem: true, recipeName: true, servings: true },
      });
      if (!current || current.isSystem !== true || current.recipeName !== c.e.recipeName || current.fiberG !== c.e.expectedBefore) {
        throw new Error(`concurrent-change guard: ${c.e.recipeName} no longer matches the reviewed plan inside the transaction — rolling back`);
      }
      // Re-read and recompute the inputs inside the transaction — a change
      // between classification and commit is caught here even if the recipe
      // row itself is untouched.
      const { perServing, unresolved, inputs: liveInputs } = await computeRecipe(tx, current);
      if (unresolved.length) {
        throw new Error(`${c.e.recipeName}: unresolved lines appeared inside the transaction — rolling back`);
      }
      const drift = inputsMatch(c.e.inputs, liveInputs);
      if (drift) {
        throw new Error(`${c.e.recipeName}: stale inputs inside the transaction — ${drift} — rolling back`);
      }
      if (round1(perServing) !== c.after) {
        throw new Error(`${c.e.recipeName}: recomputed ${round1(perServing)} ≠ reviewed ${c.after} inside the transaction — rolling back`);
      }
      const res = await tx.recipe.updateMany({
        where: { id: c.e.id, fiberG: c.e.expectedBefore, isSystem: true, recipeName: c.e.recipeName },
        data: { fiberG: c.after },
      });
      if (res.count !== 1) {
        throw new Error(`conditional write matched ${res.count} rows for ${c.e.recipeName} — rolling back`);
      }
      written.push({ id: c.e.id, name: c.e.recipeName, before: c.e.expectedBefore, after: c.after });
    }
  }, txOpts);
  // Post-commit read-back verification — APPLIED is emitted only for rows
  // whose persisted value is confirmed by a fresh read.
  const applied = [];
  for (const w of written) {
    const check = await p.recipe.findUnique({ where: { id: w.id }, select: { fiberG: true } });
    if (!check || check.fiberG !== w.after) {
      throw new Error(`post-commit verification failed for ${w.name}: persisted ${check?.fiberG} ≠ expected ${w.after}`);
    }
    applied.push(w);
    log(`APPLIED ${w.name}: ${w.before} → ${w.after} (verified)`);
  }
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
  // Verified-after-apply: re-read every written row and confirm the stored
  // value matches the computation — unverifiable reconciliation is not reconciled.
  let verifyFailed = false;
  for (const r of changed) {
    const stored = await p.recipe.findUnique({ where: { id: r.id }, select: { fiberG: true } });
    if (stored?.fiberG !== r.after) { verifyFailed = true; console.error(`VERIFY-FAIL ${r.name}: stored=${stored?.fiberG} expected=${r.after}`); }
    else console.log(`VERIFIED ${r.name}: stored=${stored.fiberG}`);
  }
  if (verifyFailed) { console.error('Verification failed — investigate before trusting this apply.'); process.exitCode = 3; }
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
      inputs: c.inputs,
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

module.exports = { TARGETS, computeRecipe, resolveLines, inputsEvidence, inputsMatch, discoverTargets, planEntryFor, validatePlanShape, classifyPlan, applyClassified, round1 };
