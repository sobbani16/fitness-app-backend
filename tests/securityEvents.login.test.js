// Wiring-level test: POST /auth/login emits structured security events through
// the real route, real password verification, and the test database. Sink output
// is captured from console and asserted for allowlist shape + redaction.
const request = require('supertest');
const { getPrisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/services/authService');

const prisma = getPrisma();
const PW = 'synthetic-login-fixture-pass1';
const ids = [];

function captureConsole() {
  const lines = [];
  const origInfo = console.info, origWarn = console.warn;
  console.info = l => lines.push(l);
  console.warn = l => lines.push(l);
  return { lines, restore: () => { console.info = origInfo; console.warn = origWarn; } };
}

beforeAll(() => {
  if (!require('./testDbUrl').isPositiveTestDatabase(process.env.DATABASE_URL || '').ok) throw new Error('must target a positively-identified local test database');
});
afterAll(async () => {
  for (const model of ['authSession']) await prisma[model].deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  await prisma.$disconnect();
});

test('login success emits security event with actor ref; failure emits actorless warning; neither leaks credentials', async () => {
  const app = require('../src/app');
  const email = `sectest-${Math.random().toString(36).slice(2, 10)}@syn.local`;
  const passwordHash = await hashPassword(PW);
  const user = await prisma.user.create({ data: { email, passwordHash } });
  ids.push(user.id);

  const cap = captureConsole();
  try {
    const bad = await request(app).post('/auth/login').send({ email, password: 'wrong-password-zzz' });
    expect(bad.status).toBe(401);
    const good = await request(app).post('/auth/login').send({ email, password: PW });
    expect(good.status).toBe(200);
  } finally {
    cap.restore();
  }

  const events = cap.lines.filter(l => typeof l === 'string' && l.includes('"event":"security"')).map(l => JSON.parse(l));
  expect(events.length).toBe(2);

  const failure = events.find(e => e.result === 'failure');
  const success = events.find(e => e.result === 'success');
  expect(failure).toBeTruthy();
  expect(failure.outcomeReason).toBe('invalid_credentials');
  expect(failure.severity).toBe('warn');
  expect(failure.actorRef).toBeUndefined();
  expect(success).toBeTruthy();
  expect(success.actorRef).toBe(user.id);
  expect(success.severity).toBe('info');
  expect(success.requestId).toBeTruthy();

  // The credential material must never appear in any captured output.
  for (const line of cap.lines) {
    if (typeof line !== 'string') continue;
    expect(line.includes(PW)).toBe(false);
    expect(line.includes('wrong-password-zzz')).toBe(false);
    expect(line.includes(email)).toBe(false);
    expect(line.includes(passwordHash)).toBe(false);
  }
});
