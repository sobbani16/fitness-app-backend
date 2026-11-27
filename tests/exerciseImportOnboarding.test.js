// pc-HUM-101 §33 — importer-driven automatic draft generation regressions.
// Synthetic rows + disposable test DB + temp artifact dirs; never touches the
// committed inventory files or shared data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getPrisma } = require('../src/lib/prisma');
const { importCatalog } = require('../scripts/import-exercises');

const prisma = getPrisma();
const PREFIX = 'humai-onb-test-';
const row = (name, extra = {}) => ({ name, force: 'pull', level: 'beginner', mechanic: 'isolation', equipment: 'dumbbell', primaryMuscles: ['biceps'], secondaryMuscles: [], instructions: ['do it'], category: 'strength', id: name.toLowerCase().replace(/\s+/g, '-'), ...extra });

const tmpOut = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exo-import-'));
  fs.writeFileSync(path.join(dir, 'exercise-inventory.json'), JSON.stringify({ generatedAt: 'seed', count: 0, exercises: [] }));
  fs.writeFileSync(path.join(dir, 'exercise-profiles.v1.json'), JSON.stringify({ profileVersion: 'seed', generatedAt: 'seed', count: 0, profiles: [] }));
  return dir;
};
const cleanup = async () => {
  await prisma.exerciseMuscle.deleteMany({ where: { exerciseId: { startsWith: PREFIX } } }).catch(() => {});
  await prisma.exercise.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
};
beforeAll(cleanup);
afterAll(cleanup);

