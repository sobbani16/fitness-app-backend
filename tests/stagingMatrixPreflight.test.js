// HUM-28 §6.2: read-only preflight validation — synthetic manifests + mocked reads only.
const { preflight, validateManifest, manifestDigest } = require('../scripts/staging-matrix-preflight');

const healthy = async () => ({ service: 'fitness-app-backend', commit: 'df477eea2fcc', version: '0.1.0' });
const ARTIFACT = { id: 'qa-deployed-matrix-151', revision: 'sha256:abc123' };

function validCase(id, n = 1) {
  return {
    id,
    requiredFlags: [{ key: 'activity_safety_engine', value: true }],
    endpoint: '/activity-safety/evaluate',
    expected: { status: 200, decision: 'DEFER_OUTDOOR' },
    fixturePrereqs: [],
  };
}
const validManifest = (cases) => ({ artifact: ARTIFACT, cases });

describe('§6.2 read-only preflight', () => {
  it('valid manifest + confirmed identity → executable ordered run plan', async () => {
    const cases = Array.from({ length: 9 }, (_, i) => validCase(`CASE-${i + 1}`));
    const r = await preflight({ manifest: validManifest(cases), readHealthVersion: healthy, expectedSha: 'df477ee' });
    expect(r.executable).toBe(true);
    expect(r.caseCount).toBe(9);
    expect(r.deployedSha).toBe('df477eea2fcc');
    expect(r.plan[0].order).toBe(1);
    expect(r.plan[8].caseId).toBe('CASE-9');
  });

  it('missing artifact provenance → not executable (unsourced IDs never run)', async () => {
    const m = { cases: [validCase('X1')] };
    const r = await preflight({ manifest: m, readHealthVersion: healthy, expectedSha: 'df477ee' });
    expect(r.executable).toBe(false);
    expect(r.reason).toMatch(/artifact/);
  });

  it('duplicate case IDs rejected', async () => {
    const r = await preflight({ manifest: validManifest([validCase('DUP'), validCase('DUP')]), readHealthVersion: healthy, expectedSha: 'df477ee' });
    expect(r.executable).toBe(false);
    expect(r.reason).toMatch(/duplicate case id DUP/);
  });

  it('unknown flags rejected against the canonical registry', async () => {
    const bad = validCase('F1');
    bad.requiredFlags = [{ key: 'make_everything_safe', value: true }];
    const r = await preflight({ manifest: validManifest([bad]), readHealthVersion: healthy, expectedSha: 'df477ee' });
    expect(r.executable).toBe(false);
    expect(r.reason).toMatch(/unknown flag 'make_everything_safe'/);
  });

  it('cases missing endpoint or expected result are unverifiable → rejected', async () => {
    const noEndpoint = validCase('E1'); delete noEndpoint.endpoint;
    const noExpected = validCase('E2'); delete noExpected.expected;
    const r1 = await preflight({ manifest: validManifest([noEndpoint]), readHealthVersion: healthy, expectedSha: 'x' });
    const r2 = await preflight({ manifest: validManifest([noExpected]), readHealthVersion: healthy, expectedSha: 'x' });
    expect(r1.reason).toMatch(/endpoint/);
    expect(r2.reason).toMatch(/expected result missing/);
  });

  it('deployed SHA mismatch → not executable', async () => {
    const r = await preflight({ manifest: validManifest([validCase('S1')]), readHealthVersion: healthy, expectedSha: 'deadbeef' });
    expect(r.executable).toBe(false);
    expect(r.reason).toMatch(/does not match reviewed SHA/);
  });

  it('unreadable health endpoint → identity unverifiable → not executable', async () => {
    const r = await preflight({ manifest: validManifest([validCase('H1')]), readHealthVersion: async () => null, expectedSha: 'df477ee' });
    expect(r.executable).toBe(false);
    expect(r.reason).toMatch(/unreadable/);
  });

  it('missing reviewed SHA → not executable', async () => {
    const r = await preflight({ manifest: validManifest([validCase('H2')]), readHealthVersion: healthy, expectedSha: '' });
    expect(r.executable).toBe(false);
    expect(r.reason).toMatch(/no reviewed SHA/);
  });

  it('manifest digest is stable and content-derived', () => {
    const a = manifestDigest(validManifest([validCase('Z')]));
    const b = manifestDigest(validManifest([validCase('Z')]));
    const c = manifestDigest(validManifest([validCase('Y')]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
