// HUM-90 key-acceptance integration proofs against the REAL test database —
// no prisma fakes. Proves: real persistence per tool, dup-request single
// record at the DB-unique-constraint level, cross-account denial, and
// expired-confirmation replay denial. Harness auto-swaps DATABASE_URL →
// TEST_DATABASE_URL (see tests/setup.js).
const request = require('supertest');
const { getPrisma } = require('../src/lib/prisma');

const prisma = getPrisma();
const uniq = () => Math.random().toString(36).slice(2, 10);
const users = [];
let app;

async function makeUser() {
  const u = await prisma.user.create({
    data: { email: `leo-it-${uniq()}@test.dev`, passwordHash: 'x', emailVerifiedAt: new Date() },
  });
  users.push(u.id);
  return u;
}
const auth = id => ({ 'x-user-id': id });

beforeAll(async () => {
  process.env.AUTH_TEST_BYPASS = 'true';
  app = require('../src/app');
});

afterAll(async () => {
  // cleanup in FK-safe order
  await prisma.leoMessage.deleteMany({ where: { session: { userId: { in: users } } } }).catch(() => {});
  await prisma.leoConfirmation.deleteMany({ where: { userId: { in: users } } }).catch(() => {});
  await prisma.leoSession.deleteMany({ where: { userId: { in: users } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: users } } }).catch(() => {});
});

describe('leo real-persistence integration (real test DB)', () => {
  it('session creation persists a real row; clientRef replay yields ONE record', async () => {
    const u = await makeUser();
    const ref = `sess-${uniq()}`;
    const r1 = await request(app).post('/leo/sessions').set(auth(u.id)).send({ clientRef: ref });
    expect([200, 201]).toContain(r1.status);
    const r2 = await request(app).post('/leo/sessions').set(auth(u.id)).send({ clientRef: ref });
    expect(r2.body.id || r2.body.session?.id).toBe(r1.body.id || r1.body.session?.id);
    const rows = await prisma.leoSession.count({ where: { userId: u.id, clientRef: ref } });
    expect(rows).toBe(1); // dup retry → single record, enforced by DB unique index
  });

  it('sensitive tool issues a real confirmation row; confirm executes once and consumes it', async () => {
    const u = await makeUser();
    const s = await request(app).post('/leo/sessions').set(auth(u.id)).send({});
    const sid = s.body.id || s.body.session?.id;
    const call = { toolCall: { name: 'session.close', args: {} } };
    const pending = await request(app).post(`/leo/sessions/${sid}/messages`).set(auth(u.id)).send(call);
    expect(pending.status).toBe(202);
    const cid = pending.body.confirmation.id;
    const row = await prisma.leoConfirmation.findUnique({ where: { id: cid } });
    expect(row).toBeTruthy();
    expect(row.userId).toBe(u.id);
    expect(row.consumedAt).toBeNull();
    const confirm = await request(app).post(`/leo/confirmations/${cid}/confirm`).set(auth(u.id)).send({ args: {} });
    expect(confirm.status).toBe(200);
    const consumed = await prisma.leoConfirmation.findUnique({ where: { id: cid } });
    expect(consumed.consumedAt).not.toBeNull(); // REAL persistence of the consume
    // replay of the same confirmation must be rejected — no double execution
    const replay = await request(app).post(`/leo/confirmations/${cid}/confirm`).set(auth(u.id)).send({ args: {} });
    expect([409, 410, 400]).toContain(replay.status);
  });

  it('cross-account denial: user B cannot even see user A confirmation — 404, nothing consumed', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const s = await request(app).post('/leo/sessions').set(auth(a.id)).send({});
    const sid = s.body.id || s.body.session?.id;
    const pending = await request(app).post(`/leo/sessions/${sid}/messages`).set(auth(a.id))
      .send({ toolCall: { name: 'session.close', args: {} } });
    const cid = pending.body.confirmation.id;
    const attack = await request(app).post(`/leo/confirmations/${cid}/confirm`).set(auth(b.id)).send({ args: {} });
    expect(attack.status).toBe(404);
    const row = await prisma.leoConfirmation.findUnique({ where: { id: cid } });
    expect(row.consumedAt).toBeNull(); // untouched by the cross-account attempt
  });

  it('expired confirmation replay is denied — rows expiring in the past cannot execute', async () => {
    const u = await makeUser();
    const s = await request(app).post('/leo/sessions').set(auth(u.id)).send({});
    const sid = s.body.id || s.body.session?.id;
    const pending = await request(app).post(`/leo/sessions/${sid}/messages`).set(auth(u.id))
      .send({ toolCall: { name: 'session.close', args: {} } });
    const cid = pending.body.confirmation.id;
    // age the row past expiry directly — simulates a slow user confirming late
    await prisma.leoConfirmation.update({ where: { id: cid }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const late = await request(app).post(`/leo/confirmations/${cid}/confirm`).set(auth(u.id)).send({ args: {} });
    expect([410, 409, 400]).toContain(late.status);
    const row = await prisma.leoConfirmation.findUnique({ where: { id: cid } });
    expect(row.consumedAt).toBeNull(); // expired replay never executes
  });

  it('message clientRef dedups a retried send — one row at the DB level', async () => {
    const u = await makeUser();
    const s = await request(app).post('/leo/sessions').set(auth(u.id)).send({});
    const sid = s.body.id || s.body.session?.id;
    const ref = `msg-${uniq()}`;
    const m1 = await request(app).post(`/leo/sessions/${sid}/messages`).set(auth(u.id)).send({ content: 'hello', clientRef: ref });
    const m2 = await request(app).post(`/leo/sessions/${sid}/messages`).set(auth(u.id)).send({ content: 'hello', clientRef: ref });
    expect(m1.body.message.id).toBe(m2.body.message.id);
    const rows = await prisma.leoMessage.count({ where: { sessionId: sid, clientRef: ref } });
    expect(rows).toBe(1);
  });
});
