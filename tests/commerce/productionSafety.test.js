// PM-09 hard requirement: mock payment provider must NEVER be production-usable.
// The guard exists in code (getProvider 403, webhookSecret 503) but was unpinned —
// these probes verify the enforcement actually fires under production conditions.
// Technique: fresh module registry per probe with controlled NODE_ENV — the env
// classification must be read at call time, not frozen at require time.
describe('mock-provider production safety — the card hard requirement, executable proof', () => {
  const loadFresh = (nodeEnv) => {
    jest.resetModules();
    process.env.NODE_ENV = nodeEnv;
    delete process.env.PAYMENTS_WEBHOOK_SECRET;
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
    return require('../../src/services/payments/provider');
  };
  afterEach(() => { process.env.NODE_ENV = 'test'; jest.resetModules(); });

  test('getProvider("mock") in production → throws, mock is never production-usable', () => {
    const { getProvider } = loadFresh('production');
    expect(() => getProvider('mock')).toThrow(/mock payment provider is disabled in production/i);
  });

  test('getProvider() defaulted (PAYMENTS_PROVIDER unset) in production → same refusal', () => {
    const { getProvider } = loadFresh('production');
    delete process.env.PAYMENTS_PROVIDER;
    expect(() => getProvider()).toThrow(/disabled in production/i);
  });

  test('mock provider resolves fine in NON-production (dev/test not broken by the guard)', () => {
    const { getProvider } = loadFresh('test');
    const p = getProvider('mock');
    expect(p.name).toBe('mock');
  });

  test('webhook secret UNSET in production → provider construction throws (no silent fallback)', () => {
    const { getProvider } = loadFresh('production');
    process.env.PAYMENTS_PROVIDER = 'mock'; // even explicitly requested
    // production guard fires first — but if any path constructs MockProvider directly,
    // the secret fallback must also refuse. Both layers verified:
    expect(() => getProvider()).toThrow();
  });

  test('mock-secret fallback exists ONLY outside production — direct construction in prod refuses', () => {
    loadFresh('production');
    const { MockProvider } = require('../../src/services/payments/provider');
    expect(() => new MockProvider()).toThrow(/webhook secret is not configured/i);
  });

  test('mock-secret fallback DOES apply in test env — developer experience preserved', () => {
    loadFresh('test');
    const { MockProvider } = require('../../src/services/payments/provider');
    const p = new MockProvider();
    expect(typeof p.sign('{}')).toBe('string'); // fallback secret functional
  });

  test('production WITH secret configured: direct construction succeeds — real-provider path unblocked', () => {
    loadFresh('production');
    process.env.PAYMENTS_WEBHOOK_SECRET = 'synthetic-test-secret-not-a-real-credential';
    const { MockProvider } = require('../../src/services/payments/provider');
    const p = new MockProvider();
    expect(p.secret).toBe('synthetic-test-secret-not-a-real-credential');
    delete process.env.PAYMENTS_WEBHOOK_SECRET;
  });

  test('unknown provider name → 400-class rejection, never silently falls back to mock', () => {
    const { getProvider } = loadFresh('test');
    expect(() => getProvider('stripe-but-not-implemented')).toThrow(/unsupported payment provider/i);
  });
});
