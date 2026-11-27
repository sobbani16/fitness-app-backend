// Load .env FIRST so TEST_DATABASE_URL/DATABASE_URL are populated before the guard.
require('dotenv').config();
// Test-database guard (Sprint G Phase 0): runs before any suite imports prisma.
// 1. TEST_DATABASE_URL set → it REPLACES DATABASE_URL for the whole test run.
// 2. Otherwise DATABASE_URL must be a positively-identified local database —
//    remote hosts are refused outright (no test may touch prod/shared infra).
//    Set ALLOW_REMOTE_TEST_DB=1 only for a dedicated remote test instance.
process.env.AUTH_TEST_BYPASS = 'true';
// Flag-cache isolation is enforced per-test in tests/setupAfterEnv.js via
// service.resetCache() — see docs/nutrition-intelligence/AUTH_RBAC_FLAKE_INVESTIGATION.md.
(() => {
  if (process.env.TEST_DATABASE_URL) {
    // Bound each suite's Prisma pool: ~150 test files each spawn a client;
    // default pool size exhausts Postgres max_connections and caused
    // intermittent 500s in real-DB suites.
    let testUrl = process.env.TEST_DATABASE_URL;
    if (!/connection_limit=/.test(testUrl)) testUrl += (testUrl.includes('?') ? '&' : '?') + 'connection_limit=2&pool_timeout=20';
    process.env.DATABASE_URL = testUrl;
    console.log('[tests] DATABASE_URL swapped to TEST_DATABASE_URL (isolated test database)');
  }
  const url = process.env.DATABASE_URL || '';
  if (!url) return; // suites without a DB get prisma stubs downstream
  const host = (url.match(/@([^:/]+)/) || [])[1] || '';
  const isLocal = /^(localhost|127\.0\.0\.1|::1|host\.docker\.internal)$/i.test(host);
  if (!isLocal && process.env.ALLOW_REMOTE_TEST_DB !== '1') {
    throw new Error(`[tests] REFUSING to run against non-local database host "${host}". ` +
      'Tests may only target a dedicated local test database. Set TEST_DATABASE_URL to an ' +
      'isolated database, or ALLOW_REMOTE_TEST_DB=1 for an intentionally remote test instance.');
  }
  if (isLocal && !/test|humai_dev|fitness/i.test(url) && process.env.ALLOW_UNLABELED_DB !== '1') {
    console.warn(`[tests] WARNING: DATABASE_URL target is local but unlabeled as a test db — fixture writes may touch development data. Set TEST_DATABASE_URL to isolate.`);
  }
})();
// Tests predate the flag system: enable every registered flag so existing
// suites keep their previous behavior. Flag-specific tests override per-case
// and call featureFlags.resetCache() between assertions.
process.env.FEATURE_FLAGS_PROVIDER = 'env';
// §12 FF cache isolation: TTL must be zero in tests. The service reads
// FF_CACHE_TTL_MS once at module load; resetCache() alone cannot close the
// flake vector because an in-flight flag resolution can re-populate the cache
// AFTER the per-test reset — a stale flag-off resolution then poisons the next
// test sharing the userId key (order/timing-dependent 403/404-vs-401 flakes).
// With TTL=0 the service never writes cache entries at all.
process.env.FF_CACHE_TTL_MS = '0';
const { KEYS, FEATURES, envOverrideName } = require('../src/config/featureRegistry');
// Control-plane and medical-group flags are NOT auto-enabled: they must be
// explicitly turned on per-test, mirroring production governance.
for (const key of KEYS) if (FEATURES[key].class !== 'control' && FEATURES[key].group !== 'medical') process.env[envOverrideName(key)] = 'true';

// Pristine-env baseline: module registries reset per test FILE but process.env
// is shared across all files in the worker. Test files mutate env at module
// level / in hooks / in tests, and jest's sequencer orders files differently
// run-to-run — so mutations leak into whichever file happens to run next,
// producing order-dependent 403/404-vs-401 flakes. Snapshot the bootstrap
// state once (first file to run); setupAfterEnv restores it at every file end.
if (!globalThis.__PRISTINE_ENV_SNAPSHOT) {
  globalThis.__PRISTINE_ENV_SNAPSHOT = { ...process.env };
}
