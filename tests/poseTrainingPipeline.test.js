// §19: the Python training pipeline must be reproducible end-to-end —
// identical (config, datasetVersion, seed) → bit-identical checkpoint
// checksum, and the export payload matches what MlModel registration expects.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const run = (out) => execSync(
  `python3 pose/training/pipeline.py --config pose/training/example-config.json --synthetic --out ${out}`,
  { cwd: path.join(__dirname, '..'), stdio: 'pipe' }
);

describe('training pipeline reproducibility (§19)', () => {
  it('identical config+seed yields bit-identical checkpoints', () => {
    run('/tmp/hum100-ck-a.json');
    run('/tmp/hum100-ck-b.json');
    const a = JSON.parse(fs.readFileSync('/tmp/hum100-ck-a.json', 'utf8')).manifest;
    const b = JSON.parse(fs.readFileSync('/tmp/hum100-ck-b.json', 'utf8')).manifest;
    expect(a.checksumSha256).toBe(b.checksumSha256);
    expect(a.configHash).toBe(b.configHash);
  });

  it('checkpoint manifest carries the full reproducibility stamp', () => {
    run('/tmp/hum100-ck-c.json');
    const m = JSON.parse(fs.readFileSync('/tmp/hum100-ck-c.json', 'utf8')).manifest;
    for (const k of ['configHash', 'seed', 'datasetVersion', 'exerciseId', 'architecture', 'checksumSha256']) {
      expect(m[k]).toBeDefined();
    }
    expect(m.seed).toBe(42);
    expect(m.exerciseId).toBe('squat');
  });

  it('export payload matches the MlModel registration contract', () => {
    const payload = JSON.parse(fs.readFileSync('/tmp/hum100-ck-c.json', 'utf8')).registryPayload;
    for (const k of ['exerciseId', 'architecture', 'datasetVersion', 'configHash', 'seed', 'checksumSha256', 'evalResults']) {
      expect(payload[k]).toBeDefined();
    }
    expect(payload.architecture).toBe('deterministic_baseline');
    expect(payload.evalResults.accuracy).toBeGreaterThan(0.5); // mean-correlated synthetic — proves the trainer learns
  });

  it('different seeds yield different checkpoints (seed actually matters)', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pose/training/example-config.json'), 'utf8'));
    cfg.seed = 1337;
    fs.writeFileSync('/tmp/hum100-cfg-alt.json', JSON.stringify(cfg));
    execSync('python3 pose/training/pipeline.py --config /tmp/hum100-cfg-alt.json --synthetic --out /tmp/hum100-ck-d.json', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
    const base = JSON.parse(fs.readFileSync('/tmp/hum100-ck-c.json', 'utf8')).manifest;
    const alt = JSON.parse(fs.readFileSync('/tmp/hum100-ck-d.json', 'utf8')).manifest;
    expect(alt.checksumSha256).not.toBe(base.checksumSha256);
    expect(alt.configHash).not.toBe(base.configHash);
  });
});
