// P2 registry invariants + ingest gate.
const { registry, lookup, gateIngest } = require('../src/services/pose/datasetLicensing');

describe('licensing registry invariants', () => {
  it('prohibited datasets are isolated or blocked', () => {
    for (const d of registry.datasets.filter(x => x.commercialTraining === 'prohibited')) {
      expect(['blocked', 'outside_training_root']).toContain(d.isolation);
    }
  });
  it('every entry carries a verdict basis', () => {
    for (const d of registry.datasets) expect(d.verdictBasis?.length).toBeGreaterThan(10);
  });
  it('no prohibited entry is suitable for training', () => {
    for (const d of registry.datasets.filter(x => x.commercialTraining === 'prohibited')) {
      expect(d.suitableFor).not.toContain('training');
    }
  });
  it('youtube-derived datasets are prohibited', () => {
    for (const id of ['kinetics', 'ucf-101']) expect(lookup(id).commercialTraining).toBe('prohibited');
  });
});

describe('gateIngest', () => {
  it('rejects unknown datasets by default', () => {
    expect(gateIngest('random-dataset').allowed).toBe(false);
  });
  it('blocks prohibited datasets with their basis', () => {
    const r = gateIngest('mpii-human-pose');
    expect(r.allowed).toBe(false);
    expect(r.verdict).toBe('prohibited');
    expect(r.reason).toMatch(/research/i);
  });
  it('holds restricted datasets pending license review', () => {
    expect(gateIngest('pexels-videos').allowed).toBe(false);
    expect(gateIngest('pexels-videos').verdict).toBe('restricted');
  });
  it('admits consented self-recordings for training + evaluation', () => {
    expect(gateIngest('humai-self-recorded', { purpose: 'training' }).allowed).toBe(true);
    expect(gateIngest('humai-self-recorded', { purpose: 'evaluation' }).allowed).toBe(true);
  });
  it('admits synthetic fixtures for tests but never evaluation metrics', () => {
    expect(gateIngest('synthetic-fixtures', { purpose: 'tests' }).allowed).toBe(true);
    expect(gateIngest('synthetic-fixtures', { purpose: 'evaluation' }).allowed).toBe(false);
  });
});
