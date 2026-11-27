// pc-HUM-101 §33 — onboarding coverage-check + draft-generation regressions.
// Uses disposable fixture catalogs + temp output dirs — never touches the
// committed inventory files or any database.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '../scripts/exercise-inventory.js');
const REAL_INV = path.join(__dirname, '../docs/exercise-intelligence');

const run = (args) => {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout: out, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
};

const fixtureCatalog = (rows) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exo-onboard-'));
  const cat = path.join(dir, 'catalog.json');
  fs.writeFileSync(cat, JSON.stringify(rows));
  return { dir, cat };
};
// minimal valid vendored rows (free-exercise-db shape)
const row = (name, extra = {}) => ({ name, force: 'pull', level: 'beginner', mechanic: 'isolation', equipment: 'dumbbell', primaryMuscles: ['biceps'], secondaryMuscles: [], instructions: ['do it'], category: 'strength', id: name.toLowerCase().replace(/\s+/g, '-'), ...extra });

const seedCommitted = (dir, rows) => {
  // produce committed inventory+profiles for exactly the given rows by running drafts mode once
  const { cat } = fixtureCatalog(rows);
  const out = path.join(dir, 'out');
  fs.mkdirSync(out, { recursive: true });
  // seed empty committed files first so loadCommitted succeeds
  fs.writeFileSync(path.join(out, 'exercise-inventory.json'), JSON.stringify({ generatedAt: 'seed', count: 0, exercises: [] }));
  fs.writeFileSync(path.join(out, 'exercise-profiles.v1.json'), JSON.stringify({ profileVersion: 'seed', generatedAt: 'seed', count: 0, profiles: [] }));
  return { catalogPath: cat, outDir: out };
};

