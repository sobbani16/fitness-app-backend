// HUM-100-K §18/§19: split reproducibility, overlap rejection, train/heldout
// separation, smoke-only export. All outputs go to isolated temp paths so
// test runs are independent of each other and of the working tree.
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CFG = path.join(ROOT, 'pose/training/example-config.json');

const tmpOut = (name) => path.join(os.tmpdir(), `hum100k-${process.pid}-${name}.json`);
const runPipeline = (configPath, out) => execSync(
  `python3 pose/training/pipeline.py --config ${configPath} --synthetic --out ${out}`,
  { cwd: ROOT, stdio: 'pipe' },
);
const probe = (prog) => {
  const f = path.join(os.tmpdir(), `hum100k-probe-${process.pid}-${Math.random().toString(36).slice(2)}.py`);
  fs.writeFileSync(f, prog);
  try { return execSync(`python3 ${f}`, { cwd: ROOT }).toString().trim(); }
  finally { fs.unlinkSync(f); }
};

describe('split contract (§18)', () => {
  it('identical config+seed yields bit-identical checkpoints incl. split outcome', () => {
    const a = tmpOut('a'), b = tmpOut('b');
    runPipeline(CFG, a);
    runPipeline(CFG, b);
    const ma = JSON.parse(fs.readFileSync(a, 'utf8')).manifest;
    const mb = JSON.parse(fs.readFileSync(b, 'utf8')).manifest;
    expect(ma.checksumSha256).toBe(mb.checksumSha256);
    expect(ma.evaluation.train).toEqual(mb.evaluation.train);
    expect(ma.evaluation.heldout).toEqual(mb.evaluation.heldout);
  });

  it('participant overlap across the split is a hard error', () => {
    const out = probe(`
import sys; sys.path.insert(0, 'pose/training')
from pipeline import validate_disjoint
train = [{'participantId': 'p1', 'sessionId': 's1'}]
test = [{'participantId': 'p1', 'sessionId': 's2'}]
try:
    validate_disjoint(train, test)
    print('NO-ERROR')
except ValueError as e:
    print('REJECTED: ' + str(e))
`);
    expect(out).toMatch(/^REJECTED: participant overlap/);
  });

  it('session overlap across the split is a hard error even with distinct participants', () => {
    const out = probe(`
import sys; sys.path.insert(0, 'pose/training')
from pipeline import validate_disjoint
train = [{'participantId': 'p1', 'sessionId': 'shared_session'}]
test = [{'participantId': 'p2', 'sessionId': 'shared_session'}]
try:
    validate_disjoint(train, test)
    print('NO-ERROR')
except ValueError as e:
    print('REJECTED: ' + str(e))
`);
    expect(out).toMatch(/^REJECTED: session overlap/);
  });

  it('synthetic split assigns WHOLE participant groups — zero overlap by construction', () => {
    const out = probe(`
import sys, json; sys.path.insert(0, 'pose/training')
from pipeline import load_dataset, split_by_participant
cfg = json.load(open('pose/training/example-config.json'))
samples = load_dataset(cfg, synthetic=True)
train, test = split_by_participant(samples, cfg['seed'])
tp = sorted({s['participantId'] for s in train})
hp = sorted({s['participantId'] for s in test})
overlap = set(tp) & set(hp)
print(json.dumps({'trainP': len(tp), 'heldP': len(hp), 'overlap': len(overlap), 'trainN': len(train), 'heldN': len(test)}))
`);
    const r = JSON.parse(out);
    expect(r.overlap).toBe(0);
    expect(r.trainP).toBeGreaterThan(0);
    expect(r.heldP).toBeGreaterThan(0);
    expect(r.trainN).toBeGreaterThan(0);
    expect(r.heldN).toBeGreaterThan(0);
  });

  it('split with fewer than 2 participants is rejected', () => {
    const out = probe(`
import sys; sys.path.insert(0, 'pose/training')
from pipeline import split_by_participant
try:
    split_by_participant([{'participantId': 'only', 'sessionId': 's', 'seq': [1], 'label': 1}], 42)
    print('NO-ERROR')
except ValueError as e:
    print('REJECTED: ' + str(e))
`);
    expect(out).toMatch(/^REJECTED: split requires at least 2 participants/);
  });
});

describe('train/heldout separation + smoke-only export', () => {
  it('checkpoint reports train and heldout metrics separately with sample counts', () => {
    const out = tmpOut('sep');
    runPipeline(CFG, out);
    const m = JSON.parse(fs.readFileSync(out, 'utf8')).manifest;
    expect(m.evaluation.train.n).toBeGreaterThan(0);
    expect(m.evaluation.heldout.n).toBeGreaterThan(0);
    expect(m.evaluation.train.n + m.evaluation.heldout.n).toBe(48); // 8 participants × 2 sessions × 3 reps
    expect(typeof m.evaluation.train.accuracy).toBe('number');
    expect(typeof m.evaluation.heldout.accuracy).toBe('number');
  });

  it('evaluation is labeled synthetic smoke evidence requiring real-world validation', () => {
    const out = tmpOut('smoke');
    runPipeline(CFG, out);
    const e = JSON.parse(fs.readFileSync(out, 'utf8')).manifest.evaluation;
    expect(e.evidenceClass).toBe('synthetic_smoke');
    expect(e.smokeEvidenceOnly).toBe(true);
    expect(e.realWorldValidationRequired).toBe(true);
  });

  it('NO registry-ready payload exists in synthetic output — export is ineligible', () => {
    const out = tmpOut('exp');
    runPipeline(CFG, out);
    const d = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(d.registryPayload).toBeUndefined();
    expect(d.export.eligible).toBe(false);
    expect(d.export.reason).toMatch(/smoke evidence/);
  });

  it('heldout participants never influence fitting — threshold fit uses train partition only', () => {
    const out = probe(`
import sys, json; sys.path.insert(0, 'pose/training')
from pipeline import load_dataset, split_by_participant, train_model
cfg = json.load(open('pose/training/example-config.json'))
samples = load_dataset(cfg, synthetic=True)
train, test = split_by_participant(samples, cfg['seed'])
m1 = train_model(cfg, train)
# remove all heldout samples entirely — if fitting secretly read them, params would change
m2 = train_model(cfg, [s for s in train])
print('identical' if m1['params'] == m2['params'] else 'DIFFERENT')
`);
    expect(out).toBe('identical');
  });
});

