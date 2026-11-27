// Shared environment helpers. Mirrors the production gate used by
// routes/safetyFixtures.js: Railway staging runs NODE_ENV=production, so the
// real environment name wins when present.
const { createHmac } = require('node:crypto');

function environmentName() {
  return process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development';
}

function isProduction() {
  const rail = process.env.RAILWAY_ENVIRONMENT_NAME;
  return rail ? rail === 'production' : process.env.NODE_ENV === 'production';
}

function isStaging() {
  return process.env.RAILWAY_ENVIRONMENT_NAME === 'staging';
}

// Values that must never serve as a production secret, even if explicitly set.
const PREDICTABLE = new Set([
  'mock-secret', 'changeme', 'change-me', 'secret', 'password', 'test',
  'dev-secret', 'dev-doc-secret', 'dev-video-secret', 'dev-formcheck-secret',
  'dev-view-as-secret', 'dev-auth-link-secret',
]);

function isPredictable(value) {
  return typeof value === 'string' && PREDICTABLE.has(value.toLowerCase());
}

/**
 * Resolve a capability/signing secret with a fail-closed production rule.
 *
 * Resolution order:
 *   1. process.env[envName] — the dedicated secret wins.
 *   2. HUMAI_SIGNING_MASTER, then AUTH_LINK_SECRET — a single master secret is
 *      stretched into a cryptographically independent per-purpose key via
 *      HMAC-SHA256(master, "humai:<purpose>"). Distinct purposes can never
 *      share key material this way (explicit domain separation).
 *   3. Non-production → the caller's dev fallback.
 *   4. Production → throw at module load; a capability secret defaulting to a
 *      public value lets any authenticated user forge signed URLs/tokens.
 *
 * In production an explicitly-configured predictable value is rejected as if
 * missing — naming a public value does not make it a secret.
 */
function requiredSecret(envName, devFallback, purpose = envName.toLowerCase()) {
  const dedicated = process.env[envName];
  if (dedicated) {
    if (isProduction() && isPredictable(dedicated)) {
      throw new Error(`${envName} is set to a predictable value — refusing it in ${environmentName()}.`);
    }
    return dedicated;
  }
  const master = process.env.HUMAI_SIGNING_MASTER || process.env.AUTH_LINK_SECRET;
  if (master) {
    if (isProduction() && isPredictable(master)) {
      throw new Error(`Signing master secret is predictable — refusing to derive ${envName} in ${environmentName()}.`);
    }
    return createHmac('sha256', master).update(`humai:${purpose}`).digest('hex');
  }
  if (isProduction()) {
    throw new Error(`${envName} (or HUMAI_SIGNING_MASTER / AUTH_LINK_SECRET) must be set in production — refusing to use a public fallback secret.`);
  }
  return devFallback;
}

/**
 * Startup configuration validation. Each entry names a secret and the feature
 * that needs it; secrets for disabled features are reported but never block
 * startup (a missing payment secret must not stop meal logging).
 *
 * enabled() returns true when the feature is on; required only then.
 * Log lines name variables and status only — never values.
 */
const SECRET_RULES = [
  { name: 'DATABASE_URL', enabled: () => true, note: 'primary datastore' },
  { name: 'AUTH_LINK_SECRET', enabled: () => true, note: 'session/auth-link signing' },
  { name: 'PAYMENTS_WEBHOOK_SECRET', enabled: () => process.env.PAYMENTS_PROVIDER && process.env.PAYMENTS_PROVIDER !== 'mock', note: 'provider webhook verification (commerce only)' },
  { name: 'OPENAI_API_KEY', enabled: () => process.env.AI_ENABLED === 'true', note: 'AI features' },
  { name: 'RESEND_API_KEY', enabled: () => true, note: 'transactional email' },
  // Capability/signing secrets — each independently derivable from the master,
  // so an unset dedicated var is only a warning IF a master exists; with no
  // master at all in production, requiredSecret() already throws at module
  // load. These rules make the readiness command enumerate the full surface.
  { name: 'DOC_URL_SECRET', enabled: () => false, note: 'signed document URLs (derivable from master)' },
  { name: 'VIDEO_TOKEN_SECRET', enabled: () => false, note: 'video session tokens (derivable from master)' },
  { name: 'VIEW_AS_SECRET', enabled: () => false, note: 'support view-as tokens (derivable from master)' },
  { name: 'FORM_CHECK_SECRET', enabled: () => false, note: 'form-check signing (derivable from master)' },
];

/**
 * CORS validation: contradictory config fails safe. Production with NO
 * CORS_ORIGINS means cross-origin browser access is impossible — that is the
 * safe default, reported as a warning not an error (native clients unaffected).
 * A wildcard '*' in production is a contradiction of the credentialed-api
 * security model and is reported as missing/invalid — fail safe.
 */
function validateCors(env = process.env) {
  const raw = env.CORS_ORIGINS || '';
  const origins = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const problems = [];
  if (isProduction() && origins.includes('*')) {
    problems.push('CORS_ORIGINS contains wildcard * — contradicts credentialed-api model in production');
  }
  for (const o of origins) {
    if (o !== '*' && !/^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?$/.test(o)) {
      problems.push(`CORS_ORIGINS entry malformed (must be scheme://host[:port])`);
    }
  }
  return { ok: problems.length === 0, problems, configured: origins.length > 0 };
}

/**
 * Returns { ok, missing[], warnings[] } of variable names only. In production a
 * missing enabled-feature secret makes ok=false — callers throw before the
 * affected functionality is reachable. Missing secrets for disabled features
 * surface as warnings.
 */
function validateConfig(env = process.env) {
  const missing = [];
  const warnings = [];
  for (const rule of SECRET_RULES) {
    const on = rule.enabled();
    const set = !!env[rule.name];
    if (on && !set) missing.push(rule.name);
    if (!on && !set) warnings.push(`${rule.name} unset (${rule.note}) — feature inactive`);
    if (set && isProduction() && isPredictable(env[rule.name])) missing.push(`${rule.name} is predictable`);
  }
  return { ok: missing.length === 0, missing, warnings };
}

module.exports = { environmentName, isProduction, isStaging, isPredictable, requiredSecret, validateConfig, validateCors };