describe('§33 coverage check', () => {
  test('fails with the actionable id when a newly imported exercise lacks a profile', () => {
    const { dir } = fixtureCatalog([]);
    const { catalogPath, outDir } = seedCommitted(dir, [row('Alpha Curl')]);
    // generate drafts for alpha only, then add beta to the catalog without drafting
    expect(run(['--drafts', `--catalog=${catalogPath}`, `--out=${outDir}`, '--fixed-date=2026-01-01T00:00:00.000Z']).code).toBe(0);
    const rows = [row('Alpha Curl'), row('Beta Press')];
    fs.writeFileSync(catalogPath, JSON.stringify(rows));
    const res = run(['--check', `--catalog=${catalogPath}`, `--out=${outDir}`]);
    expect(res.code).toBe(1);
    expect(res.stderr + res.stdout).toMatch(/beta-press/);
    expect(res.stderr + res.stdout).toMatch(/--drafts/); // actionable remediation hint
  });

  test('recheck passes after draft generation for the new id', () => {
    const { dir } = fixtureCatalog([]);
    const rows = [row('Gamma Row'), row('Delta Raise')];
    const { outDir } = seedCommitted(dir, rows);
    const cat = path.join(dir, 'catalog.json');
    fs.writeFileSync(cat, JSON.stringify(rows));
    // initially failing
    expect(run(['--check', `--catalog=${cat}`, `--out=${outDir}`]).code).toBe(1);
    // generate drafts deterministically
    const draft = run(['--drafts', `--catalog=${cat}`, `--out=${outDir}`, '--fixed-date=2026-01-01T00:00:00.000Z']);
    expect(draft.code).toBe(0);
    expect(draft.stdout).toMatch(/gamma-row/);
    expect(draft.stdout).toMatch(/delta-raise/);
    // recheck passes
    const recheck = run(['--check', `--catalog=${cat}`, `--out=${outDir}`]);
    expect(recheck.code).toBe(0);
    expect(recheck.stdout).toMatch(/coverage check passed/);
    // drafts are honest: Level 0, unreviewed, no validation claims
    const profs = JSON.parse(fs.readFileSync(path.join(outDir, 'exercise-profiles.v1.json'), 'utf8'));
    expect(profs.profiles).toHaveLength(2);
    for (const p of profs.profiles) {
      expect(p.capability.level).toBe(0);
      expect(p.capability.validatedCapabilities).toEqual([]);
      expect(p.validation.repCountValidationStatus).toBe('not_validated');
      expect(p.validation.profileReviewStatus).toBe('auto_generated_unreviewed');
    }
    expect(JSON.stringify(profs)).not.toMatch(/"validated"\s*:\s*true/);
  });

  test('draft generation is deterministic — same input, byte-identical output', () => {
    const { dir } = fixtureCatalog([]);
    const rows = [row('Zeta Squat'), row('Eta Hinge')];
    const { outDir } = seedCommitted(dir, rows);
    const cat = path.join(dir, 'catalog.json');
    fs.writeFileSync(cat, JSON.stringify(rows));
    run(['--drafts', `--catalog=${cat}`, `--out=${outDir}`, '--fixed-date=2026-01-01T00:00:00.000Z']);
    const first = fs.readFileSync(path.join(outDir, 'exercise-profiles.v1.json'), 'utf8');
    // second run is a no-op (nothing missing) — files unchanged
    run(['--drafts', `--catalog=${cat}`, `--out=${outDir}`, '--fixed-date=2026-01-01T00:00:00.000Z']);
    expect(fs.readFileSync(path.join(outDir, 'exercise-profiles.v1.json'), 'utf8')).toBe(first);
  });

  test('rejects an empty catalog explicitly', () => {
    const { cat, dir } = fixtureCatalog([]);
    const res = run(['--check', `--catalog=${cat}`, `--out=${path.join(dir, 'whatever')}`]);
    expect(res.code).not.toBe(0);
    expect(res.stderr + res.stdout).toMatch(/empty/i);
  });

  test('rejects duplicate ids in the catalog source', () => {
    const rows = [row('Dup Curl'), row('dup curl')]; // same slug
    const { dir } = fixtureCatalog([]);
    const { outDir } = seedCommitted(dir, [row('Dup Curl')]);
    const cat = path.join(dir, 'catalog.json');
    fs.writeFileSync(cat, JSON.stringify(rows));
    run(['--drafts', `--catalog=${cat}`, `--out=${outDir}`, '--fixed-date=2026-01-01T00:00:00.000Z']);
    const res = run(['--check', `--catalog=${cat}`, `--out=${outDir}`]);
    expect(res.code).toBe(1);
    expect(res.stderr + res.stdout).toMatch(/duplicate ids in catalog source: dup-curl/);
  });

test('malformed catalog (entries normalize to no usable ids) fails before coverage or draft writes', () => {
    const rows = [row('Kappa Curl')];
    const { dir } = fixtureCatalog([]);
    const { outDir } = seedCommitted(dir, rows);
    const cat = path.join(dir, 'catalog.json');
    fs.writeFileSync(cat, JSON.stringify(rows));
    run(['--drafts', `--catalog=${cat}`, `--out=${outDir}`, '--fixed-date=2026-01-01T00:00:00.000Z']);
    const invBefore = fs.readFileSync(path.join(outDir, 'exercise-inventory.json'), 'utf8');
    const profBefore = fs.readFileSync(path.join(outDir, 'exercise-profiles.v1.json'), 'utf8');

    // entries that all normalize away: punctuation-only, blank, missing name
    const malformed = path.join(dir, 'malformed.json');
    fs.writeFileSync(malformed, JSON.stringify([{ name: '!!!', primaryMuscles: [] }, { name: '   ' }, { noName: true }]));

    const checkRes = run(['--check', `--catalog=${malformed}`, `--out=${outDir}`]);
    expect(checkRes.code).toBe(1);
    expect(checkRes.stderr + checkRes.stdout).toMatch(/none normalize to a usable exercise id/);

    const draftRes = run(['--drafts', `--catalog=${malformed}`, `--out=${outDir}`, '--fixed-date=2026-01-01T00:00:00.000Z']);
    expect(draftRes.code).toBe(1);
    expect(draftRes.stderr + draftRes.stdout).toMatch(/none normalize to a usable exercise id/);

    // neither command may mutate the committed artifacts
    expect(fs.readFileSync(path.join(outDir, 'exercise-inventory.json'), 'utf8')).toBe(invBefore);
    expect(fs.readFileSync(path.join(outDir, 'exercise-profiles.v1.json'), 'utf8')).toBe(profBefore);
  });

  test('real committed inventory covers the real vendored catalog', () => {
    const res = run(['--check', `--out=${REAL_INV}`]);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/coverage check passed/);
    expect(res.stdout).toMatch(/"catalogRows": [1-9]/); // nonempty catalog exercised
  });
});
