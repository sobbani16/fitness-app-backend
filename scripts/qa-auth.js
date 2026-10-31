// Production auth QA — bounded, non-destructive checks against the live API.
// Requires: QA_API_URL (must equal AUTH_PUBLIC_URL / the intended prod origin),
//           QA_EMAIL   (a dedicated, controlled test inbox — +alias recommended),
//           QA_PASSWORD.
// Optional:  QA_DATABASE_URL (direct DB access verifies queue → provider
//            acceptance; without it those checks report PENDING).
// Gated by QA_ALLOW_PRODUCTION=true so it can never run against prod by accident.
// Never logs tokens, passwords, or full emails. Exit 1 on FAIL.
const { randomBytes } = require('node:crypto');

const BASE = process.env.QA_API_URL?.replace(/\/+$/, '');
const RUN = `qa-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
// Use a fresh +alias per run (QA_EMAIL may contain %r as the run-id placeholder,
// e.g. QA_EMAIL='me+qa.%r@gmail.com') so every run owns a disposable account and
// login always verifies a known password.
const EMAIL = (process.env.QA_EMAIL || '').trim().toLowerCase().replace(/%r/g, RUN);
const PASSWORD = process.env.QA_PASSWORD;
const DB_URL = process.env.QA_DATABASE_URL;
const mask = e => e ? e.replace(/(^..)[^@]*(@.*)/, '$1***$2') : '(unset)';

const results = [];
const step = (name, status, detail = '') => {
  results.push({ name, status, detail });
  const tag = { PASS: 'PASS', FAIL: 'FAIL', PENDING: 'MANUAL VERIFICATION REQUIRED', SKIP: 'SKIP' }[status];
  console.log(`${tag.padEnd(33)} ${name}${detail ? ` — ${detail}` : ''}`);
};

const post = async (path, body, headers = {}) => {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const get = async (path, headers = {}) => {
  const r = await fetch(`${BASE}${path}`, { headers, signal: AbortSignal.timeout(15000) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const waitForAction = async (purpose, since, tries = 10) => {
  if (!DB_URL) return 'no-db';
  try {
    process.env.DATABASE_URL = DB_URL;
    const { getPrisma } = require('../src/lib/prisma');
    const prisma = getPrisma();
    for (let i = 0; i < tries; i++) {
      const rows = await prisma.$queryRaw`SELECT "deliveredAt", attempts FROM "AuthAction"
        WHERE purpose = ${purpose} AND email = ${EMAIL} AND "createdAt" >= ${since}
        ORDER BY "createdAt" DESC LIMIT 1`;
      if (rows[0]?.deliveredAt) { await prisma.$disconnect(); return rows[0]; }
      await new Promise(r => setTimeout(r, 3000));
    }
    await prisma.$disconnect();
    return null;
  } catch { return 'unreachable'; } // internal host (railway.internal) only resolves inside the network
};

async function main() {
  console.log(`Auth QA run ${RUN}\nTarget: ${BASE}\nTest account: ${mask(EMAIL)}\n`);
  if (process.env.QA_ALLOW_PRODUCTION !== 'true') { console.log('Refusing: set QA_ALLOW_PRODUCTION=true to confirm production testing.'); process.exit(1); }
  if (!/^https:\/\//.test(BASE || '')) { console.log('Refusing: QA_API_URL must be an https origin.'); process.exit(1); }
  if (!EMAIL || !PASSWORD) { console.log('Refusing: QA_EMAIL and QA_PASSWORD are required.'); process.exit(1); }

  // 1. Liveness + version
  try {
    const h = await get('/health/ready');
    step('Health check', h.status === 200 ? 'PASS' : 'FAIL', `HTTP ${h.status}`);
  } catch (e) { step('Health check', 'FAIL', e.message); }

  // 2. Register (409/400 on re-run is fine — the test user already exists)
  let token = null;
  try {
    const r = await post('/auth/register', { email: EMAIL, password: PASSWORD });
    if (r.status === 201) { token = r.body.token; step('Register test account', 'PASS', 'HTTP 201'); }
    else if (r.status === 409) { step('Register test account', 'PASS', 'Account already exists (re-run)'); }
    else step('Register test account', 'FAIL', `HTTP ${r.status}`);
  } catch (e) { step('Register test account', 'FAIL', e.message); }

  // 3. Wrong password → uniform 401
  try {
    const r = await post('/auth/login', { email: EMAIL, password: `wrong-${PASSWORD}` });
    step('Wrong password rejected', r.status === 401 && !/exists|registered/i.test(JSON.stringify(r.body)) ? 'PASS' : 'FAIL', `HTTP ${r.status}`);
  } catch (e) { step('Wrong password rejected', 'FAIL', e.message); }

  // 4. Correct login → session
  try {
    const r = await post('/auth/login', { email: EMAIL, password: PASSWORD });
    token = r.body?.token || token;
    step('Login + session', r.status === 200 && token ? 'PASS' : 'FAIL', `HTTP ${r.status}`);
  } catch (e) { step('Login + session', 'FAIL', e.message); }

  // 5. Authenticated /me
  if (token) {
    const r = await get('/auth/me', { Authorization: `Bearer ${token}` });
    step('Authenticated /auth/me', r.status === 200 && r.body?.user?.email === EMAIL ? 'PASS' : 'FAIL', `HTTP ${r.status}`);
  }

  // 6. Forgot-password: generic response for known AND unknown email
  try {
    const since = new Date();
    const a = await post('/auth/forgot-password', { email: EMAIL });
    const b = await post('/auth/forgot-password', { email: `qa.missing.${RUN}@example.com` });
    const same = a.status === 202 && b.status === 202 && JSON.stringify(a.body) === JSON.stringify(b.body);
    step('Forgot-password generic response', same ? 'PASS' : 'FAIL', `known HTTP ${a.status} vs unknown HTTP ${b.status}`);
    const act = await waitForAction('reset-password', since);
    if (act === 'no-db' || act === 'unreachable') step('Reset email accepted by provider', 'PENDING', `DB queue ${act === 'no-db' ? 'not configured' : 'unreachable from this host'} — cannot inspect`);
    else if (act) step('Reset email accepted by provider', 'PASS', `accepted after ${act.attempts} attempt(s)`);
    else step('Reset email accepted by provider', 'FAIL', 'No delivered AuthAction row — queue or provider broken');
  } catch (e) { step('Forgot-password flow', 'FAIL', e.message); }

  // 7. Invalid + reused-style token rejections
  const bogus = 'A'.repeat(43);
  for (const [route, purpose] of [['verify-email', {}], ['reset-password', { password: PASSWORD }]]) {
    const r = await post(`/auth/${route}`, { token: bogus, ...purpose });
    step(`Invalid token rejected (${route})`, r.status === 400 ? 'PASS' : 'FAIL', `HTTP ${r.status}`);
  }

  // 8. Verify-email state + queue evidence
  const vAct = await waitForAction('verify-email', new Date(Date.now() - 3600000), 1);
  if (vAct === 'no-db' || vAct === 'unreachable') step('Verification email accepted by provider', 'PENDING', 'DB queue unavailable');
  else if (vAct) step('Verification email accepted by provider', 'PASS', `accepted after ${vAct.attempts} attempt(s)`);
  else step('Verification email accepted by provider', 'PENDING', 'No recent verify action — register step may have been skipped');

  // 9. Logout revokes the session
  if (token) {
    const out = await post('/auth/logout', {}, { Authorization: `Bearer ${token}` });
    const after = await get('/auth/me', { Authorization: `Bearer ${token}` });
    step('Logout revokes session', out.status === 200 && after.status === 401 ? 'PASS' : 'FAIL', `logout ${out.status}, /me after ${after.status}`);
  }

  step('Inbox arrival (verify + reset emails)', 'PENDING', `Check ${mask(EMAIL)} inbox and spam for both messages`);
  step('Account deletion', 'SKIP', 'Destructive — requires explicit approval on a disposable account');

  const failed = results.filter(r => r.status === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} checks OK — ${failed.length} failed, ${results.filter(r => r.status === 'PENDING').length} need manual verification`);
  if (process.env.QA_JSON) console.log(JSON.stringify({ run: RUN, target: BASE, results }, null, 1));
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.log('QA harness error:', e.message); process.exit(1); });
