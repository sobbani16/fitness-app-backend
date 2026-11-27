// Structured security event boundary (LR-11 §15.4) — the approved path for
// security events to reach logs. Follows the requestContext/leoTelemetry
// conventions: flat fixed-key JSON through an injectable logger, validated
// identifiers, fail-closed unknowns.
//
// REDACTION CONTRACT:
//   - Only the §15.4 allowlist exists: type, severity, actorRef, resourceType,
//     requestId, timestamp, result, environment, plus the closed-enum
//     outcomeReason. There is NO free-form field: messages, errors, payloads,
//     headers, bodies and nested objects cannot be represented.
//   - type/severity/result/outcomeReason are closed enums — caller strings
//     outside the enum reject the whole event (type/severity/result) or are
//     omitted field-wise (outcomeReason).
//   - actorRef/requestId must match the identifier shape; caller-controlled
//     strings that do not are omitted, not logged.
//   - timestamp and environment are generated server-side from trusted
//     application context — never accepted from the caller.
//   - The emitter never throws: invalid input returns null without touching
//     the sink, so wiring can never affect request behavior.

const { environmentName } = require('../lib/env');

const IDENTIFIER = /^[A-Za-z0-9._-]{8,80}$/;
const TYPES = new Set(['auth.login']);
const SEVERITIES = new Set(['info', 'warn', 'critical']);
const RESULTS = new Set(['success', 'failure']);
const REASONS = new Set(['invalid_credentials', 'rate_limited', 'account_locked', 'session_expired']);
const RESOURCE_TYPES = new Set(['session', 'account']);

function emitSecurityEvent(input, logger = console) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (!TYPES.has(input.type) || !SEVERITIES.has(input.severity) || !RESULTS.has(input.result)) return null;
  const event = {
    event: 'security',
    type: input.type,
    severity: input.severity,
    result: input.result,
    timestamp: new Date().toISOString(),
    environment: environmentName(),
  };
  if (typeof input.actorRef === 'string' && IDENTIFIER.test(input.actorRef)) event.actorRef = input.actorRef;
  if (RESOURCE_TYPES.has(input.resourceType)) event.resourceType = input.resourceType;
  if (typeof input.requestId === 'string' && IDENTIFIER.test(input.requestId)) event.requestId = input.requestId;
  if (REASONS.has(input.outcomeReason)) event.outcomeReason = input.outcomeReason;
  const line = JSON.stringify(event);
  const sink = logger && typeof logger[ input.severity === 'info' ? 'info' : 'warn' ] === 'function'
    ? logger[input.severity === 'info' ? 'info' : 'warn'].bind(logger)
    : null;
  if (sink) sink(line);
  return line;
}

// Single-call-site helper for POST /auth/login. Result is determined by the
// route's outcome; actorRef is the server-side user id on success and null on
// failure (the attempted identity is never logged — no emails, no hashes).
function emitLoginResult({ outcome, userId = null, correlationId = null }, logger = console) {
  const failure = outcome !== 'success';
  return emitSecurityEvent({
    type: 'auth.login',
    severity: failure ? 'warn' : 'info',
    result: failure ? 'failure' : 'success',
    outcomeReason: failure ? outcome : undefined,
    actorRef: userId,
    resourceType: 'session',
    requestId: correlationId,
  }, logger);
}

module.exports = { emitSecurityEvent, emitLoginResult };
