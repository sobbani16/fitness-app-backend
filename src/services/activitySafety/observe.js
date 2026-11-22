// Phase 17 §8 — privacy-preserving safety observation.
// Events carry CODES AND COUNTS ONLY — never symptom text, injury detail,
// restriction categories, or free text. Emitted as a single structured log
// line per event; a monitoring backend can aggregate counters + alert.
const HIGH_SEVERITY = new Set([
  'safety.notification.untyped',   // producer used an unregistered advice type → may bypass suppression
  'safety.gate.error',             // gate threw — fail-closed path taken
  'safety.env.outage',             // provider failure while user outdoors
  'safety.rule.inert_unexplained', // a supported rule produced no reachable path at runtime
]);

const buffer = [];
const MAX = 500;

function observe(event, meta = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(meta)) {
    if (['count', 'decision', 'activityId', 'ruleCode', 'type', 'via', 'reason', 'coverage', 'disposition', 'userId'].includes(k)) safe[k] = v;
  }
  const e = { t: new Date().toISOString(), event, severity: HIGH_SEVERITY.has(event) ? 'high' : 'info', ...safe };
  buffer.push(e);
  if (buffer.length > MAX) buffer.shift();
  // eslint-disable-next-line no-console
  if (HIGH_SEVERITY.has(event)) console.warn(`[safety-observe] ${JSON.stringify(e)}`);
  return e;
}

// alert thresholds for a monitoring backend (documented contract)
const ALERTS = {
  'safety.notification.untyped': 'page — activity advice may bypass safety suppression',
  'safety.gate.error': 'page within 1h — decisions degrading to fail-closed',
  'safety.env.outage': 'alert at >20% requests/5min — outdoor recommendations rely on honest unknown state',
  'safety.suppression.spike': 'alert at >3× baseline — may indicate bad data import rather than true risk',
  'safety.invalidation.miss': 'page — write path bypassed invalidateSafetyAdvice',
};

module.exports = { observe, ALERTS, HIGH_SEVERITY, _buffer: buffer };
