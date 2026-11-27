/**
 * Regression coverage for pc-HUM-28 defects #329/#332 — person-property
 * targeting was silently dead platform-wide because the provider called
 * posthog-node v5 getAllFlags with the legacy positional signature, so zero
 * person properties ever reached evaluation.
 *
 * The mock PostHog client simulates server-side release-condition semantics
 * faithfully: a property-targeted flag matches only when the supplied
 * personProperties satisfy the condition (proven behavior on staging —
 * absent properties never match); a plain-rollout flag matches regardless.
 */
const mockGetAllFlags = jest.fn();
const mockFindUnique = jest.fn();
const mockPrisma = { user: { findUnique: mockFindUnique } };

jest.mock('posthog-node', () => ({
  PostHog: jest.fn().mockImplementation(() => ({
    getAllFlags: mockGetAllFlags,
    shutdown: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const flags = require('../src/services/featureFlags/service');
const provider = require('../src/services/featureFlags/provider');
const { FEATURES, envOverrideName } = require('../src/config/featureRegistry');

const TARGETED_KEY = 'ai_coach';            // default false — provider must be decisive
const PLAIN_KEY = 'manual_food_logging';    // simulates a plain 100% rollout flag

const VERIFIED = new Date('2026-01-01T00:00:00Z');
const USERS = {
  'u-internal': { email: 'tester@humai-internal.test', emailVerifiedAt: VERIFIED },
  'u-external': { email: 'person@gmail.com', emailVerifiedAt: VERIFIED },
  // Impersonation attempt: internal-domain address never verified.
  'u-unverified-internal': { email: 'tester@humai-internal.test', emailVerifiedAt: null },
};

function clearAllEnvOverrides() {
  for (const key of Object.keys(FEATURES)) delete process.env[envOverrideName(key)];
}
function restoreEnvOverrides() {
  for (const key of Object.keys(FEATURES)) {
    if (FEATURES[key].class !== 'control' && FEATURES[key].group !== 'medical') {
      process.env[envOverrideName(key)] = 'true';
    }
  }
}

beforeEach(() => {
  process.env.FEATURE_FLAGS_PROVIDER = 'posthog';
  process.env.POSTHOG_API_KEY = process.env.POSTHOG_API_KEY || 'phc_test_key';
  clearAllEnvOverrides();
  mockFindUnique.mockReset();
  mockFindUnique.mockImplementation(async ({ where }) => USERS[where.id] || null);
  mockGetAllFlags.mockReset();
  // Simulated PostHog project configuration:
  //   ai_coach            — release condition: email icontains humai-internal.test
  //   manual_food_logging — plain 100% rollout, no properties
  mockGetAllFlags.mockImplementation(async (distinctId, options) => {
    const email = (options && options.personProperties && options.personProperties.email) || '';
    return {
      [TARGETED_KEY]: email.includes('humai-internal.test'),
      [PLAIN_KEY]: true,
    };
  });
  flags.resetCache();
});

afterEach(() => {
  process.env.FEATURE_FLAGS_PROVIDER = 'env';
  restoreEnvOverrides();
  flags.resetCache();
});

describe('person-property targeting (defects #329/#332)', () => {
  test('targeted flag matches when the verified email satisfies the release condition', async () => {
    expect(await flags.isEnabled(TARGETED_KEY, 'u-internal')).toBe(true);
    // Exact argument shape: posthog-node v5 options object carrying personProperties.
    expect(mockGetAllFlags).toHaveBeenCalledWith('u-internal', {
      personProperties: { email: 'tester@humai-internal.test' },
    });
    // Lookup is minimal — email + verification state only, never the full row.
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'u-internal' },
      select: { email: true, emailVerifiedAt: true },
    });
  });

  test('non-matching verified user still evaluates false', async () => {
    expect(await flags.isEnabled(TARGETED_KEY, 'u-external')).toBe(false);
    expect(mockGetAllFlags).toHaveBeenCalledWith('u-external', {
      personProperties: { email: 'person@gmail.com' },
    });
  });

  test('plain-rollout flags are unaffected by targeting properties', async () => {
    expect(await flags.isEnabled(PLAIN_KEY, 'u-external')).toBe(true);
    expect(await flags.isEnabled(PLAIN_KEY, 'u-internal')).toBe(true);
  });

  test('unverified email never enters targeting — impersonation of internal domain fails closed', async () => {
    expect(await flags.isEnabled(TARGETED_KEY, 'u-unverified-internal')).toBe(false);
    expect(mockGetAllFlags).toHaveBeenCalledWith('u-unverified-internal', { personProperties: {} });
  });

  test('missing user degrades without error — evaluation proceeds with empty properties', async () => {
    await expect(flags.isEnabled(TARGETED_KEY, 'u-nonexistent')).resolves.toBe(false);
    expect(mockGetAllFlags).toHaveBeenCalledWith('u-nonexistent', { personProperties: {} });
    // Plain rollout still works in the degraded mode.
    expect(await flags.isEnabled(PLAIN_KEY, 'u-nonexistent')).toBe(true);
  });

  test('database error degrades gracefully — no throw, targeted closed, plain rollout preserved', async () => {
    mockFindUnique.mockRejectedValueOnce(new Error('db connection reset'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(flags.isEnabled(TARGETED_KEY, 'u-internal')).resolves.toBe(false);
    expect(await flags.isEnabled(PLAIN_KEY, 'u-internal')).toBe(true);
    expect(mockGetAllFlags).toHaveBeenCalledWith('u-internal', { personProperties: {} });
    warn.mockRestore();
  });

  test('property resolution rides the per-user flag cache — one DB hit per cache window', async () => {
    await flags.evaluateAll('u-internal');
    await flags.evaluateAll('u-internal');
    await flags.isEnabled(TARGETED_KEY, 'u-internal');
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    expect(mockGetAllFlags).toHaveBeenCalledTimes(1);
    flags.resetCache();
    await flags.evaluateAll('u-internal');
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
    expect(mockGetAllFlags).toHaveBeenCalledTimes(2);
  });

  test('provider boundary: fetchProviderFlags forwards personProperties into the v5 options object', async () => {
    await provider.fetchProviderFlags('u-direct', { email: 'direct@humai-internal.test' });
    expect(mockGetAllFlags).toHaveBeenCalledWith('u-direct', {
      personProperties: { email: 'direct@humai-internal.test' },
    });
  });

  test('env override precedence is preserved — FF_* still beats provider targeting', async () => {
    process.env[envOverrideName(TARGETED_KEY)] = 'false';
    flags.resetCache();
    expect(await flags.isEnabled(TARGETED_KEY, 'u-internal')).toBe(false);
  });
});
