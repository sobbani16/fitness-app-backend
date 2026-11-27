// HUM-90: post-mutation hooks — session.close/purge invalidates pending
// confirmations; an approval in a dead session context must never execute.
const { invalidateSession, consume, issue, argsHash } = require('../src/services/leo/confirmations');
const registry = require('../src/services/leo/toolRegistry');

const rows = [];
const db = {
  leoConfirmation: {
    create: async ({ data }) => { rows.push({ id: 'c' + rows.length, consumedAt: null, ...data }); return rows[rows.length - 1]; },
    findUnique: async ({ where }) => rows.find((r) => r.id === where.id) || null,
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const r of rows) {
        const sessionMatch = !where.sessionId || r.sessionId === where.sessionId;
        const idMatch = !where.id || r.id === where.id;
        const unconsumed = where.consumedAt === null ? !r.consumedAt : true;
        if (sessionMatch && idMatch && unconsumed) { Object.assign(r, data); count++; }
      }
      return { count };
    },
  },
};

beforeEach(() => { rows.length = 0; });

describe('session-lifecycle invalidation of pending confirmations', () => {
  it('invalidateSession expires all unconsumed rows for the session', async () => {
    rows.push({ id: 'c1', sessionId: 's1', userId: 'u1', consumedAt: null, expiresAt: new Date(Date.now() + 60000) });
    rows.push({ id: 'c2', sessionId: 's1', userId: 'u1', consumedAt: new Date(), expiresAt: new Date(Date.now() + 60000) });
    rows.push({ id: 'c3', sessionId: 's2', userId: 'u1', consumedAt: null, expiresAt: new Date(Date.now() + 60000) });
    const r = await invalidateSession('s1', db);
    expect(r.invalidated).toBe(1);
    expect(rows.find((x) => x.id === 'c1').expiresAt.getTime()).toBe(0);
    expect(rows.find((x) => x.id === 'c2').consumedAt).not.toBeNull(); // already-consumed untouched
    expect(rows.find((x) => x.id === 'c3').expiresAt.getTime()).toBeGreaterThan(0); // other session untouched
  });

  it('a confirmation invalidated by session close cannot be consumed — 410', async () => {
    rows.push({
      id: 'c1', sessionId: 's1', userId: 'u1', toolName: 'session.purge',
      argsHash: argsHash('session.purge', {}), consumedAt: null,
      expiresAt: new Date(Date.now() + 60000),
    });
    await invalidateSession('s1', db);
    await expect(consume('u1', 's1', 'c1', 'session.purge', {}, db))
      .rejects.toMatchObject({ status: 410, message: 'confirmation_expired' });
  });

  it('mutation hooks fire only for sensitive/destructive tools, never breaking the call', async () => {
    const calls = [];
    registry.registerMutationHook(async (info) => { calls.push(info.tool); });
    registry.registerMutationHook(async () => { throw new Error('hook exploded'); }); // must not propagate
    registry.register({
      name: 'test.sensitive', version: '1', category: registry.CATEGORIES.SENSITIVE,
      inputSchema: {}, timeoutMs: 1000, handler: async () => ({ done: true }),
    });
    registry.register({
      name: 'test.read', version: '1', category: registry.CATEGORIES.READ,
      inputSchema: {}, timeoutMs: 1000, handler: async () => ({ done: true }),
    });
    // sensitive requires confirmation — simulate consumed confirmation by direct ctx
    const confirmations = require('../src/services/leo/confirmations');
    const origConsume = confirmations.consume;
    confirmations.consume = async () => ({ consumed: true });
    const r = await registry.execute('test.sensitive', {}, { userId: 'u', sessionId: 's', confirmationId: 'x' });
    expect(r.status).toBe('ok'); // hook explosion did not break the tool
    expect(calls).toContain('test.sensitive');
    await registry.execute('test.read', {}, { userId: 'u', sessionId: 's' });
    expect(calls).not.toContain('test.read'); // reads never fire mutation hooks
    confirmations.consume = origConsume;
  });
});
