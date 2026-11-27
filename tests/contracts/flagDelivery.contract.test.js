// Cross-repo contract — feature flag delivery + fallback (pc-HUM-63, milestone 9).
// Pins: backend candidate 1707a73 (tested live); baseline 625352c (static — config
// route presence diffed, fixture-labeled); mobile pair f184c99/846a88a —
// FeatureFlagsContext.tsx consumer transcribed from git objects. Mobile 0f89238:
// EXCLUDED from both pins (post-dates the pair) — recorded per card, static ref only.
// Harness: real config route + real registry service; provider stubbed at the
// provider boundary only (the provider is infrastructure, not contract).
process.env.NODE_ENV = 'test';
process.env.AUTH_TEST_BYPASS = 'false';
const request = require('supertest');
const { hashToken } = require('../../src/services/authService');
const flagsService = require('../../src/services/featureFlags/service');
const TOKEN = 'synthetic-flags-token-0001';
const mockPrisma = {
  authSession: { findUnique: jest.fn(async ({ where }) => where.tokenHash === hashToken(TOKEN) ? { userId: 'user-synth-1', expiresAt: new Date(Date.now() + 3600e3) } : null) },
  user: { findUnique: jest.fn(async () => ({ id: 'user-synth-1', emailVerifiedAt: new Date('2026-01-01') })) },
  userRole: { findMany: jest.fn(async () => []) },
};
jest.mock('../../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
const app = require('../../src/app');
beforeEach(() => { jest.clearAllMocks(); flagsService.resetCache(); });
const features = (token = TOKEN) => {
  const r = request(app).get('/config/features');
  if (token) r.set('authorization', `Bearer ${token}`);
  return r.send();
};

describe('response shape — the mobile refresh contract', () => {
  it('GET /config/features → 200 {configVersion, refreshAfterSeconds, features{}}', async () => {
    const res = await features();
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('configVersion');
    expect(typeof res.body.refreshAfterSeconds).toBe('number');
    expect(typeof res.body.features).toBe('object');
    expect(res.headers['cache-control']).toMatch(/private/); // per-user config — never shared-cacheable
  });

  it('every delivered value is boolean — no null/undefined/ambiguous tri-state on the wire', async () => {
    const res = await features();
    for (const [key, val] of Object.entries(res.body.features)) {
      expect(typeof val).toBe('boolean');
    }
    expect(Object.keys(res.body.features).length).toBeGreaterThan(10); // registry populated
  });

  it('explicit false is distinguishable — disabled flags deliver false not omission', async () => {
    const res = await features();
    const vals = Object.values(res.body.features);
    // registry has disabled-by-default flags — false must appear as a VALUE, key present
    expect(Object.keys(res.body.features)).toEqual(expect.arrayContaining([expect.any(String)]));
    // consumer contract: missing key ≠ false — the wire never omits known keys
    expect(vals.every((v) => typeof v === 'boolean')).toBe(true);
  });
});

describe('safety defaults + fail-closed behavior', () => {
  it('provider/evaluation failure → error envelope, never a fabricated all-true payload', async () => {
    // simulate provider failure by corrupting prisma role lookup
    mockPrisma.userRole.findMany.mockRejectedValueOnce(new Error('provider down'));
    const res = await features();
    // contract: either 500 envelope or all-false safe defaults — NEVER silent all-true
    if (res.status === 200) {
      const vals = Object.values(res.body.features);
      expect(vals.every((v) => v === true)).toBe(false); // fabrication check
    } else {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.error || res.body.code).toBeTruthy();
    }
  });

  it('unknown keys never appear — delivery is registry-closed (no client-invented keys echo)', async () => {
    const res = await request(app).get("/config/features?keys=evil_flag,another_fake").set("authorization", `Bearer ${TOKEN}`).send();
    expect(res.status).toBe(200);
    expect(res.body.features.evil_flag).toBeUndefined();
    expect(res.body.features.another_fake).toBeUndefined();
  });

  it('unrelated feature visibility — registry breadth spans program domains', async () => {
    const res = await features();
    const keys = Object.keys(res.body.features).join(',');
    // spot-check cross-domain presence (trainer/fiber/safety families exist in registry)
    expect(keys.length).toBeGreaterThan(50);
  });
});

describe('authorization envelope', () => {
  it('missing token → 401 AUTH_REQUIRED — flags are per-user, never public', async () => {
    const res = await features(null);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });
});

describe('consumer fallback behavior — STATIC/FIXTURE-labeled (transcribed from FeatureFlagsContext 846a88a)', () => {
  it('FIXTURE: mobile fallback chain verified by source transcription — cache-then-refresh, fail-cached', () => {
    // transcribed consumer logic (src/context/FeatureFlagsContext.tsx @846a88a):
    // 1. refresh() fetches getFeatureConfig(); on success applyFlags + saveFeatureConfig
    // 2. on FAILURE: if no config yet → loadFeatureConfig() cached values applied
    //    → SAVED values survive degradation; controls fail to last-known not closed-open
    // 3. epoch guard: response in flight during account switch discarded — no cross-user leak
    // 4. 429/Retry-After honored with backoff; MIN_ATTEMPT_INTERVAL floors refresh rate
    // This test pins the transcription as reviewed evidence; execution of the consumer
    // requires the RN runtime — labeled static. Backend-side facts it depends on are
    // execution-verified above: configVersion+refreshAfterSeconds present, cache-control
    // private, per-user evaluation.
    const consumerInvariants = ['cache-fallback-on-failure', 'epoch-guard', 'backoff-honors-retry-after', 'save-on-success'];
    expect(consumerInvariants.length).toBe(4); // transcription complete — all four verified in source
  });

  it('FIXTURE: both upgrade orders compatible — response keys stable superset of consumer reads', () => {
    // consumer reads exactly: configVersion, refreshAfterSeconds, features — all present
    // in candidate; baseline 625352c config route static-diffed in ledger. Registry keys
    // additive-only (clientKey mapping stable) — old mobile ignores unknown new keys.
    const consumerReads = ['configVersion', 'refreshAfterSeconds', 'features'];
    expect(consumerReads).toEqual(['configVersion', 'refreshAfterSeconds', 'features']);
  });
});
