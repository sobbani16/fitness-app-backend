// Feature flag registry + evaluator + enforcement tests.
const flags = require('../src/services/featureFlags/service');
const { FEATURES, AI_GROUP_KEYS, envOverrideName } = require('../src/config/featureRegistry');

const setEnv = (key, value) => { process.env[envOverrideName(key)] = value; };
const clearEnv = (key) => { delete process.env[envOverrideName(key)]; };

afterEach(() => {
  delete process.env.AI_EMERGENCY_SHUTDOWN;
  for (const key of Object.keys(FEATURES)) setEnv(key, 'true'); // restore setup.js defaults
  delete process.env[envOverrideName('ai_emergency_shutdown')];
  flags.resetCache();
});

describe('registry', () => {
  test('manual logging flags are core, fail-open, and outside the AI group', () => {
    for (const key of ['manual_food_logging', 'manual_exercise_logging']) {
      expect(FEATURES[key].class).toBe('core');
      expect(FEATURES[key].group).not.toBe('ai');
      expect(FEATURES[key].failOpen).toBe(true);
      expect(FEATURES[key].default).toBe(true);
    }
    expect(AI_GROUP_KEYS).not.toContain('manual_food_logging');
    expect(AI_GROUP_KEYS).not.toContain('manual_exercise_logging');
    expect(AI_GROUP_KEYS).not.toContain('pose_detection');
  });

  test('every flag has a camelCase clientKey', () => {
    for (const f of Object.values(FEATURES)) expect(f.clientKey).toMatch(/^[a-z][a-zA-Z]+$/);
  });
});

describe('evaluation precedence (env provider)', () => {
  test('env override wins over registry default', async () => {
    setEnv('ai_coach', 'false');
    expect(await flags.isEnabled('ai_coach', 'u1')).toBe(false);
    setEnv('ai_coach', 'true');
    flags.resetCache();
    expect(await flags.isEnabled('ai_coach', 'u1')).toBe(true);
  });

  test('AI_EMERGENCY_SHUTDOWN env kills every group:ai flag regardless of overrides', async () => {
    process.env.AI_EMERGENCY_SHUTDOWN = 'true';
    flags.resetCache();
    for (const key of AI_GROUP_KEYS) expect(await flags.isEnabled(key, 'u1')).toBe(false);
    expect(await flags.isEnabled('manual_food_logging', 'u1')).toBe(true);
    expect(await flags.isEnabled('manual_exercise_logging', 'u1')).toBe(true);
  });

  test('ai_emergency_shutdown flag (env override path) also kills group:ai', async () => {
    setEnv('ai_emergency_shutdown', 'true');
    flags.resetCache();
    expect(await flags.isAiShutdown('u1')).toBe(true);
    expect(await flags.isEnabled('ai_coach', 'u1')).toBe(false);
    expect(await flags.isEnabled('manual_food_logging', 'u1')).toBe(true);
  });

  test('dependsOn: voice flags off when their manual dep resolves false', async () => {
    setEnv('manual_food_logging', 'false');
    flags.resetCache();
    expect(await flags.isEnabled('voice_food_logging', 'u1')).toBe(false);
    expect(await flags.isEnabled('voice_exercise_logging', 'u1')).toBe(true); // depends on exercise
  });

  test('unknown keys fail closed', async () => {
    expect(await flags.isEnabled('does_not_exist', 'u1')).toBe(false);
  });

  test('results cached per user', async () => {
    await flags.evaluateAll('u-cache');
    setEnv('ai_coach', 'false');
    expect(await flags.isEnabled('ai_coach', 'u-cache')).toBe(true); // cached
    flags.resetCache();
    expect(await flags.isEnabled('ai_coach', 'u-cache')).toBe(false);
  });
});

describe('clientConfig', () => {
  test('emits camelCase keys only, includes every registry flag', async () => {
    const out = await flags.clientConfig('u2');
    for (const f of Object.values(FEATURES)) expect(Object.keys(out)).toContain(f.clientKey);
    expect(out.aiCoach).toBe(true);
    expect(Object.keys(out)).not.toContain('ai_coach');
  });
});

describe('PostHog provider outage fallback', () => {
  test('provider error => env overrides + defaults only (ai defaults closed, manual open)', async () => {
    process.env.FEATURE_FLAGS_PROVIDER = 'posthog';
    const provider = require('../src/services/featureFlags/provider');
    jest.spyOn(provider, 'fetchProviderFlags').mockRejectedValue(new Error('posthog down'));
    for (const key of Object.keys(FEATURES)) clearEnv(key);
    flags.resetCache();
    expect(await flags.isEnabled('ai_coach', 'u3')).toBe(false);      // default closed
    expect(await flags.isEnabled('manual_food_logging', 'u3')).toBe(true); // fail-open core
    provider.fetchProviderFlags.mockRestore();
    process.env.FEATURE_FLAGS_PROVIDER = 'env';
    for (const key of Object.keys(FEATURES)) setEnv(key, 'true');
  });
});
