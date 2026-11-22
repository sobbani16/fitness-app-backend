// Global per-suite teardown: release this suite's PrismaClient connections.
// Each jest test file gets a fresh module registry → a fresh PrismaClient →
// pooled Postgres connections. With ~137 suites and max_connections=100 the
// accumulated idle connections saturate Postgres and later suites fail with
// hangs (socket hang up) or flag-service errors (fail-closed 403s). Suites
// that already disconnect hit this path harmlessly ($disconnect is safe to
// repeat); mocked-prisma suites throw inside try/catch.
afterAll(async () => {
  try { await require('../src/lib/prisma').getPrisma().$disconnect(); } catch { /* mocked or never connected */ }
});

// Per-test flag-cache isolation: suites share a worker process; a cached flag
// resolution for a shared userId ('trainer-1', 'client-1', ...) would otherwise
// leak into the next test/file as a transient 403. resetCache clears between
// tests while leaving cache semantics intact (verified by featureFlags.test).
afterEach(() => { try { require('../src/services/featureFlags/service').resetCache(); } catch (_) {} });
