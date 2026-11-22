// 120-scenario fixture runner — executes every 'executable' fixture in
// data/scenarioFixtures.json against the REAL engines (no mocked business
// logic). blocked_not_implemented fixtures are reported, not asserted — an
// absent capability is a finding, not a pass. Regenerate fixtures with
// `node scripts/build-scenario-fixtures.js` after engine or spec changes.
const { dailyScore } = require('../src/services/scoringV2');
const { resolve } = require('../src/services/decisionEngine');
const caps = require('../src/services/scenarioCapabilities');
const { fixtures } = require('../data/scenarioFixtures.json');
const manifest = require('../data/scenarioAppendixA.json');

const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const check = (actual, ops) => {
  if ('eq' in ops) return actual === ops.eq;
  if ('lt' in ops) return actual != null && actual < ops.lt;
  if ('lte' in ops) return actual != null && actual <= ops.lte;
  if ('gt' in ops) return actual != null && actual > ops.gt;
  if ('gte' in ops) return actual != null && actual >= ops.gte;
  if ('contains' in ops) return typeof actual === 'string' && actual.toLowerCase().includes(ops.contains.toLowerCase());
  if ('null' in ops) return actual === null;
  if ('notNull' in ops) return actual != null;
  if ('oneOf' in ops) return ops.oneOf.includes(actual);
  return false;
};

test('fixture manifest covers all 120 Appendix A scenarios verbatim', () => {
  expect(fixtures).toHaveLength(120);
  const ids = new Set(manifest.scenarios.map((s) => s.id));
  for (const f of fixtures) {
    expect(ids.has(f.id)).toBe(true);
    const orig = manifest.scenarios.find((s) => s.id === f.id);
    expect(f.expectedVerbatim).toBe(orig.expected); // D2: verbatim is authoritative
    expect(f.scenario).toBe(orig.scenario);
  }
});

describe.each(fixtures)('%s', (f) => {
  if (f.status === 'blocked_not_implemented') {
    test.todo(`blocked — ${f.requiredToValidate[0]}`);
    return;
  }
  test(`executes against ${f.run.engine}`, () => {
    const input = f.run.engine === 'dailyScore'
      ? { nutrition: { proteinG: null, carbsG: null, fatG: null, fiberG: null, calories: null, targets: null }, foodQuality: {}, activity: {}, sleep: {}, hydration: {}, ...f.run.input, ...f.run.extra }
      : f.run.input;
    const result = f.run.engine === 'dailyScore' ? dailyScore(input) : f.run.engine === 'capabilities' ? caps[f.run.fn](f.run.input) : resolve(input);
    for (const [path, ops] of Object.entries(f.expect)) {
      const actual = get(result, path);
      expect({ path, actual, id: f.id }).toEqual({ path, actual: expect.objectContaining({}), id: f.id }) && check(actual, ops);
      if (!check(actual, ops)) throw new Error(`${f.id} ${path}: expected ${JSON.stringify(ops)}, got ${JSON.stringify(actual)}`);
    }
  });
});
