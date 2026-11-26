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
// P30 EVENT CATALOG: v1 shipped below — recovered from the canonical spec
// (docs/programs/hey-leo-voice-assistant.md, paperclip-humai). The boundary
// remains fail-closed for anything outside the catalog.

const IDENTIFIER = /^[A-Za-z0-9._-]{8,80}$/;
const EVENT_NAME = /^[a-z][a-z0-9_]{0,47}(\.[a-z][a-z0-9_]{0,47}){0,2}$/;
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


// ---------------------------------------------------------------------------
// P30 EVENT CATALOG v1 — from docs/programs/hey-leo-voice-assistant.md (P30,
// recovered 2026-11-26). Closed enums are deliberately conservative: an
// out-of-enum value is omitted field-wise, never fatal — extending the enum
// is a reviewed catalog edit, not a code change.
//
// HONEST LIMITATION: the spec field list includes `version` (app version).
// Version strings are unbounded free-form scalars and this boundary has no
// free-string type BY DESIGN (it is what makes transcripts/tokens/health
// data structurally unloggable). Version therefore belongs to the deployment
// platform layer (Railway/release tagging), not to per-event payloads.
// ---------------------------------------------------------------------------

const PLATFORM = ['ios', 'android', 'web'];
const ENV = ['production', 'staging', 'development', 'test'];
const PROVIDER = ['local', 'openai', 'whisper', 'apple', 'google', 'mock'];
const ERROR_CATEGORY = ['timeout', 'rate_limited', 'auth', 'network', 'provider', 'validation', 'cancelled', 'unknown'];
// Leo mutation/tool surface — P29/P30 starter set; extended by reviewed edit.
const TOOL = ['food_log', 'workout_log', 'water_log', 'weight_log', 'recommend', 'briefing', 'recipe_steps', 'grocery_list', 'evening_review', 'reminder', 'education', 'weather', 'label_scan', 'unknown'];
const TIER = ['tier1', 'tier2', 'tier3'];
const TRANSITION = ['idle', 'listening', 'transcribing', 'orchestrating', 'confirming', 'executing', 'rendering', 'speaking', 'standby', 'cancelled', 'error'];

const MS = { min: 0, max: 3_600_000 }; // bounded 1h — long-session outliers omitted, not logged as garbage
const COUNT = { min: 0, max: 1000 };
const QUEUE_DEPTH = { min: 0, max: 10000 };

const base = { categoricals: { platform: PLATFORM, env: ENV } };
function withBase(schema) {
  return {
    numerics: { ...(schema.numerics || {}) },
    categoricals: { ...base.categoricals, ...(schema.categoricals || {}) },
  };
}

const P30_CATALOG = {
  'leo.wake_word.detected': withBase({}),
  'leo.session.started': withBase({}),
  'leo.session.completed': withBase({ numerics: { durationMs: MS } }),
  'leo.session.cancelled': withBase({ numerics: { durationMs: MS }, categoricals: { transition: TRANSITION } }),
  'leo.mic.permission': withBase({ categoricals: { result: ['granted', 'denied', 'revoked'] } }),
  'leo.audio.init': withBase({ numerics: { durationMs: MS } }),
  'leo.audio.interrupted': withBase({ categoricals: { reason: ['call', 'background', 'bluetooth', 'user', 'system', 'unknown'] } }),
  'leo.speech.started': withBase({}),
  'leo.speech.finalized': withBase({ numerics: { durationMs: MS } }),
  'leo.transcription.completed': withBase({ numerics: { durationMs: MS, audioDurationMs: MS }, categoricals: { provider: PROVIDER } }),
  'leo.transcription.failed': withBase({ numerics: { durationMs: MS }, categoricals: { provider: PROVIDER, errorCategory: ERROR_CATEGORY } }),
  'leo.intent.resolved': withBase({ numerics: { durationMs: MS }, categoricals: { tier: TIER, provider: PROVIDER } }),
  'leo.tool.started': withBase({ categoricals: { tool: TOOL } }),
  'leo.tool.completed': withBase({ numerics: { durationMs: MS, retryCount: COUNT }, categoricals: { tool: TOOL } }),
  'leo.tool.failed': withBase({ numerics: { durationMs: MS, retryCount: COUNT }, categoricals: { tool: TOOL, errorCategory: ERROR_CATEGORY } }),
  'leo.confirmation.shown': withBase({ categoricals: { tool: TOOL } }),
  'leo.confirmation.accepted': withBase({ numerics: { durationMs: MS }, categoricals: { tool: TOOL } }),
  'leo.confirmation.expired': withBase({ categoricals: { tool: TOOL } }),
  'leo.safety.rejected': withBase({ categoricals: { safetyCategory: ['medical', 'unsafe_goal', 'injection', 'authz', 'allergy_bypass', 'other'] } }),
  'leo.mutation.duplicate_prevented': withBase({ categoricals: { tool: TOOL } }),
  'leo.response.rendered': withBase({ numerics: { durationMs: MS } }),
  'leo.tts.started': withBase({ categoricals: { provider: PROVIDER } }),
  'leo.tts.failed': withBase({ categoricals: { provider: PROVIDER, errorCategory: ERROR_CATEGORY } }),
  'leo.provider.rate_limited': withBase({ numerics: { retryAfterMs: MS }, categoricals: { provider: PROVIDER } }),
  'leo.offline.queued': withBase({ numerics: { queueDepth: QUEUE_DEPTH }, categoricals: { tool: TOOL } }),
  'leo.offline.synced': withBase({ numerics: { syncLatencyMs: MS, queueDepth: QUEUE_DEPTH }, categoricals: { tool: TOOL, result: ['success', 'failed', 'duplicate'] } }),
};

// Shipped instance: P30 catalog v1 (recovered spec). Catalog is data, not
// code — extensions are reviewed edits to P30_CATALOG above.
const leoTelemetry = createLeoTelemetry({ catalog: P30_CATALOG });

module.exports = { createLeoTelemetry, leoTelemetry, P30_CATALOG };