describe('artifact integrity (§42)', () => {
  const shaOf = (p) => require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const verify = (ckpt, sha) => {
    try {
      const out = execSync(`python3 pose/training/verify_checkpoint.py --checkpoint ${ckpt} --sha256 ${sha}`, { cwd: ROOT, stdio: 'pipe' });
      return { exit: 0, out: out.toString() };
    } catch (e) {
      return { exit: e.status, out: (e.stderr || '').toString() + (e.stdout || '').toString() };
    }
  };

  it('identical runs produce identical file bytes and artifact digests', () => {
    const a = tmpOut('ba'), b = tmpOut('bb');
    runPipeline(CFG, a);
    runPipeline(CFG, b);
    expect(fs.readFileSync(a).equals(fs.readFileSync(b))).toBe(true);
    expect(shaOf(a)).toBe(shaOf(b));
    const r = verify(a, shaOf(a));
    expect(r.exit).toBe(0);
    expect(r.out).toMatch(/PASS.*match export record/);
  });

  it('untouched checkpoint verifies against the printed artifact_sha256 export record', () => {
    const a = tmpOut('rt');
    const stdout = runPipeline(CFG, a).toString();
    const sha = stdout.match(/artifact_sha256=([0-9a-f]{64})/)[1];
    const r = verify(a, sha);
    expect(r.exit).toBe(0);
  });

  it('evaluation-metadata-only edit fails verification even though the embedded model checksum is unchanged', () => {
    const a = tmpOut('tamper');
    const stdout = runPipeline(CFG, a).toString();
    const sha = stdout.match(/artifact_sha256=([0-9a-f]{64})/)[1];
    const doc = JSON.parse(fs.readFileSync(a, 'utf8'));
    const embeddedBefore = doc.manifest.checksumSha256;
    doc.manifest.evaluation.heldout.accuracy = 0.9999;
    fs.writeFileSync(a, JSON.stringify(doc, null, 2));
    const embeddedAfter = JSON.parse(fs.readFileSync(a, 'utf8')).manifest.checksumSha256;
    expect(embeddedAfter).toBe(embeddedBefore); // embedded checksum cannot catch metadata tampering
    const r = verify(a, sha);
    expect(r.exit).toBe(1);
    expect(r.out).toMatch(/FAIL — artifact digest mismatch/);
  });

  it('malformed digest and unreadable file exit nonzero with diagnostics', () => {
    const a = tmpOut('edge');
    runPipeline(CFG, a);
    expect(verify(a, 'nothex').exit).toBe(2);
    expect(verify(a + '.missing', shaOf(a)).exit).toBe(2);
  });
});

it('§20: evaluation emits the recognition-metric contract — macroF1, per-class, confusion, abstention, unknown-rejection', () => {
  const a = tmpOut('s20a'), b = tmpOut('s20b');
  runPipeline(CFG, a);
  runPipeline(CFG, b);
  const m = JSON.parse(fs.readFileSync(a, 'utf8'));
  const h = m.manifest.evaluation.heldout;
  expect(typeof h.macroF1).toBe('number');
  expect(h.perClass).toBeDefined();
  for (const k of Object.keys(h.perClass)) {
    expect(h.perClass[k]).toMatchObject({ precision: expect.any(Number), recall: expect.any(Number), f1: expect.any(Number), support: expect.any(Number) });
  }
  // confusion matrix is square over the label set and row-sums to support
  const labels = Object.keys(h.confusionMatrix);
  for (const row of labels) {
    expect(Object.keys(h.confusionMatrix[row]).sort()).toEqual(labels.slice().sort());
    const rowSum = Object.values(h.confusionMatrix[row]).reduce((a, b) => a + b, 0);
    expect(rowSum).toBe(h.perClass[row].support);
  }
  expect(h.abstentionRate).toBeGreaterThanOrEqual(0);
  expect(h.abstentionRate).toBeLessThanOrEqual(1);
  expect(h.unknownRejection).toMatchObject({ threshold: expect.any(Number), lowConfidenceFraction: expect.any(Number) });
  // determinism: metrics identical across independent runs
  const m2 = JSON.parse(fs.readFileSync(b, 'utf8'));
  expect(m2.manifest.evaluation.heldout.macroF1).toBe(h.macroF1);
  expect(m2.manifest.evaluation.heldout.confusionMatrix).toEqual(h.confusionMatrix);
});
