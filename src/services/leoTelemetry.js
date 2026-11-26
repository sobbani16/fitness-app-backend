// Leo telemetry redaction boundary — the ONLY approved path for Leo voice
// analytics events to reach logs. Follows the requestContext conventions:
// flat fixed-key JSON through an injectable logger, validated identifiers,
// no free-form content ever.
//
// REDACTION CONTRACT (pc-HUM-97):
//   - Unknown event names are REJECTED — nothing reaches the sink.
//   - The schema admits only finite bounded numerics and closed categorical
//     enums. There is deliberately NO free-string field type: arbitrary
//     strings, transcripts, tokens, audio refs, health data, nested objects
//     and raw errors cannot pass validation by construction.
//   - Fields outside an event's approved schema are OMITTED, never passed
//     through. Malformed values in approved fields are omitted field-wise.
//   - correlation/session/request identifiers must come from trusted
//     application context (req.correlationId, server-side session ids) —
//     they are pattern-validated here, so a caller-controlled string that
//     does not match the identifier shape is omitted rather than logged.
//   - The caller's payload object is never handed to the logger; a new flat
//     object is built from validated scalars only.
//
// P30 EVENT CATALOG: PENDING. The canonical P30 catalog lives in the missing
// spec (docs/programs/hey-leo-voice-assistant.md — absent from all refs, see
// the pc-HUM-97 recovery record). Until it lands the shipped instance below
// has an EMPTY catalog and rejects everything: the boundary is fail-closed
// by default. Do not infer catalog entries here.

const IDENTIFIER = /^[A-Za-z0-9._-]{8,80}$/;
const EVENT_NAME = /^[a-z][a-z0-9_]{0,47}(\.[a-z][a-z0-9_]{0,47})?$/;
const MAX_NUMERIC_FIELDS = 16;
const MAX_CATEGORICAL_VALUES = 32;

function validIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER.test(value) ? value : null;
}

function validNumeric(value, bounds) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (bounds) {
    if (typeof bounds.min === 'number' && value < bounds.min) return null;
    if (typeof bounds.max === 'number' && value > bounds.max) return null;
  }
  return value;
}

function validCategorical(value, allowed) {
  return typeof value === 'string' && allowed.includes(value) ? value : null;
}

function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new Error('catalog must be an object map of event name to schema');
  }
  for (const [name, schema] of Object.entries(catalog)) {
    if (!EVENT_NAME.test(name)) throw new Error(`invalid event name in catalog: ${name}`);
    if (!schema || typeof schema !== 'object') throw new Error(`schema missing for ${name}`);
    const numerics = Object.keys(schema.numerics || {});
    const categoricals = Object.keys(schema.categoricals || {});
    if (numerics.length > MAX_NUMERIC_FIELDS) throw new Error(`${name}: too many numeric fields`);
    for (const n of numerics) {
      const b = schema.numerics[n];
      if (b !== undefined && (typeof b !== 'object' || b === null)) throw new Error(`${name}.${n}: bounds must be an object`);
    }
    for (const c of categoricals) {
      const values = schema.categoricals[c];
      if (!Array.isArray(values) || !values.length || values.length > MAX_CATEGORICAL_VALUES || values.some((v) => typeof v !== 'string')) {
        throw new Error(`${name}.${c}: categorical values must be a non-empty string array (max ${MAX_CATEGORICAL_VALUES})`);
      }
    }
  }
}

/**
 * Build a redaction-bounded telemetry emitter.
 * catalog: { [eventName]: { numerics?: {field: {min?,max?}}, categoricals?: {field: [values]} } }
 * logger: anything with .info (defaults to console, matching requestContext's default).
 */
function createLeoTelemetry({ catalog = {}, logger = console } = {}) {
  validateCatalog(catalog);

  /**
   * Emit one event. Returns the emitted object, or null when rejected
   * (unknown event) — a rejected event never touches the sink.
   *
   * @param {string} eventName catalog key; anything else is rejected
   * @param {object} context trusted identifiers: { correlationId, sessionId, requestId }
   * @param {object} fields metadata fields; only schema-approved keys are considered
   */
  function log(eventName, context = {}, fields = {}) {
    const schema = catalog[eventName];
    if (!schema || typeof eventName !== 'string') return null;

    const out = { event: eventName };

    // Identifiers — trusted-context shapes only; anything else is omitted.
    const correlationId = validIdentifier(context.correlationId);
    const sessionId = validIdentifier(context.sessionId);
    const requestId = validIdentifier(context.requestId);
    if (correlationId) out.correlationId = correlationId;
    if (sessionId) out.sessionId = sessionId;
    if (requestId) out.requestId = requestId;

    // Metadata — schema-approved keys only, scalar validation per type.
    // Unknown keys, nested objects, arrays, arbitrary strings and error
    // objects are structurally impossible here: only keys declared in the
    // schema are read, and only as number or closed-enum categorical.
    if (fields && typeof fields === 'object') {
      for (const [field, bounds] of Object.entries(schema.numerics || {})) {
        const v = validNumeric(fields[field], bounds);
        if (v !== null) out[field] = v;
      }
      for (const [field, allowed] of Object.entries(schema.categoricals || {})) {
        const v = validCategorical(fields[field], allowed);
        if (v !== null) out[field] = v;
      }
    }

    logger.info(JSON.stringify(out));
    return out;
  }

  return { log, catalog: Object.freeze({ ...catalog }) };
}

// Shipped instance: EMPTY catalog — rejects every event until the canonical
// P30 catalog lands. The catalog is data, not code: when the spec is
// recovered it is added here as an explicit reviewed list.
const leoTelemetry = createLeoTelemetry({ catalog: {} });

module.exports = { createLeoTelemetry, leoTelemetry };
