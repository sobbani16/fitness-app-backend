// HUM-100-K: manifest preflight — valid partition accepted; every defect
// class rejected with stable codes that never leak subject ids or storage refs.
const { preflightManifest } = require('../src/services/pose/datasetManifestPreflight');

const SHA = 'a'.repeat(64);
const SHA2 = 'b'.repeat(64);

function validManifest(over = {}) {
  return {
    schemaVersion: 1,
    datasetVersion: 'v1-test',
    generatedAt: '2026-11-26T00:00:00Z',
    subjects: ['subj-aaaa', 'subj-bbbb', 'subj-cccc', 'subj-dddd'],
    splits: {
      train: ['subj-aaaa', 'subj-bbbb'],
      validation: ['subj-cccc'],
      test: ['subj-dddd'],
      policy: 'participant_disjoint',
    },
    provenance: {
      sources: [
        { sourceId: 'humai-self-recorded', kind: 'in_house_capture', sha256: SHA, consentRecordRef: 'cr-1' },
      ],
    },
    retention: { rawAccess: 'restricted_role', deletionProcedure: 'revocation cascades to raw footage, annotations, derived artifacts' },
    ...over,
  };
}

describe('valid manifests', () => {
  it('accepts a well-formed disjoint exhaustive partition with an approved source', () => {
    const r = preflightManifest(validManifest(), { expectedDatasetVersion: 'v1-test' });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
});

describe('structural rejection paths', () => {
  const cases = [
    ['version mismatch', { datasetVersion: 'v9-other' }, 'MANIFEST_VERSION_MISMATCH'],
    ['malformed schema version', { schemaVersion: 2 }, 'MANIFEST_MALFORMED'],
    ['duplicate subjects', { subjects: ['subj-aaaa', 'subj-aaaa', 'subj-cccc', 'subj-dddd'] }, 'MANIFEST_DUPLICATE_SUBJECT'],
    ['empty train split', { splits: { train: [], validation: ['subj-cccc'], test: ['subj-dddd'], policy: 'participant_disjoint' } }, 'MANIFEST_SPLIT_EMPTY'],
    ['overlap across splits', { splits: { train: ['subj-aaaa', 'subj-bbbb'], validation: ['subj-aaaa'], test: ['subj-cccc', 'subj-dddd'], policy: 'participant_disjoint' } }, 'MANIFEST_SPLIT_OVERLAP'],
    ['unknown subject in split', { splits: { train: ['subj-aaaa', 'subj-bbbb'], validation: ['subj-cccc'], test: ['subj-zzzz'], policy: 'participant_disjoint' } }, 'MANIFEST_SPLIT_UNKNOWN_SUBJECT'],
    ['omitted subject (non-exhaustive)', { splits: { train: ['subj-aaaa', 'subj-bbbb'], validation: ['subj-cccc'], test: ['subj-cccc'], policy: 'participant_disjoint' }, subjects: ['subj-aaaa', 'subj-bbbb', 'subj-cccc', 'subj-dddd'] }, 'MANIFEST_SPLIT_INCOMPLETE'],
    ['invalid digest', { provenance: { sources: [{ sourceId: 'humai-self-recorded', kind: 'in_house_capture', sha256: 'nothex' }] } }, 'MANIFEST_INVALID_DIGEST'],
    ['duplicate source ids', { provenance: { sources: [
      { sourceId: 'humai-self-recorded', kind: 'in_house_capture', sha256: SHA },
      { sourceId: 'humai-self-recorded', kind: 'licensed_dataset', sha256: SHA2 },
    ] } }, 'MANIFEST_DUPLICATE_SOURCE'],
  ];
  for (const [name, over, code] of cases) {
    it(`rejects ${name} with ${code}`, () => {
      const r = preflightManifest(validManifest(over), { expectedDatasetVersion: 'v1-test' });
      expect(r.valid).toBe(false);
      expect(r.codes).toContain(code);
    });
  }
});

describe('source licensing rejection paths', () => {
  const mk = (sourceId) => validManifest({ provenance: { sources: [{ sourceId, kind: 'licensed_dataset', sha256: SHA }] } });
  it('rejects unknown sources — absent from the registry', () => {
    const r = preflightManifest(mk('not-in-registry'));
    expect(r.codes).toContain('MANIFEST_SOURCE_UNKNOWN');
  });
  it('rejects prohibited sources (mpii-human-pose)', () => {
    const r = preflightManifest(mk('mpii-human-pose'));
    expect(r.codes).toContain('MANIFEST_SOURCE_PROHIBITED');
  });
  it('rejects restricted sources (coco-keypoints)', () => {
    const r = preflightManifest(mk('coco-keypoints'));
    expect(r.codes).toContain('MANIFEST_SOURCE_RESTRICTED');
  });
  it('rejects smoke-only synthetic fixtures — suitable for tests, not training+evaluation', () => {
    const r = preflightManifest(mk('synthetic-fixtures'));
    expect(r.codes).toContain('MANIFEST_SOURCE_NOT_SUITABLE');
  });
  it('rejects pexels (restricted, reference-only)', () => {
    const r = preflightManifest(mk('pexels-videos'));
    expect(r.codes).toContain('MANIFEST_SOURCE_RESTRICTED');
  });
});

describe('diagnostic hygiene', () => {
  it('error output never contains subject ids or storage references', () => {
    const m = validManifest({
      splits: { train: ['subj-aaaa', 'subj-bbbb'], validation: ['subj-aaaa'], test: ['subj-cccc', 'subj-dddd'], policy: 'participant_disjoint' },
    });
    const r = preflightManifest(m);
    const blob = JSON.stringify(r.errors);
    for (const s of m.subjects) expect(blob).not.toContain(s);
    expect(blob).not.toMatch(/storageRef|obj-store|s3:\/\//);
  });
});
