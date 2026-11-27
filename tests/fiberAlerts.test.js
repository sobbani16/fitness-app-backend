// pc-HUM-24 §14 — fiber alert rules: validity, safe test events, cardinality.
const { RULES, validateRule, evaluate } = require('../scripts/fiber-alerts');

describe('fiber alert rules', () => {
  it('all shipped rules are structurally valid', () => {
    for (const rule of RULES) expect(validateRule(rule)).toEqual([]);
    expect(RULES.length).toBeGreaterThanOrEqual(4);
  });
  it('breaching values fire and benign values stay silent for every rule', () => {
    for (const rule of RULES) {
      const breach = rule.comparator === 'gt' ? rule.threshold + Math.max(rule.threshold * 0.5, 1) : rule.threshold - 1;
      const benign = rule.comparator === 'gt' ? Math.max(rule.threshold - 1, 0) : rule.threshold + 1;
      expect(evaluate(rule, breach).fired).toBe(true);
      expect(evaluate(rule, benign).fired).toBe(false);
    }
  });
  it('rejects non-numeric samples without firing', () => {
    expect(evaluate(RULES[0], NaN).fired).toBe(false);
    expect(evaluate(RULES[0], 'user-123').fired).toBe(false);
  });
  it('rejects malformed rule shapes (cardinality/PHI defense)', () => {
    expect(validateRule({ name: 'X-BAD', metric: 'm', threshold: 1, comparator: 'gt', windowMinutes: 5, severity: 'critical' }).length).toBeGreaterThan(0);
    expect(validateRule({ name: 'ok', metric: 'a.b', threshold: 1, comparator: 'eq', windowMinutes: 5, severity: 'critical' }).length).toBeGreaterThan(0);
    expect(validateRule({ name: 'ok', metric: 'a.b', threshold: 1, comparator: 'gt', windowMinutes: 0, severity: 'critical' }).length).toBeGreaterThan(0);
  });
  it('rules carry no user-identifier or free-text label fields', () => {
    for (const rule of RULES) {
      expect(Object.keys(rule).sort()).toEqual(['comparator', 'description', 'metric', 'name', 'severity', 'threshold', 'windowMinutes']);
    }
  });
});
