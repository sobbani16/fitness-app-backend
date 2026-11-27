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

// Per-test process.env isolation: jest isolates module registries per file but
// NOT the process environment — with --runInBand every file shares one process,
// so a suite mutating a flag env (or any env) without restoring it leaks into
// every later file. That leak is the residual AUTH_RBAC-class flake: a leaked
// flag deletion turns a requireFeature gate closed and unauthenticated probes
// see 403 instead of 401. Snapshot/restore per test makes mutation leakage
// structurally impossible while leaving setup.js bootstrap values intact
// (they are set before the first snapshot).
let envSnapshot = null;
beforeEach(() => { envSnapshot = { ...process.env }; });
afterEach(() => {
  if (!envSnapshot) return;
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(envSnapshot)) {
    if (process.env[key] !== value) process.env[key] = value;
  }
});

// File-boundary env restoration: per-test snapshot/restore handles intra-file
// leaks, but module-level and beforeAll mutations predate the first snapshot
// and would otherwise persist into every later file. Restore the pristine
// bootstrap snapshot (captured in setup.js) after each file completes.
afterAll(() => {
  const pristine = globalThis.__PRISTINE_ENV_SNAPSHOT;
  if (!pristine) return;
  for (const key of Object.keys(process.env)) {
    if (!(key in pristine)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(pristine)) {
    if (process.env[key] !== value) process.env[key] = value;
  }
});
