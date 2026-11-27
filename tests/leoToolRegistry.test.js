// Leo tool registry — ordering, write verification, dependent suppression.
const { ToolRegistry } = require('../src/services/leo/toolRegistry');

describe('ToolRegistry', () => {
  it('executes mutations before queries and recommendations regardless of input order', async () => {
    const calls = [];
    const r = new ToolRegistry()
      .register('write', { type: 'mutation', handler: async () => { calls.push('write'); return { status: 'saved', createdIds: ['x1'] }; } })
      .register('read', { type: 'query', handler: async () => { calls.push('read'); return { status: 'answered' }; } })
      .register('recommend', { type: 'recommendation', handler: async () => { calls.push('recommend'); return { status: 'answered' }; } });
    const out = await r.executeOrdered([
      { intent: 'recommend' }, { intent: 'read' }, { intent: 'write' },
    ], { verifyCreated: async () => true });
    expect(calls).toEqual(['write', 'read', 'recommend']);
  });

  it('blocked write leaves dependent tools uncalled', async () => {
    const calls = [];
    const r = new ToolRegistry()
      .register('write', { type: 'mutation', handler: async () => { calls.push('write'); return { status: 'skipped', reason: 'no catalog match' }; } })
      .register('read', { type: 'query', handler: async () => { calls.push('read'); return { status: 'answered' }; } })
      .register('recommend', { type: 'recommendation', handler: async () => { calls.push('recommend'); return { status: 'answered' }; } });
    const out = await r.executeOrdered([{ intent: 'write' }, { intent: 'read' }, { intent: 'recommend' }], { verifyCreated: async () => true });
    expect(calls).toEqual(['write']); // dependents never invoked
    expect(out.results.find(x => x.intent === 'read').status).toBe('suppressed');
    expect(out.results.find(x => x.intent === 'recommend').status).toBe('suppressed');
    expect(out.writes.failed).toBe(1);
  });

  it('unverified write (verification re-read fails) suppresses dependents', async () => {
    const calls = [];
    const r = new ToolRegistry()
      .register('write', { type: 'mutation', handler: async () => { calls.push('write'); return { status: 'saved', createdIds: ['ghost'] }; } })
      .register('read', { type: 'query', handler: async () => { calls.push('read'); return { status: 'answered' }; } });
    const out = await r.executeOrdered([{ intent: 'write' }, { intent: 'read' }], { verifyCreated: async () => false });
    expect(calls).toEqual(['write']);
    expect(out.results.find(x => x.intent === 'read').status).toBe('suppressed');
    expect(out.writes.verified).toBe(0);
  });

  it('verified write lets dependents run', async () => {
    const calls = [];
    const r = new ToolRegistry()
      .register('write', { type: 'mutation', handler: async () => { calls.push('write'); return { status: 'saved', createdIds: ['ok1'] }; } })
      .register('read', { type: 'query', handler: async () => { calls.push('read'); return { status: 'answered' }; } });
    await r.executeOrdered([{ intent: 'write' }, { intent: 'read' }], { verifyCreated: async ids => ids.includes('ok1') });
    expect(calls).toEqual(['write', 'read']);
  });

  it('rejects invalid tool specs', () => {
    const r = new ToolRegistry();
    expect(() => r.register('bad', { type: 'nope', handler: async () => ({}) })).toThrow();
    expect(() => r.register('bad2', { type: 'query' })).toThrow();
  });
});