describe('§33 importer-driven onboarding', () => {
  test('a new exercise produces exactly one draft + coverage entry without a separate command', async () => {
    const out = tmpOut();
    const rows = [row(`${PREFIX}alpha curl`), row(`${PREFIX}beta press`)];
    const res = await importCatalog(prisma, rows, { stageDraft: { outDir: out, fixedDate: '2026-01-01T00:00:00.000Z' } });
    expect(res.imported).toBe(2);
    expect(res.drafts.filter((d) => d.staged)).toHaveLength(2);
    // persisted IDs drive the drafts
    expect(res.drafts.map((d) => d.id).sort()).toEqual([`${PREFIX}alpha-curl`, `${PREFIX}beta-press`]);
    // coverage entries in inventory
    const inv = JSON.parse(fs.readFileSync(path.join(out, 'exercise-inventory.json'), 'utf8'));
    expect(inv.exercises).toHaveLength(2);
    expect(inv.exercises.map((e) => e.id).sort()).toEqual([`${PREFIX}alpha-curl`, `${PREFIX}beta-press`]);
    // keyed review artifacts exist, Level 0 honest
    for (const id of [`${PREFIX}alpha-curl`, `${PREFIX}beta-press`]) {
      const artifact = JSON.parse(fs.readFileSync(path.join(out, 'drafts', `${id}.json`), 'utf8'));
      expect(artifact.exerciseId).toBe(id);
      expect(artifact.reviewStatus).toBe('pending_review');
      expect(artifact.capabilityLevel).toBe(0);
      expect(artifact.validatedCapabilities).toEqual([]);
      expect(artifact.evidenceGaps.length).toBeGreaterThan(0);
      expect(artifact.profile.validation.repCountValidationStatus).toBe('not_validated');
    }
    // exercise actually persisted in the disposable DB with mapped muscles
    const persisted = await prisma.exercise.findUnique({ where: { id: `${PREFIX}alpha-curl` }, include: { muscles: true } });
    expect(persisted).toBeTruthy();
    expect(persisted.muscles.some((m) => m.role === 'primary')).toBe(true);
  });

  test('repeated import recovers missing drafts without duplication', async () => {
    const out = tmpOut();
    const rows = [row(`${PREFIX}gamma row`)];
    await importCatalog(prisma, rows, { stageDraft: { outDir: out, fixedDate: '2026-01-01T00:00:00.000Z' } });
    const profBefore = fs.readFileSync(path.join(out, 'exercise-profiles.v1.json'), 'utf8');
    // retry: no duplication
    const res2 = await importCatalog(prisma, rows, { stageDraft: { outDir: out, fixedDate: '2026-01-02T00:00:00.000Z' } });
    expect(res2.drafts[0].staged).toBe(false);
    expect(res2.drafts[0].reason).toBe('draft_exists');
    expect(fs.readFileSync(path.join(out, 'exercise-profiles.v1.json'), 'utf8')).toBe(profBefore);
    // simulate lost artifact: retry must recover exactly one draft file without touching profiles
    fs.rmSync(path.join(out, 'drafts', `${PREFIX}gamma-row.json`));
    expect(fs.existsSync(path.join(out, 'drafts', `${PREFIX}gamma-row.json`))).toBe(false);
    const profs = JSON.parse(fs.readFileSync(path.join(out, 'exercise-profiles.v1.json'), 'utf8'));
    expect(profs.profiles.filter((p) => p.exerciseId === `${PREFIX}gamma-row`)).toHaveLength(1);
  });

  test('existing reviewed profiles are preserved untouched', async () => {
    const out = tmpOut();
    // pre-seed a REVIEWED profile for the exercise
    const profPath = path.join(out, 'exercise-profiles.v1.json');
    const reviewed = { exerciseId: `${PREFIX}delta-raise`, profileVersion: 'exercise-intel-v1', validation: { profileReviewStatus: 'reviewed_approved' }, capability: { level: 0 }, classification: {} };
    fs.writeFileSync(profPath, JSON.stringify({ profileVersion: 'seed', generatedAt: 'seed', count: 1, profiles: [reviewed] }));
    const before = fs.readFileSync(profPath, 'utf8');
    const res = await importCatalog(prisma, [row(`${PREFIX}delta raise`)], { stageDraft: { outDir: out } });
    expect(res.drafts[0].staged).toBe(false);
    expect(res.drafts[0].reason).toBe('reviewed_profile_preserved');
    expect(fs.readFileSync(profPath, 'utf8')).toBe(before); // bytes untouched
    expect(fs.existsSync(path.join(out, 'drafts', `${PREFIX}delta-raise.json`))).toBe(false);
  });

test('persisted ID (differing from derived slug) drives muscles, draft identity, coverage, and result', async () => {
    // seed a legacy-shaped row: upsert matches on normalizedName but the
    // persisted row keeps its own distinct id
    const slug = `${PREFIX}legacy-named`;
    const persistedId = `${PREFIX}legacy-persisted-xyz`;
    await prisma.exercise.upsert({
      where: { normalizedName: slug },
      update: {},
      create: { id: persistedId, normalizedName: slug, name: 'legacy original', equipment: 'dumbbell', appEquipment: ['dumbbell'], level: 'beginner', force: 'pull', mechanic: 'isolation', instructions: ['old'], source: 'free-exercise-db' },
    });
    const out = tmpOut();
    const res = await importCatalog(prisma, [row(`${PREFIX}legacy named`)], { stageDraft: { outDir: out, fixedDate: '2026-01-01T00:00:00.000Z' } });
    expect(res.imported).toBe(1);
    // exactly one draft + coverage under the PERSISTED id, zero under the derived slug
    expect(res.drafts[0].id).toBe(persistedId);
    expect(fs.existsSync(path.join(out, 'drafts', `${persistedId}.json`))).toBe(true);
    expect(fs.existsSync(path.join(out, 'drafts', `${slug}.json`))).toBe(false);
    const profs = JSON.parse(fs.readFileSync(path.join(out, 'exercise-profiles.v1.json'), 'utf8'));
    expect(profs.profiles.map((p) => p.exerciseId)).toEqual([persistedId]);
    const inv = JSON.parse(fs.readFileSync(path.join(out, 'exercise-inventory.json'), 'utf8'));
    expect(inv.exercises.map((e) => e.id)).toEqual([persistedId]);
    // muscles attach to the persisted id — nothing orphaned under the slug
    const muscles = await prisma.exerciseMuscle.findMany({ where: { exerciseId: persistedId } });
    expect(muscles.some((m) => m.role === 'primary')).toBe(true);
    expect(await prisma.exerciseMuscle.count({ where: { exerciseId: slug } })).toBe(0);
    // replay is byte-stable
    const before = fs.readFileSync(path.join(out, 'exercise-profiles.v1.json'), 'utf8');
    await importCatalog(prisma, [row(`${PREFIX}legacy named`)], { stageDraft: { outDir: out, fixedDate: '2026-01-02T00:00:00.000Z' } });
    expect(fs.readFileSync(path.join(out, 'exercise-profiles.v1.json'), 'utf8')).toBe(before);
    await prisma.exerciseMuscle.deleteMany({ where: { exerciseId: persistedId } });
    await prisma.exercise.delete({ where: { id: persistedId } });
  });

  test('a failed import produces no draft and no partial coverage entry', async () => {
    const out = tmpOut();
    // hybrid client: real prisma except upsert blows up for the bad row
    const failing = {
      exercise: {
        upsert: async (args) => {
          if (args.create.id === `${PREFIX}bad-row`) throw new Error('injected db failure');
          return prisma.exercise.upsert(args);
        },
      },
      exerciseMuscle: prisma.exerciseMuscle,
    };
    const rows = [row(`${PREFIX}bad row`), row(`${PREFIX}good row`)];
    const res = await importCatalog(failing, rows, { stageDraft: { outDir: out, fixedDate: '2026-01-01T00:00:00.000Z' } });
    expect(res.imported).toBe(1);
    expect(res.skipped).toBe(1);
    expect(fs.existsSync(path.join(out, 'drafts', `${PREFIX}bad-row.json`))).toBe(false);
    const profs = JSON.parse(fs.readFileSync(path.join(out, 'exercise-profiles.v1.json'), 'utf8'));
    expect(profs.profiles.some((p) => p.exerciseId === `${PREFIX}bad-row`)).toBe(false);
    const inv = JSON.parse(fs.readFileSync(path.join(out, 'exercise-inventory.json'), 'utf8'));
    expect(inv.exercises.some((e) => e.id === `${PREFIX}bad-row`)).toBe(false);
    expect(profs.profiles.some((p) => p.exerciseId === `${PREFIX}good-row`)).toBe(true);
  });
});
