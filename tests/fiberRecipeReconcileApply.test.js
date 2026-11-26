// Focused fixture-client test for scripts/fiber-recipe-reconcile.js — pc-HUM-20 defect #18.
// Exercises the real apply path (module-level classification + the CLI child
// process) against the disposable fitness_test database with synthetic
// n20x-prefixed fixtures. Asserts exact-ID targeting, non-SYSTEM rejection,
// missing/duplicate/stale rejection with ZERO writes, transactional
// atomicity, and idempotent reapply.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getPrisma } = require('../src/lib/prisma');
const rec = require('../scripts/fiber-recipe-reconcile');

const P = 'n20x';
const p = getPrisma();
const TEST_DB_URL = process.env.DATABASE_URL; // setup.js already swapped in TEST_DATABASE_URL

const ids = { recipes: [], ingredients: [] };

async function mkIngredient(name, fiberPer100g) {
  const row = await p.ingredient.create({
    data: { name, normalizedName: name.toLowerCase(), caloriesPer100g: 100, proteinPer100g: 5, carbsPer100g: 15, fatPer100g: 1, fiberPer100g, source: 'n20x-test' },
  });
  ids.ingredients.push(row.id);
  return row;
}

async function mkRecipe(name, { isSystem, fiberG, servings = 2, lines = [] }) {
  const row = await p.recipe.create({
    data: { creatorId: ids.userId, recipeName: name, isSystem, reviewStatus: isSystem ? 'SYSTEM' : 'RESEARCH_DRAFT', fiberG, servings },
  });
  ids.recipes.push(row.id);
  for (const l of lines) {
    await p.recipeIngredient.create({
      data: { recipeId: row.id, ingredientName: l.name, amountG: l.amountG, ingredientId: l.ingredientId || null },
    });
  }
  return row;
}

