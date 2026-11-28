/**
 * Shared test-database URL resolution — single source of truth for the
 * precedence rule used by both tests/setup.js (per-suite env mutation) and
 * tests/globalSetup.js (once-per-run verify-or-provision).
 *
 * Precedence: TEST_DATABASE_URL wins when set; otherwise DATABASE_URL.
 * Returns null when neither is configured (pure-unit mode — prisma is
 * stubbed downstream and no database is expected).
 *
 * NOTE: dotenv never overrides existing environment variables. A shell-
 * exported TEST_DATABASE_URL therefore beats anything in .env — this is
 * the environment trap documented in AGENTS.md.
 */
function resolveTestDatabaseUrl(env = process.env) {
  return env.TEST_DATABASE_URL || env.DATABASE_URL || null;
}

/**
 * Positive identification of a local test database, mirroring the setup.js
 * guard: localhost-family host AND a name labeled as a test database.
 * Provisioning must refuse anything else — never mutate remote or
 * unlabeled databases.
 */
function isPositiveTestDatabase(url) {
  const host = (url.match(/@([^:/]+)/) || [])[1] || '';
  const isLocal = /^(localhost|127\.0\.0\.1|::1|host\.docker\.internal)$/i.test(host);
  const name = decodeURIComponent((url.match(/\/([^/?]+)(\?|$)/) || [])[1] || '');
  return { isLocal, name, ok: isLocal && /test/i.test(name) };
}

module.exports = { resolveTestDatabaseUrl, isPositiveTestDatabase };
