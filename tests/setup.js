process.env.AUTH_TEST_BYPASS = 'true';
// Tests predate the flag system: enable every registered flag so existing
// suites keep their previous behavior. Flag-specific tests override per-case
// and call featureFlags.resetCache() between assertions.
process.env.FEATURE_FLAGS_PROVIDER = 'env';
const { KEYS, FEATURES, envOverrideName } = require('../src/config/featureRegistry');
// Control-plane and medical-group flags are NOT auto-enabled: they must be
// explicitly turned on per-test, mirroring production governance.
for (const key of KEYS) if (FEATURES[key].class !== 'control' && FEATURES[key].group !== 'medical') process.env[envOverrideName(key)] = 'true';
