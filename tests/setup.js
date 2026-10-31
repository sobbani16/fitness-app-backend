process.env.AUTH_TEST_BYPASS = 'true';
// Tests predate the flag system: enable every registered flag so existing
// suites keep their previous behavior. Flag-specific tests override per-case
// and call featureFlags.resetCache() between assertions.
process.env.FEATURE_FLAGS_PROVIDER = 'env';
const { KEYS, FEATURES, envOverrideName } = require('../src/config/featureRegistry');
for (const key of KEYS) if (FEATURES[key].class !== 'control') process.env[envOverrideName(key)] = 'true';
