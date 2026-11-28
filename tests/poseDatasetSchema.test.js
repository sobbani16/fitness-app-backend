// Dataset infra verification for pc-HUM-68: schemas reject malformed records
// and enforce the participant-disjoint split invariant.
const { validateAnnotation, validateConsent, validateManifest } = require('../src/services/pose/datasetSchema');

const annotation = (over = {}) => ({
  schemaVersion: 1, clipId: 'clip-001', exercise: 'squat', view: 'front_45',
  subjectPseudonym: 'subj-a3f9', fps: 30, durationS: 45,
  reps: [
    { repIndex: 0, startFrame: 12, endFrame: 92, phases: [{ phase: 'descent', startFrame: 12, endFrame: 60 }, { phase: 'ascent', startFrame: 61, endFrame: 92 }] },
    { repIndex: 1, startFrame: 100, endFrame: 180, uncertain: true, occluded: true },
  ],
  labels: { form: 'minor_deviation', technique: ['knee_valgus'] },
  annotator: { id: 'ann-7', annotatedAt: '2026-11-25T10:00:00Z', reviewedBy: 'rev-2', agreement: 0.87, rubricVersion: 'rubric-v1' },
  ...over,
});
const consent = (over = {}) => ({
  schemaVersion: 1, subjectPseudonym: 'subj-a3f9',
  consent: { capturedAt: '2026-11-20T09:00:00Z', scope: ['training', 'evaluation'], document: 'consent-form-v2' },
  sourceRights: { kind: 'in_house_capture', acquiredAt: '2026-11-20T09:05:00Z' },
  revocation: { revocable: true, channel: 'in-app privacy center' },
  ...over,
});
const manifest = (over = {}) => ({
  schemaVersion: 1, datasetVersion: 'v0.1.0', generatedAt: '2026-11-25T12:00:00Z',
  subjects: ['subj-0001', 'subj-0002', 'subj-0003', 'subj-0004'],
  splits: { train: ['subj-0001', 'subj-0002'], validation: ['subj-0003'], test: ['subj-0004'], policy: 'participant_disjoint' },
  provenance: { sources: [{ sourceId: 'src-1', kind: 'in_house_capture', sha256: 'a'.repeat(64), consentRecordRef: 'consent-1' }] },
  retention: { rawAccess: 'restricted_role', deletionProcedure: 'revocation → raw delete → derived re-derive → audit' },
  ...over,
});

describe('annotation schema', () => {
  it('accepts a complete annotation with phases + flags', () => {
    expect(validateAnnotation(annotation()).valid).toBe(true);
  });
  it('rejects an exercise outside the 5-exercise set', () => {
    const r = validateAnnotation(annotation({ exercise: 'burpee' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/exercise/);
  });
  it('rejects missing rep boundaries', () => {
    const a = annotation(); delete a.reps[0].startFrame;
    expect(validateAnnotation(a).valid).toBe(false);
  });
});

describe('consent-record schema', () => {
  it('accepts a complete consent record', () => {
    expect(validateConsent(consent()).valid).toBe(true);
  });
  it('rejects a record with no revocation channel (revocation is mandatory)', () => {
    const c = consent(); delete c.revocation.channel;
    expect(validateConsent(c).valid).toBe(false);
  });
  it('rejects an out-of-scope consent purpose', () => {
    const c = consent({ consent: { ...consent().consent, scope: ['advertising'] } });
    expect(validateConsent(c).valid).toBe(false);
  });
});

describe('manifest — participant-disjoint splits', () => {
  it('accepts a disjoint partition', () => {
    expect(validateManifest(manifest()).valid).toBe(true);
  });
  it('rejects a subject in two splits', () => {
    const m = manifest(); m.splits.test.push('subj-0001');
    const r = validateManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/more than one split/);
  });
  it('rejects an undeclared subject and an unassigned declared subject', () => {
    const m = manifest(); m.splits.train.push('ghost-9'); m.subjects.push('unassigned-5');
    const r = validateManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/not declared/);
    expect(r.errors.join()).toMatch(/assigned to no split/);
  });
});
