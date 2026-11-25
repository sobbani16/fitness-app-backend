// Focused check for the NUTR-004 cleanup predicates in
// scripts/audit-junk-data.js. Self-contained: seeds its own rows, drives the
// script as a child process against the SAME disposable DB jest uses
// (setup.js already swapped DATABASE_URL to TEST_DATABASE_URL), and verifies
// that only positively test-owned, unreferenced rows are removed.
// Does not depend on suite order or on any other test's fixtures.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();

const S = `n4r${Date.now().toString(36)}`;
const SCRIPT = path.join(__dirname, '..', 'scripts', 'audit-junk-data.js');
const REPORT = path.join(os.tmpdir(), `${S}-junk-report.json`);

const runScript = apply =>
  spawnSync('node', [SCRIPT, '--report', REPORT, ...(apply ? ['--apply'] : [])], {
    env: process.env, // DATABASE_URL already points at the disposable test DB
    timeout: 120000,
  });
const report = () => JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const action = (r, kind) => r.actions.find(a => a.kind === kind);

let evOwned, evBadCode, evBadNotes, evWrongOrg, evRef, cond, ingAmb, ingCtrl, ctrlUserId;

beforeAll(async () => {
  const t = Date.now().toString(36);
  const mk = (over) => prisma.ruleEvidence.create({ data: {
    code: `${S}-X`, organization: 'Academy of Nutrition and Dietetics',
    guidelineTitle: 'T', sourceUrl: 'https://x.test/', lastReviewedAt: new Date(),
    evidenceNotes: 'real note', ...over,
  } });
  // Positively test-owned orphan: org + ms<base36>-EV code + fixture notes.
  evOwned = await mk({ code: `ms${t}1-EV`, organization: 'Test Fixture', evidenceNotes: 'Test fixture — not real evidence.' });
  // Lookalikes — each fails exactly one ownership signal.
  evBadCode = await mk({ code: `${S}-EV`, organization: 'Test Fixture', evidenceNotes: 'Test fixture — not real evidence.' });
  evBadNotes = await mk({ code: `ms${t}2-EV`, organization: 'Test Fixture', evidenceNotes: 'Looks like real guidance text.' });
  evWrongOrg = await mk({ code: `ms${t}3-EV`, evidenceNotes: 'Test fixture — not real evidence.' });
  // Fully owned signals but REFERENCED — reference check must protect it.
  evRef = await mk({ code: `ms${t}4-EV`, organization: 'Test Fixture', evidenceNotes: 'Test fixture — not real evidence.' });
  cond = await prisma.healthCondition.create({ data: { name: `${S} cond`, category: 'condition' } });
  await prisma.conditionRule.create({ data: { conditionId: cond.id, attribute: 'HIGH_SODIUM', target: 'ingredient', action: 'warn', reason: `${S} rule`, evidenceSourceId: evRef.id } });
  // Ambiguous-source ingredient: fixture marker, unreferenced, creator unknown.
  ingAmb = await prisma.ingredient.create({ data: { name: `${S} ambiguous bread`, normalizedName: `${S} ambiguous bread`, caloriesPer100g: 265, proteinPer100g: 9, carbsPer100g: 49, fatPer100g: 3.2, source: 'test-fixture' } });
  // Referenced control: normal catalog row with a live user link.
  ingCtrl = await prisma.ingredient.create({ data: { name: `${S} control oats`, normalizedName: `${S} control oats`, caloriesPer100g: 389, proteinPer100g: 16.9, carbsPer100g: 66.3, fatPer100g: 6.9, source: 'usda' } });
  const u = await prisma.user.findFirst({ select: { id: true } });
  ctrlUserId = u.id;
  await prisma.userIngredient.create({ data: { userId: ctrlUserId, ingredientId: ingCtrl.id } });
});

afterAll(async () => {
  const step = fn => fn().catch(() => null);
  await step(() => prisma.conditionRule.deleteMany({ where: { reason: `${S} rule` } }));
  await step(() => prisma.healthCondition.delete({ where: { id: cond.id } }));
  await step(() => prisma.ruleEvidence.deleteMany({ where: { id: { in: [evOwned, evBadCode, evBadNotes, evWrongOrg, evRef].map(r => r.id) } } }));
  await step(() => prisma.userIngredient.deleteMany({ where: { userId: ctrlUserId, ingredientId: ingCtrl.id } }));
  await step(() => prisma.ingredient.deleteMany({ where: { id: { in: [ingAmb.id, ingCtrl.id] } } }));
  fs.rmSync(REPORT, { force: true });
});

describe('audit-junk-data.js residue predicates', () => {
  jest.setTimeout(120000);

  it('dry-run deletes only the verified owned orphan; everything else is report-only', async () => {
    const res = runScript(false);
    expect(res.status).toBe(0);
    const r = report();
    const del = action(r, 'ruleEvidence:test-residue-delete');
    expect(del.detail.codes).toEqual([evOwned.code]);
    // No ingredient delete action for the ambiguous-source row.
    expect(r.actions.some(a => a.kind === 'ingredient:test-fixture-delete')).toBe(false);
    const unver = r.reportOnly.testFixtureEvidenceUnverified.map(x => x.code);
    expect(unver).toEqual(expect.arrayContaining([evBadCode.code, evBadNotes.code]));
    expect(unver).not.toContain(evOwned.code);
    expect(r.reportOnly.testFixtureEvidenceReferenced.map(x => x.code)).toContain(evRef.code);
    const fixIng = r.reportOnly.testFixtureIngredients.find(i => i.id === ingAmb.id);
    expect(fixIng).toMatchObject({ refs: 0 });
  });

  it('apply removes only the owned orphan; lookalikes, referenced, and controls survive', async () => {
    const res = runScript(true);
    expect(res.status).toBe(0);
    expect(await prisma.ruleEvidence.findUnique({ where: { id: evOwned.id } })).toBeNull();
    for (const r of [evBadCode, evBadNotes, evWrongOrg, evRef])
      expect(await prisma.ruleEvidence.findUnique({ where: { id: r.id } })).not.toBeNull();
    expect(await prisma.ingredient.findUnique({ where: { id: ingAmb.id } })).not.toBeNull();
    expect(await prisma.ingredient.findUnique({ where: { id: ingCtrl.id } })).not.toBeNull();
    expect(await prisma.userIngredient.count({ where: { userId: ctrlUserId, ingredientId: ingCtrl.id } })).toBe(1);
    expect(await prisma.conditionRule.count({ where: { reason: `${S} rule` } })).toBe(1);
  });
});
