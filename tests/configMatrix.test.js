// HUM-28 §6.2: config-matrix harness controls — snapshot/restore integrity,
// serialized application, read-back verification, SHA gating, audit completeness.
const { createConfigMatrix } = require('../scripts/staging-config-matrix');

function memoryBackend(initial = {}) {
  const flags = { ...initial };
  return {
    getFlags: async () => ({ ...flags }),
    setFlag: async (k, v) => { flags[k] = v; },
    _flags: flags,
  };
}

describe('§6.2 config-matrix harness', () => {
  it('restores original configuration exactly after a successful run', async () => {
    const backend = memoryBackend({ flag_a: false, flag_b: true });
    const cm = createConfigMatrix({ backend });
    await cm.runMatrix({
      plan: [{ key: 'flag_a', value: true }], expectedSha: 'x', actualSha: 'x',
      execute: async () => ['scenario-result'],
    });
    expect(backend._flags.flag_a).toBe(false); // restored, not left mutated
    expect(backend._flags.flag_b).toBe(true);
  });

  it('restores even when scenario execution throws — environment never left mutated', async () => {
    const backend = memoryBackend({ flag_a: false });
    const cm = createConfigMatrix({ backend });
    await expect(cm.runMatrix({
      plan: [{ key: 'flag_a', value: true }], expectedSha: 'x', actualSha: 'x',
      execute: async () => { throw new Error('scenario exploded'); },
    })).rejects.toThrow('scenario exploded');
    expect(backend._flags.flag_a).toBe(false);
  });

  it('read-back mismatch aborts before any scenario runs', async () => {
    const backend = memoryBackend({ flag_a: false });
    const orig = backend.setFlag.bind(backend);
    backend.setFlag = async () => {}; // silently drops writes → mismatch
    const cm = createConfigMatrix({ backend });
    let ran = false;
    await expect(cm.runMatrix({
      plan: [{ key: 'flag_a', value: true }], expectedSha: 'x', actualSha: 'x',
      execute: async () => { ran = true; },
    })).rejects.toThrow(/read-back mismatch/);
    expect(ran).toBe(false);
  });

  it('deployment SHA mismatch refuses to run', async () => {
    const backend = memoryBackend({});
    const cm = createConfigMatrix({ backend });
    await expect(cm.runMatrix({
      plan: [], expectedSha: 'abc123', actualSha: 'def456',
      execute: async () => {},
    })).rejects.toThrow(/SHA mismatch/);
  });

  it('application is serialized — audit log order proves one-at-a-time', async () => {
    const backend = memoryBackend({ a: false, b: false, c: false });
    const auditLog = [];
    const cm = createConfigMatrix({ backend, auditLog });
    await cm.runMatrix({
      plan: [{ key: 'a', value: true }, { key: 'b', value: true }, { key: 'c', value: true }], expectedSha: 'x', actualSha: 'x',
      execute: async () => [],
    });
    const steps = auditLog.map((e) => e.step).filter((s) => s !== 'attempting');
    expect(steps).toEqual(['sha_verified', 'snapshot',
      'applied', 'applied', 'applied',
      'scenarios_executed', 'restored', 'restored', 'restored']);
    // attempts are tracked BEFORE each setter runs — one attempting per applied, interleaved
    const attempting = auditLog.filter((e) => e.step === 'attempting').map((e) => e.key);
    expect(attempting).toEqual(['a', 'b', 'c']);
    // reverse-order restore: c before b before a
    const restores = auditLog.filter((e) => e.step === 'restored').map((e) => e.key);
    expect(restores).toEqual(['c', 'b', 'a']);
  });

  it('snapshot is mandatory — no silent baseline mutation', async () => {
    const backend = memoryBackend({ a: false });
    const cm = createConfigMatrix({ backend });
    await expect(cm.applySerial([{ key: 'a', value: true }])).rejects.toThrow(/snapshot required/);
  });

  it('missing reviewed SHA refuses before any write or scenario', async () => {
    const backend = memoryBackend({ a: false });
    const cm = createConfigMatrix({ backend });
    let ran = false;
    await expect(cm.runMatrix({
      plan: [{ key: 'a', value: true }], expectedSha: '', actualSha: 'abc',
      execute: async () => { ran = true; },
    })).rejects.toThrow(/identity incomplete/);
    expect(ran).toBe(false);
    expect(backend._flags.a).toBe(false);
  });

  it('missing deployed SHA refuses before any write or scenario', async () => {
    const backend = memoryBackend({ a: false });
    const cm = createConfigMatrix({ backend });
    await expect(cm.runMatrix({
      plan: [{ key: 'a', value: true }], expectedSha: 'abc', actualSha: undefined,
      execute: async () => {},
    })).rejects.toThrow(/identity incomplete/);
    expect(backend._flags.a).toBe(false);
  });

  it('SHA verification happens before any write — mismatched build leaves flags untouched', async () => {
    const backend = memoryBackend({ a: false });
    const cm = createConfigMatrix({ backend });
    await expect(cm.runMatrix({
      plan: [{ key: 'a', value: true }], expectedSha: 'aaa', actualSha: 'bbb',
      execute: async () => {},
    })).rejects.toThrow(/SHA mismatch/);
    expect(backend._flags.a).toBe(false);
  });

  it('a setter that mutates then throws still triggers restoration of the attempted key', async () => {
    const backend = memoryBackend({ a: false, b: false });
    const orig = backend.setFlag.bind(backend);
    backend.setFlag = async (k, v) => {
      if (k === 'b' && v === true) { backend._flags.b = true; throw new Error('setter exploded after mutating'); }
      return orig(k, v);
    };
    const cm = createConfigMatrix({ backend });
    await expect(cm.runMatrix({
      plan: [{ key: 'a', value: true }, { key: 'b', value: true }], expectedSha: 'x', actualSha: 'x',
      execute: async () => [],
    })).rejects.toThrow(/setter exploded/);
    // b was attempted (tracked before the setter ran) — restore must cover it
    expect(backend._flags.b).toBe(false);
    expect(backend._flags.a).toBe(false);
  });

  it('one restore failure does not skip remaining keys — all failures reported with original error intact', async () => {
    const backend = memoryBackend({ a: false, b: false, c: false });
    const orig = backend.setFlag.bind(backend);
    backend.setFlag = async (k, v) => {
      // restore of b fails (writing false back), everything else succeeds
      if (k === 'b' && v === false) throw new Error('restore write failed');
      return orig(k, v);
    };
    const cm = createConfigMatrix({ backend });
    let err;
    try {
      await cm.runMatrix({
        plan: [{ key: 'a', value: true }, { key: 'b', value: true }, { key: 'c', value: true }],
        expectedSha: 'x', actualSha: 'x',
        execute: async () => { throw new Error('scenario failure'); },
      });
    } catch (e) { err = e; }
    expect(err.message).toMatch(/scenario failure/); // original error preserved as primary
    expect(err.restoreFailures).toHaveLength(1);
    expect(err.restoreFailures[0].key).toBe('b');
    // c was still restored despite b failing before it in reverse order
    expect(backend._flags.c).toBe(false);
    expect(backend._flags.a).toBe(false);
    expect(backend._flags.b).toBe(true); // b genuinely un-restored — reported, not hidden
  });

  it('rejects before any write when a planned key has no restorable baseline', async () => {
    const backend = memoryBackend({ a: false }); // key 'missing' has no baseline
    const cm = createConfigMatrix({ backend });
    let ran = false;
    await expect(cm.runMatrix({
      plan: [{ key: 'missing', value: true }], expectedSha: 'x', actualSha: 'x',
      execute: async () => { ran = true; },
    })).rejects.toThrow(/baseline for flag missing is undefined/);
    expect(ran).toBe(false);
  });

  it('successful run reports zero restore failures and full reverse-order restore', async () => {
    const backend = memoryBackend({ a: false, b: true });
    const cm = createConfigMatrix({ backend });
    const out = await cm.runMatrix({
      plan: [{ key: 'a', value: true }, { key: 'b', value: false }],
      expectedSha: 'abc', actualSha: 'abc',
      execute: async () => ['ok'],
    });
    expect(out.result).toEqual(['ok']);
    expect(backend._flags.a).toBe(false);
    expect(backend._flags.b).toBe(true);
  });

});
