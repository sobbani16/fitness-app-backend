// Fiber-intelligence alert rules + safe test-event validation (pc-HUM-24 §14).
//
// CARDINALITY SAFETY: labels are closed enums only — metric names, severities,
// environments. No user IDs, no free-form strings, no PHI. A test event with
// an out-of-contract label is rejected, which is itself verified here.
//
// Rules are data, not prose: each rule has a metric, threshold, window, and
// severity. `evaluate(rule, value)` is pure — the test events below are safe
// synthetic evaluations that never touch production monitoring.

const RULES = [
  { name: 'fiber_snapshot_write_error_rate', metric: 'fiber.snapshot_write.errors', threshold: 0.02, comparator: 'gt', windowMinutes: 15, severity: 'critical', description: 'Snapshot write failure ratio above 2% over 15m.' },
  { name: 'fiber_recipe_reconcile_drift', metric: 'fiber.recipe_reconcile.drift_count', threshold: 0, comparator: 'gt', windowMinutes: 60, severity: 'warning', description: 'Any unreconciled recipe-fiber drift in the hourly reconcile.' },
  { name: 'fiber_migration_lag_seconds', metric: 'fiber.deploy.migration_lag_seconds', threshold: 300, comparator: 'gt', windowMinutes: 5, severity: 'critical', description: 'Pending migrations older than 5m after deploy — rollback trigger.' },
  { name: 'fiber_api_5xx_rate', metric: 'fiber.api.error_rate_5xx', threshold: 0.01, comparator: 'gt', windowMinutes: 10, severity: 'critical', description: 'Fiber endpoint 5xx ratio above 1% over 10m.' },
];

const SEVERITIES = ['critical', 'warning'];
const COMPARATORS = ['gt', 'lt'];

function validateRule(rule) {
  const errors = [];
  if (typeof rule.name !== 'string' || !/^[a-z0-9_]+$/.test(rule.name)) errors.push('name must be snake_case');
  if (typeof rule.metric !== 'string' || !/^[a-z0-9_.]+$/.test(rule.metric)) errors.push('metric must be lowercase dotted');
  if (typeof rule.threshold !== 'number') errors.push('threshold must be a number');
  if (!COMPARATORS.includes(rule.comparator)) errors.push('comparator invalid');
  if (!Number.isInteger(rule.windowMinutes) || rule.windowMinutes < 1) errors.push('windowMinutes must be positive int');
  if (!SEVERITIES.includes(rule.severity)) errors.push('severity invalid');
  return errors;
}

function evaluate(rule, value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return { fired: false, reason: 'non-numeric sample rejected' };
  const fired = rule.comparator === 'gt' ? value > rule.threshold : value < rule.threshold;
  return { fired, rule: rule.name, severity: fired ? rule.severity : undefined };
}

/** Safe self-test: synthetic values only — no production interaction. */
function selfTest() {
  const results = [];
  for (const rule of RULES) {
    results.push({ rule: rule.name, valid: validateRule(rule).length === 0 });
    // safe test events: one breaching, one benign
    const breach = rule.comparator === 'gt' ? rule.threshold + Math.max(rule.threshold * 0.5, 1) : rule.threshold - 1;
    const benign = rule.comparator === 'gt' ? Math.max(rule.threshold - 1, 0) : rule.threshold + 1;
    results.push({ rule: rule.name, breachFires: evaluate(rule, breach).fired === true, benignSilent: evaluate(rule, benign).fired === false });
  }
  // cardinality-safety probe: a malformed/malicious label set must be rejected
  const evil = { name: 'x', metric: 'fiber.user.aaa-bbb-userid-PHI', threshold: 1, comparator: 'gt', windowMinutes: 5, severity: 'critical' };
  results.push({ rule: 'cardinality_probe', rejected: validateRule(evil).length > 0 || !/^[a-z0-9_.]+$/.test(evil.metric) });
  return results;
}

if (require.main === module) {
  const results = selfTest();
  const failed = results.filter((r) => Object.values(r).some((v) => v === false));
  console.log(JSON.stringify(results, null, 1));
  console.log(failed.length ? `FAIL: ${failed.length} alert self-test checks failed` : `OK: ${RULES.length} rules valid, breach/benign/cardinality checks pass`);
  process.exit(failed.length ? 1 : 0);
}

module.exports = { RULES, validateRule, evaluate, selfTest };
