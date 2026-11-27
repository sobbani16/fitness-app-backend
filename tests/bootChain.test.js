// SEC-P07 boot-chain pins (pc-HUM-77): test-only overrides impossible in production,
// startup validation before serving traffic. Child-process spawns prove the real
// boot chain — module-level reasoning alone cannot pin process behavior.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BASE_ENV = { PATH: process.env.PATH, HOME: process.env.HOME };

function boot(env, timeoutMs = 15000) {
  return spawnSync('node', ['src/index.js'], {
    cwd: ROOT,
    env: { ...BASE_ENV, ...env },
    encoding: 'utf8',
    timeout: timeoutMs,
  });
}

describe('test-only overrides are impossible in production', () => {
  it('boot refuses when AUTH_TEST_BYPASS is configured in production', () => {
    const r = boot({ NODE_ENV: 'production', AUTH_TEST_BYPASS: 'true' });
    expect(r.status).toBe(1);
    expect((r.stderr + r.stdout)).toMatch(/Test authentication bypass cannot be configured in production/);
  });

  it('authenticate middleware: bypass inert when Railway env is production even with NODE_ENV=test', async () => {
    const saved = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.AUTH_TEST_BYPASS = 'true';
    process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
    // Shape-valid signing secret so module load succeeds — the question under
    // test is bypass inertness, orthogonal to the fail-closed secret gate
    // (which correctly throws without one, as verified in securityHardening).
    process.env.AUTH_LINK_SECRET = 'x7Qm9vLp2nR8sT4wY6zA1bC3dE5fG7hJ';
    jest.resetModules();
    try {
      const mw = require('../src/middleware/authenticate');
      let nextArgs = null;
      let statusWritten = null;
      const req = { headers: {}, query: {} };
      const res = { status: (s) => { statusWritten = s; return { json: () => {} }; } };
      await mw(req, res, (...a) => { nextArgs = a; });
      // Bypass-active signature: clean next() with no auth attempted and no userId.
      // Inert signature: real authentication runs — no token → 401 written or error forwarded.
      const bypassActivated = nextArgs !== null && nextArgs.length === 0 && statusWritten === null && req.userId === undefined && !req.headers['x-user-id'];
      expect(bypassActivated).toBe(false);
    } finally {
      process.env = { ...saved };
    }
  });

  it('authenticate middleware: bypass still works in a pure test environment (regression control)', async () => {
    const saved = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.AUTH_TEST_BYPASS = 'true';
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
    jest.resetModules();
    try {
      const mw = require('../src/middleware/authenticate');
      let cleanNext = false;
      await mw({ headers: {}, query: {} }, {}, (...a) => { cleanNext = a.length === 0; });
      expect(cleanNext).toBe(true);
    } finally {
      process.env = { ...saved };
    }
  });

  it('requireVerifiedEmail: bypass inert under Railway production — prisma is consulted', async () => {
    const saved = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.AUTH_TEST_BYPASS = 'true';
    process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
    jest.resetModules();
    try {
      let prismaConsulted = false;
      jest.doMock('../src/lib/prisma', () => ({
        getPrisma: () => ({
          user: { findUnique: async () => { prismaConsulted = true; return { emailVerifiedAt: new Date() }; } },
        }),
      }));
      const mw = require('../src/middleware/requireVerifiedEmail');
      let cleanNext = false;
      await mw({ userId: 'u1' }, {}, (...a) => { cleanNext = a.length === 0; });
      expect(prismaConsulted).toBe(true); // bypass did not short-circuit
      expect(cleanNext).toBe(true);       // verified user proceeds normally
      jest.dontMock('../src/lib/prisma');
    } finally {
      process.env = { ...saved };
    }
  });
});

describe('startup validation runs before serving traffic', () => {
  it('production boot with missing required secrets exits 1 naming variables, never binding', () => {
    const r = boot({ NODE_ENV: 'production' });
    expect(r.status).toBe(1);
    const out = r.stderr + r.stdout;
    expect(out).toMatch(/Missing required configuration/);
    expect(out).toMatch(/DATABASE_URL/);
    expect(out).not.toMatch(/Backend listening/);
  });

  it('validation passes when required vars are present — failure moves past the config gate', () => {
    const r = boot({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://127.0.0.1:59999/nonexistent_db',
      AUTH_LINK_SECRET: 'x7Qm9vLp2nR8sT4wY6zA1bC3dE5fG7hJ',
      RESEND_API_KEY: 're_test_shape_only_not_a_real_key_000',
    }, 8000);
    const out = r.stderr + r.stdout;
    // Config gate passed: the failure (if any) is downstream — prisma connect — never the config error.
    expect(out).not.toMatch(/Missing required configuration/);
  });
});
