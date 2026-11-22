// Medical flag governance — the 5 clinical gates must exist, default OFF,
// fail closed, and never resolve true without explicit configuration.
const { FEATURES } = require('../src/config/featureRegistry');
const { isEnabled } = require('../src/services/featureFlags/service');

const MEDICAL = ['allergen_warnings', 'calorie_floor_policy', 'condition_rules', 'supplement_safety', 'medication_interaction'];

describe('medical flag registry contract', () => {
  test.each(MEDICAL)('%s registered default-OFF fail-closed', (k) => {
    const f = FEATURES[k];
    expect(f).toBeDefined();
    expect(f.default).toBe(false);
    expect(f.failOpen).toBe(false);
    expect(f.group).toBe('medical');
  });

  test.each(MEDICAL)('%s resolves false for a real user with no config', async (k) => {
    expect(await isEnabled(k, 'governance-probe')).toBe(false);
  });

  test('not in AI kill group (deterministic server features)', () => {
    for (const k of MEDICAL) expect(FEATURES[k].group).not.toBe('ai');
  });
});
