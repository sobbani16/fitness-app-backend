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
      plan: [{ key: 'flag_a', value: true }],
      execute: async () => ['scenario-result'],
    });
    expect(backend._flags.flag_a).toBe(false); // restored, not left mutated
    expect(backend._flags.flag_b).toBe(true);
  });

  it('restores even when scenario execution throws — environment never left mutated', async () => {
    const backend = memoryBackend({ flag_a: false });
    const cm = createConfigMatrix({ backend });
    await expect(cm.runMatrix({
      plan: [{ key: 'flag_a', value: true }],
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
      plan: [{ key: 'flag_a', value: true }],
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
      plan: [{ key: 'a', value: true }, { key: 'b', value: true }, { key: 'c', value: true }],
      execute: async () => [],
    });
    const steps = auditLog.map((e) => e.step);
    expect(steps).toEqual(['sha_verified', 'snapshot',
      'applied', 'applied', 'applied',
      'scenarios_executed', 'restored', 'restored', 'restored']);
    // reverse-order restore: c before b before a
    const restores = auditLog.filter((e) => e.step === 'restored').map((e) => e.key);
    expect(restores).toEqual(['c', 'b', 'a']);
  });

  it('snapshot is mandatory — no silent baseline mutation', async () => {
    const backend = memoryBackend({ a: false });
    const cm = createConfigMatrix({ backend });
    await expect(cm.applySerial([{ key: 'a', value: true }])).rejects.toThrow(/snapshot required/);
  });
});