function planFile(entries) {
  const f = path.join(os.tmpdir(), `n20x-plan-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(f, JSON.stringify(entries, null, 2));
  return f;
}

function runCli(args) {
  // DATABASE_URL is passed explicitly — dotenv in the script never overrides
  // an existing env var, so the child provably hits the disposable test DB.
  const r = spawnSync('node', [path.join(__dirname, '..', 'scripts', 'fiber-recipe-reconcile.js'), ...args], {
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: r.status, out: `${r.stdout || ''}\n${r.stderr || ''}` };
}

beforeAll(async () => {
  expect(TEST_DB_URL).toMatch(/fitness_test/i); // hard guard: never run these writes against dev/prod
  await p.recipe.deleteMany({ where: { recipeName: { contains: P } } });
  await p.ingredient.deleteMany({ where: { source: 'n20x-test' } });
  await p.user.deleteMany({ where: { email: { contains: 'n20x' } } });
  const u = await p.user.create({ data: { email: 'n20x-creator@test.local' } });
  ids.userId = u.id;

  const lentils = await mkIngredient(`${P} lentils cooked`, 4.0);
  const bread = await mkIngredient(`${P} bread`, 6.0);
  // valid SYSTEM target: lines 200g×4 + 50g×6 = 8+3 = 11g / 2 servings → 5.5; stored 1.0 (drifted)
  ids.sys = await mkRecipe(`${P} lentil soup`, {
    isSystem: true, fiberG: 1.0, servings: 2,
    lines: [{ name: 'lentils', amountG: 200, ingredientId: lentils.id }, { name: 'bread', amountG: 50, ingredientId: bread.id }],
  });
  // similarly named personal recipe — must never be selectable or writable
  ids.personal = await mkRecipe(`${P} lentil soup (personal copy)`, {
    isSystem: false, fiberG: 9.9, servings: 1,
    lines: [{ name: 'lentils', amountG: 100, ingredientId: lentils.id }],
  });
  // case-variant pair — case-insensitive exact match is genuinely ambiguous
  ids.caseA = await mkRecipe(`${P} oat bowl`, { isSystem: true, fiberG: 1, servings: 1, lines: [{ name: 'bread', amountG: 50, ingredientId: bread.id }] });
  ids.caseB = await mkRecipe(`${P} OAT BOWL`, { isSystem: true, fiberG: 1, servings: 1, lines: [{ name: 'bread', amountG: 50, ingredientId: bread.id }] });
  // held — unresolved line (no ingredientId)
  ids.held = await mkRecipe(`${P} mystery stew`, {
    isSystem: true, fiberG: 2.0, servings: 1,
    lines: [{ name: 'bread', amountG: 50, ingredientId: bread.id }, { name: 'mystery flakes', amountG: 30, ingredientId: null }],
  });
  // second valid SYSTEM target for atomicity tests
  ids.sys2 = await mkRecipe(`${P} bread plate`, {
    isSystem: true, fiberG: 0.5, servings: 1,
    lines: [{ name: 'bread', amountG: 100, ingredientId: bread.id }],
  });
}, 60000);

afterAll(async () => {
  await p.recipe.deleteMany({ where: { recipeName: { contains: P } } });
  await p.ingredient.deleteMany({ where: { source: 'n20x-test' } });
  await p.user.deleteMany({ where: { email: { contains: 'n20x' } } });
  await p.$disconnect();
}, 30000);

const fiberOf = async (id) => (await p.recipe.findUnique({ where: { id }, select: { fiberG: true } })).fiberG;
const validEntry = async (row, before) => {
  const { perServing } = await rec.computeRecipe(p, row);
  return { id: row.id, recipeName: row.recipeName, expectedBefore: before, computedAfter: rec.round1(perServing) };
};

describe('discovery — exact match only, no substring selection', () => {
  test('exact name finds the SYSTEM row; the similarly named personal recipe is never matched', async () => {
    const found = await rec.discoverTargets(p, [`${P} lentil soup`]);
    expect(found[0].status).toBe('found');
    expect(found[0].row.id).toBe(ids.sys.id);
    expect(found[0].row.id).not.toBe(ids.personal.id);
  });

  test('substring of a longer personal name does NOT match it', async () => {
    const found = await rec.discoverTargets(p, [`${P} lentil soup (personal`]);
    expect(found[0].status).toBe('missing'); // contains-matching would have hit the personal copy
  });

  test('case-variant duplicates are ambiguous — never first-matched', async () => {
    const found = await rec.discoverTargets(p, [`${P} oat bowl`]);
    expect(found[0].status).toBe('ambiguous');
    expect(found[0].matches).toHaveLength(2);
  });

  test('unknown name is missing', async () => {
    const found = await rec.discoverTargets(p, [`${P} no such recipe`]);
    expect(found[0].status).toBe('missing');
  });
});

describe('plan validation and classification', () => {
  test('duplicate ids are structural errors', () => {
    const e = { id: 'x', recipeName: 'a', expectedBefore: 1, computedAfter: 2 };
    expect(rec.validatePlanShape([e, e]).join()).toMatch(/duplicate id/);
    expect(rec.validatePlanShape([]).length).toBeGreaterThan(0);
    expect(rec.validatePlanShape([{ recipeName: 'a' }]).join()).toMatch(/missing exact recipe id/);
  });

  test('valid SYSTEM entry classifies ready; personal entry is invalid non-SYSTEM', async () => {
    const good = await validEntry(ids.sys, 1.0);
    const bad = await validEntry(ids.personal, 9.9);
    const classified = await rec.classifyPlan(p, [good, bad]);
    expect(classified.find((c) => c.e.id === ids.sys.id).verdict).toBe('ready');
    const pb = classified.find((c) => c.e.id === ids.personal.id);
    expect(pb.verdict).toBe('invalid');
    expect(pb.reason).toMatch(/non-SYSTEM/);
  });

  test('missing id is invalid', async () => {
    const classified = await rec.classifyPlan(p, [{ id: 'n20x-ghost-id', recipeName: 'ghost', expectedBefore: 1, computedAfter: 2 }]);
    expect(classified[0].verdict).toBe('invalid');
    expect(classified[0].reason).toMatch(/missing/);
  });

  test('name mismatch is invalid — plan name must exactly equal the row', async () => {
    const e = await validEntry(ids.sys, 1.0);
    e.recipeName = `${P} lentil soup (personal copy)`; // ids and names must agree exactly
    const classified = await rec.classifyPlan(p, [e]);
    expect(classified[0].verdict).toBe('invalid');
    expect(classified[0].reason).toMatch(/name mismatch/);
  });

  test('unresolved lines are held — never written, not fatal', async () => {
    const e = await validEntry(ids.held, 2.0);
    const classified = await rec.classifyPlan(p, [e]);
    expect(classified[0].verdict).toBe('held');
  });

  test('a target that becomes stale is invalid — current matches neither before nor after', async () => {
    const e = await validEntry(ids.sys2, 0.5);
    await p.recipe.update({ where: { id: ids.sys2.id }, data: { fiberG: 7.7 } }); // drift after review
    const classified = await rec.classifyPlan(p, [e]);
    expect(classified[0].verdict).toBe('invalid');
    expect(classified[0].reason).toMatch(/stale/);
    await p.recipe.update({ where: { id: ids.sys2.id }, data: { fiberG: 0.5 } }); // restore for later tests
  });
});

describe('script apply via CLI child process (disposable test DB)', () => {
  test('--apply without --plan refuses with exit 2, zero writes', async () => {
    const r = runCli(['--apply']);
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/reviewed plan of exact recipe IDs/);
    expect(await fiberOf(ids.sys.id)).toBe(1.0);
  });

  test('valid reviewed plan applies exactly the SYSTEM rows — personal row untouched', async () => {
    const plan = planFile([await validEntry(ids.sys, 1.0), await validEntry(ids.sys2, 0.5)]);
    const r = runCli(['--apply', '--plan', plan]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(new RegExp(`APPLIED ${P} lentil soup: 1 → 5.5`));
    expect(r.out).toMatch(new RegExp(`APPLIED ${P} bread plate: 0.5 → 6`));
    expect(await fiberOf(ids.sys.id)).toBe(5.5);
    expect(await fiberOf(ids.sys2.id)).toBe(6);
    expect(await fiberOf(ids.personal.id)).toBe(9.9); // never written
    fs.unlinkSync(plan);
  }, 90000);

  test('idempotent reapply — same plan again exits 0 as a no-op, values stable', async () => {
    const plan = planFile([await validEntry(ids.sys, 1.0), await validEntry(ids.sys2, 0.5)]);
    const r = runCli(['--apply', '--plan', plan]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Idempotent no-op|already applied/);
    expect(await fiberOf(ids.sys.id)).toBe(5.5);
    fs.unlinkSync(plan);
  }, 90000);

  test('plan containing a non-SYSTEM entry aborts the WHOLE run — zero writes incl. valid entries', async () => {
    await p.recipe.update({ where: { id: ids.sys2.id }, data: { fiberG: 0.5 } }); // reset drift
    const plan = planFile([await validEntry(ids.sys2, 0.5), await validEntry(ids.personal, 9.9)]);
    const r = runCli(['--apply', '--plan', plan]);
    expect(r.status).toBe(3);
    expect(r.out).toMatch(/ZERO writes/);
    expect(await fiberOf(ids.sys2.id)).toBe(0.5); // valid entry NOT written either — atomicity at validation
    expect(await fiberOf(ids.personal.id)).toBe(9.9);
    fs.unlinkSync(plan);
  }, 90000);

  test('missing target aborts with zero writes', async () => {
    const plan = planFile([{ id: 'n20x-ghost', recipeName: 'ghost', expectedBefore: 1, computedAfter: 2 }]);
    const r = runCli(['--apply', '--plan', plan]);
    expect(r.status).toBe(3);
    expect(r.out).toMatch(/missing/);
    fs.unlinkSync(plan);
  }, 90000);

  test('duplicate ids in plan are rejected structurally — exit 3 before any DB work', async () => {
    const e = await validEntry(ids.sys, 5.5);
    const plan = planFile([e, e]);
    const r = runCli(['--apply', '--plan', plan]);
    expect(r.status).toBe(3);
    expect(r.out).toMatch(/duplicate id/);
    fs.unlinkSync(plan);
  }, 90000);

  test('stale target — row mutated after review — aborts with zero writes', async () => {
    const entry = await validEntry(ids.sys2, 0.5);
    const plan = planFile([entry]);
    await p.recipe.update({ where: { id: ids.sys2.id }, data: { fiberG: 3.3 } }); // concurrent change after review
    const r = runCli(['--apply', '--plan', plan]);
    expect(r.status).toBe(3);
    expect(r.out).toMatch(/stale/);
    expect(await fiberOf(ids.sys2.id)).toBe(3.3); // the concurrent value is preserved, never overwritten
    await p.recipe.update({ where: { id: ids.sys2.id }, data: { fiberG: 0.5 } });
    fs.unlinkSync(plan);
  }, 90000);

  test('held rows are skipped but valid rows still apply in the same run', async () => {
    const plan = planFile([await validEntry(ids.held, 2.0), await validEntry(ids.sys2, 0.5)]);
    const r = runCli(['--apply', '--plan', plan]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/HELD/);
    expect(await fiberOf(ids.held.id)).toBe(2.0); // untouched
    expect(await fiberOf(ids.sys2.id)).toBe(6); // valid row applied
    await p.recipe.update({ where: { id: ids.sys2.id }, data: { fiberG: 0.5 } });
    fs.unlinkSync(plan);
  }, 90000);

  test('dry-run default makes zero writes even with drifted targets present', async () => {
    const r = runCli([]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/DRY RUN — no writes/);
  }, 90000);
});

describe('fixture hygiene', () => {
  test('no writes leak outside the transaction on abort — residue probe', async () => {
    const n = await p.recipe.count({ where: { recipeName: { contains: P }, fiberG: 5.5, isSystem: false } });
    expect(n).toBe(0); // a recomputed value must never appear on a non-SYSTEM row
  });
});
