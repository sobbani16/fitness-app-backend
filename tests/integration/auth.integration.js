const request = require('supertest');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/fitness_auth_readiness') throw new Error('Use only the disposable localhost fitness_auth_readiness database.');
process.env.AUTH_TEST_BYPASS = 'false';
process.env.AUTH_LINK_SECRET = 'ab'.repeat(32);
process.env.AUTH_PUBLIC_URL = 'http://localhost:4000';
process.env.AUTH_EMAIL_FROM = 'Fitness <accounts@example.test>';
process.env.RESEND_API_KEY = 'test-only-no-real-email';
const prisma = new PrismaClient();
global.__fitnessPrisma = prisma;
const app = require('../../src/app');
const { actionToken, consumeLimit, validateConfig } = require('../../src/services/authLifecycle');
const { drainEmails, sendEmail } = require('../../src/services/authEmail');
const password = 'Original-password-123';
const newPassword = 'Changed-password-456';
const email = () => `auth-${randomUUID()}@example.test`;
async function register(address = email()) {
  const res = await request(app).post('/auth/register').send({ email: address, password }).expect(201);
  return res.body;
}
async function action(user, purpose) {
  return prisma.authAction.findFirst({ where: { userId: user.user.id, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
}
const post = (path, body) => request(app).post(`/auth/${path}`).send(body);
beforeAll(async () => { await prisma.role.upsert({ where: { name: 'MEMBER' }, create: { name: 'MEMBER' }, update: {} }); });
beforeEach(async () => {
  await prisma.authAction.deleteMany(); await prisma.authSession.deleteMany(); await prisma.userRole.deleteMany();
  await prisma.user.deleteMany(); await prisma.authRateBucket.deleteMany();
});
afterAll(async () => { await prisma.$disconnect(); });

test('registration, queued email, browser verification, login, protected API; GET does not consume', async () => {
  const user = await register('Case.Normalized@example.test');
  expect(user.user.email).toBe('case.normalized@example.test'); expect(user.user.emailVerifiedAt).toBeNull();
  await request(app).get('/me/profile').set('Authorization', `Bearer ${user.token}`).expect(403);
  const delivered = [];
  await drainEmails(async job => delivered.push(job));
  expect(delivered).toHaveLength(1);
  const job = delivered[0], token = actionToken(job.id);
  expect(job.tokenHash).not.toBe(token); expect(JSON.stringify(job)).not.toContain(token);
  const page = await request(app).get('/auth/action').expect(200);
  expect(page.headers['cache-control']).toBe('no-store');
  expect(page.headers['referrer-policy']).toBe('no-referrer');
  expect(page.headers['content-security-policy']).toContain("script-src 'self'");
  expect((await action(user, 'verify-email')).consumedAt).toBeNull();
  await post('verify-email', { token }).expect(200);
  await post('verify-email', { token }).expect(400);
  const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${user.token}`).expect(200);
  expect(me.body.user.emailVerifiedAt).toBeTruthy();
  await request(app).get('/me/profile').set('Authorization', `Bearer ${user.token}`).expect(200);
  const login = await post('login', { email: user.user.email, password }).expect(200);
  expect(login.body.user.emailVerifiedAt).toBeTruthy();
});
test('reset revokes all sessions and sibling links; old password fails; no automatic login', async () => {
  const user = await register();
  const session2 = (await post('login', { email: user.user.email, password }).expect(200)).body;
  await post('forgot-password', { email: user.user.email }).expect(202);
  const first = await action(user, 'reset-password');
  await post('forgot-password', { email: user.user.email }).expect(202);
  const second = await action(user, 'reset-password');
  const response = await post('reset-password', { token: actionToken(second.id), password: newPassword }).expect(200);
  expect(response.body.token).toBeUndefined();
  for (const session of [user, session2]) await request(app).get('/auth/me').set('Authorization', `Bearer ${session.token}`).expect(401);
  await post('reset-password', { token: actionToken(first.id), password: newPassword }).expect(400);
  await post('reset-password', { token: actionToken(second.id), password: newPassword }).expect(400);
  await post('login', { email: user.user.email, password }).expect(401);
  await post('login', { email: user.user.email, password: newPassword }).expect(200);
});
test.each(['verify-email', 'reset-password'])('%s rejects expired/wrong-purpose tokens and consumes only once under concurrency', async purpose => {
  const user = await register();
  if (purpose === 'reset-password') await post('forgot-password', { email: user.user.email }).expect(202);
  const job = await action(user, purpose), token = actionToken(job.id);
  const other = purpose === 'verify-email' ? 'reset-password' : 'verify-email';
  await post(other, { token, password: newPassword }).expect(400);
  await prisma.authAction.update({ where: { id: job.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  await post(purpose, { token, password: newPassword }).expect(400);
  await prisma.authAction.update({ where: { id: job.id }, data: { expiresAt: new Date(Date.now() + 60000) } });
  const responses = await Promise.all(Array.from({ length: 5 }, () => post(purpose, { token, password: newPassword })));
  expect(responses.map(r => r.status).sort()).toEqual([200, 400, 400, 400, 400]);
});
test('unknown accounts, throttled accounts and verified resend use the same response', async () => {
  const user = await register();
  const unknown = await post('forgot-password', { email: email() }).expect(202);
  for (let i = 0; i < 5; i++) expect((await post('forgot-password', { email: user.user.email }).expect(202)).body).toEqual(unknown.body);
  expect(await prisma.authAction.count({ where: { purpose: 'reset-password' } })).toBe(3);
  await post('verify-email', { token: actionToken((await action(user, 'verify-email')).id) }).expect(200);
  expect((await post('resend-verification', { email: user.user.email }).expect(202)).body).toEqual(unknown.body);
  expect(await prisma.authAction.count({ where: { purpose: 'verify-email' } })).toBe(1);
});
test('database rate limit is atomic, persists across callers, resets only after expiration', async () => {
  const results = await Promise.all(Array.from({ length: 12 }, () => consumeLimit('test', 'same-address', 3, 60000)));
  expect(results.filter(Boolean)).toHaveLength(3);
  expect(await consumeLimit('test', 'same-address', 3, 60000)).toBe(false);
  await prisma.authRateBucket.updateMany({ data: { expiresAt: new Date(0) } });
  expect(await consumeLimit('test', 'same-address', 3, 60000)).toBe(true);
});
test('IP throttling returns 429 and Retry-After; malformed token/password never consumes link', async () => {
  const user = await register();
  await post('forgot-password', { email: user.user.email }).expect(202);
  const token = actionToken((await action(user, 'reset-password')).id);
  await post('reset-password', { token, password: 'short' }).expect(400);
  await post('reset-password', { token: {}, password: newPassword }).expect(400);
  await post('reset-password', { token, password: newPassword }).expect(200);
  for (let i = 0; i < 30; i++) await post('forgot-password', { email: 'absent@example.test' });
  const res = await post('forgot-password', { email: email() }).expect(429);
  expect(res.headers['retry-after']).toBe('900');
});
test('queue retries failed delivery, uses safe provider request and never sends expired/consumed links', async () => {
  const user = await register(); const job = await action(user, 'verify-email');
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  await drainEmails(async () => { throw new Error('provider unavailable'); });
  expect(log).toHaveBeenCalledWith('Auth email delivery failed', { jobId: job.id, attempt: 1 });
  log.mockRestore();
  await prisma.authAction.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(0) } });
  const savedFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  try {
    await drainEmails(sendEmail);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(options.headers['Idempotency-Key']).toBe(`auth-action/${job.id}`);
    expect(JSON.parse(options.body).text).toContain('/auth/action#purpose=verify-email&token=');
    expect(options.signal).toBeDefined();
    await drainEmails(sendEmail); expect(global.fetch).toHaveBeenCalledTimes(1);
  } finally { global.fetch = savedFetch; }
  await post('forgot-password', { email: user.user.email }).expect(202);
  await prisma.authAction.updateMany({ data: { expiresAt: new Date(0) } });
  const send = jest.fn(); await drainEmails(send); expect(send).not.toHaveBeenCalled();
});
test('resend queues a new link; sibling verification becomes unusable after success', async () => {
  const user = await register(), first = await action(user, 'verify-email');
  await post('resend-verification', { email: user.user.email }).expect(202);
  const second = await action(user, 'verify-email'); expect(second.id).not.toBe(first.id);
  await post('verify-email', { token: actionToken(second.id) }).expect(200);
  await post('verify-email', { token: actionToken(first.id) }).expect(400);
});
test('email change invalidates old links and configuration rejects insecure production origins', async () => {
  const user = await register(), job = await action(user, 'verify-email');
  await prisma.user.update({ where: { id: user.user.id }, data: { email: email() } });
  await post('verify-email', { token: actionToken(job.id) }).expect(400);
  validateConfig();
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production'; expect(() => validateConfig()).toThrow('HTTPS'); process.env.NODE_ENV = original;
});

test('queue workers claim jobs only once and expired or consumed jobs are skipped', async () => {
  await register(); await register();
  const delivered = [];
  await Promise.all([drainEmails(async job => delivered.push(job.id)), drainEmails(async job => delivered.push(job.id))]);
  expect(delivered).toHaveLength(2); expect(new Set(delivered).size).toBe(2);
  const user = await register();
  await prisma.authAction.updateMany({ where: { userId: user.user.id }, data: { consumedAt: new Date() } });
  const send = jest.fn(); await drainEmails(send); expect(send).not.toHaveBeenCalled();
});
test('old-password login racing reset cannot leave a usable old session', async () => {
  const user = await register();
  await post('forgot-password', { email: user.user.email }).expect(202);
  const token = actionToken((await action(user, 'reset-password')).id);
  const [login, reset] = await Promise.all([post('login', { email: user.user.email, password }), post('reset-password', { token, password: newPassword })]);
  expect(reset.status).toBe(200); expect([200, 401]).toContain(login.status);
  if (login.status === 200) await request(app).get('/auth/me').set('Authorization', `Bearer ${login.body.token}`).expect(401);
});
test('actual email-page script completes verification and reset over HTTP, clears secrets and handles mismatch/replay', async () => {
  const vm = require('node:vm');
  const source = (await request(app).get('/auth/action.js').expect(200)).text;
  const user = await register();
  function page(purpose, token) {
    const elements = new Map();
    const document = { getElementById(id) {
      if (!elements.has(id)) elements.set(id, { value: '', hidden: true, disabled: false, textContent: '', handlers: {}, addEventListener(event, handler) { this.handlers[event] = handler; } });
      return elements.get(id);
    } };
    const replaceState = jest.fn();
    const fetch = jest.fn(async (path, options) => {
      const response = await request(app).post(path).send(JSON.parse(options.body));
      return { ok: response.status < 400, json: async () => response.body };
    });
    vm.runInNewContext(source, { document, location: { hash: `#purpose=${purpose}&token=${token}`, pathname: '/auth/action' }, history: { replaceState }, URLSearchParams, AbortSignal, fetch });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/auth/action');
    expect(fetch).not.toHaveBeenCalled();
    return { el: document.getElementById, submit: () => document.getElementById('action').handlers.submit({ preventDefault() {} }) };
  }
  const verify = page('verify-email', actionToken((await action(user, 'verify-email')).id));
  await verify.submit(); expect(verify.el('message').textContent).toContain('Email verified');
  await post('forgot-password', { email: user.user.email }).expect(202);
  const reset = page('reset-password', actionToken((await action(user, 'reset-password')).id));
  reset.el('password').value = newPassword; reset.el('confirm').value = 'mismatch';
  await reset.submit(); expect(reset.el('message').textContent).toBe('Passwords do not match.');
  reset.el('confirm').value = newPassword;
  await reset.submit(); expect(reset.el('message').textContent).toContain('Password updated');
  expect(reset.el('password').value).toBe(''); expect(reset.el('action').hidden).toBe(true);
  await verify.submit(); expect(verify.el('message').textContent).toContain('invalid or expired');
  await post('login', { email: user.user.email, password: newPassword }).expect(200);
});
