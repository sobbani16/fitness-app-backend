// Leo tool registry + confirmation gateway (HUM-90).
// Proves: server-bound identity, schema validation, prohibited never runs,
// confirmation required/bound/expired/single-use, cross-account denial.
const mockRows = new Map();
let mockSeq = 0;
jest.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    leoConfirmation: {
      create: async ({ data }) => { const r = { id: `c${++mockSeq}`, ...data }; mockRows.set(r.id, r); return r; },
      findUnique: async ({ where }) => mockRows.get(where.id) || null,
      updateMany: async ({ where, data }) => {
        const r = mockRows.get(where.id);
        if (!r || r.consumedAt) return { count: 0 };
        r.consumedAt = data.consumedAt; return { count: 1 };
      },
    },
  }),
}));

const { register, execute, CATEGORIES } = require('../src/services/leo/toolRegistry');
const confirmations = require('../src/services/leo/confirmations');

const ctx = { userId: 'u1', sessionId: 's1' };
const spy = jest.fn(async () => ({ done: true }));
beforeEach(() => { mockRows.clear(); mockSeq = 0; spy.mockClear();
  register({ name: 'read.today', version: '1', category: CATEGORIES.READ, inputSchema: { date: { type: 'string' } }, handler: spy });
  register({ name: 'log.meal', version: '1', category: CATEGORIES.SENSITIVE, inputSchema: { foodName: { type: 'string', required: true } }, handler: spy });
  register({ name: 'admin.wipe', version: '1', category: CATEGORIES.PROHIBITED, handler: spy });
});

it('read-only tools execute with server context only', async () => {
  const r = await execute('read.today', { date: '2026-11-25' }, ctx);
  expect(r.status).toBe('ok');
  expect(spy).toHaveBeenCalledWith({ date: '2026-11-25' }, { userId: 'u1', sessionId: 's1' });
});

it('model-supplied identity args are rejected — never override server context', async () => {
  await expect(execute('read.today', { userId: 'attacker' }, ctx)).rejects.toMatchObject({ status: 400 });
  await expect(execute('read.today', { sessionId: 'x' }, ctx)).rejects.toMatchObject({ status: 400 });
  expect(spy).not.toHaveBeenCalled();
});

it('prohibited tools never execute', async () => {
  await expect(execute('admin.wipe', {}, ctx)).rejects.toMatchObject({ status: 403 });
  expect(spy).not.toHaveBeenCalled();
});

it('schema validation rejects bad args before any side effect', async () => {
  await expect(execute('log.meal', {}, ctx)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('foodName') });
  expect(spy).not.toHaveBeenCalled();
});

it('sensitive tools require confirmation; a valid one is consumed once', async () => {
  const args = { foodName: 'oatmeal' };
  await expect(execute('log.meal', args, ctx)).rejects.toMatchObject({ status: 428, code: 'confirmation_required' });

  const c = await confirmations.issue('u1', 's1', 'log.meal', args, 120);
  await expect(execute('log.meal', args, { ...ctx, confirmationId: c.id })).resolves.toMatchObject({ status: 'ok' });

  // Replay is rejected — the same confirmation cannot fire twice.
  spy.mockClear();
  await expect(execute('log.meal', args, { ...ctx, confirmationId: c.id })).rejects.toMatchObject({ status: 409 });
  expect(spy).not.toHaveBeenCalled();
});

it('confirmation binding: different args or tool or session are rejected', async () => {
  const c = await confirmations.issue('u1', 's1', 'log.meal', { foodName: 'a' }, 120);
  // Args changed after confirmation → mismatch.
  await expect(execute('log.meal', { foodName: 'b' }, { ...ctx, confirmationId: c.id })).rejects.toMatchObject({ status: 409 });
  // Wrong session → not found.
  await expect(execute('log.meal', { foodName: 'a' }, { userId: 'u1', sessionId: 's2', confirmationId: c.id })).rejects.toMatchObject({ status: 404 });
});

it('cross-account denial: another user cannot consume your confirmation', async () => {
  const c = await confirmations.issue('u1', 's1', 'log.meal', { foodName: 'x' }, 120);
  await expect(execute('log.meal', { foodName: 'x' }, { userId: 'u2', sessionId: 's1', confirmationId: c.id })).rejects.toMatchObject({ status: 404 });
});

it('expired confirmations are rejected', async () => {
  const c = await confirmations.issue('u1', 's1', 'log.meal', { foodName: 'x' }, 5);
  mockRows.get(c.id).expiresAt = new Date(Date.now() - 1000); // simulate expiry
  await expect(execute('log.meal', { foodName: 'x' }, { ...ctx, confirmationId: c.id })).rejects.toMatchObject({ status: 410 });
});
