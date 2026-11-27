/**
 * FeatureFlagService — evaluates the registry for authenticated users.
 *
 * Deterministic precedence (documented in FEATURE_FLAG_IMPLEMENTATION_PLAN.md):
 *   1. AI_EMERGENCY_SHUTDOWN env                -> all group:'ai' flags = false
 *   2. ai_emergency_shutdown (provider or env)  -> all group:'ai' flags = false
 *   3. environments restriction                 -> false outside listed envs
 *   4. dependsOn unmet                          -> false (structural invariant:
 *                                                cannot be overridden)
 *   5. FF_<KEY> env override                    -> its value (beats provider)
 *   6. provider flag present                    -> its value (PostHog already
 *                                                applied targeting/rollout)
 *   7. registry default                         - fail-closed for AI/costly,
 *                                                fail-open for core/manual.
 *
 * User targeting can never bypass steps 1-4. Provider errors resolve to env
 * overrides + registry defaults only — never silently enable anything.
 *
 * Results are cached per user for FF_CACHE_TTL_MS (default 60s). The cache is
 * bounded (FF_CACHE_MAX entries, FIFO eviction) and is the single point that
 * bounds kill-switch propagation delay on the server.
 */

const { FEATURES, KEYS, envOverrideName } = require('../../config/featureRegistry');
const provider = require('./provider');

// TTL is read dynamically (not frozen at module load) so tests can opt into
// cache behavior explicitly while the global test default stays TTL=0.
function cacheTtlMs() {
  return process.env.FF_CACHE_TTL_MS !== undefined
    ? Number(process.env.FF_CACHE_TTL_MS)
    : 60_000;
}
const CACHE_MAX = Number(process.env.FF_CACHE_MAX) || 5_000;

// userId -> { flags: {key:boolean}, expiresAt }
const cache = new Map();

let lastProviderErrorAt = 0;
let lastProviderError = null;

function envAiShutdown() {
  return process.env.AI_EMERGENCY_SHUTDOWN === 'true';
}

function envOverride(key) {
  const raw = process.env[envOverrideName(key)];
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

// FF_<KEY>_USERS=u1,u2 — explicit per-account allowlist. When set, the flag
// can only resolve true for listed userIds; everyone else resolves false
// regardless of overrides/provider. Used for internal-cohort rollouts where
// PostHog targeting is unavailable. Parses lazily per evaluation.
function envAllowlist(key) {
  const raw = process.env[`${envOverrideName(key)}_USERS`];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function envAllowed(feature) {
  if (!feature.environments) return true;
  return feature.environments.includes(process.env.NODE_ENV || 'development');
}

/**
 * Resolve one key against provider flags + env, following the precedence above.
 * `resolved` memoizes within a single evaluation pass (dependency chains).
 */
function resolveKey(key, providerFlags, aiShutdown, resolved, visiting, userId) {
  if (resolved.has(key)) return resolved.get(key);
  const feature = FEATURES[key];
  if (!feature) { resolved.set(key, false); return false; }

  let value;
  if (feature.group === 'ai' && aiShutdown) {
    value = false;                                                  // 1+2
  } else if (!envAllowed(feature)) {
    value = false;                                                  // 3
  } else if (feature.dependsOn && !visiting.has(key) &&
             feature.dependsOn.some((dep) => {
               const seen = new Set(visiting); seen.add(key);
               return !resolveKey(dep, providerFlags, aiShutdown, resolved, seen, userId);
             })) {
    value = false;                                                  // 4
  } else {
    const allow = envAllowlist(key);
    if (allow && !allow.has(String(userId))) {
      value = false;                                                // 5 — cohort gate
    } else if (envOverride(key) !== undefined) {
      value = envOverride(key);                                     // 6
    } else if (Object.prototype.hasOwnProperty.call(providerFlags, key)) {
      value = Boolean(providerFlags[key]);                          // 7
    } else {
      value = feature.default;                                      // 8
    }
  }
  resolved.set(key, value);
  return value;
}

async function getProviderFlags(userId) {
  if (provider.providerName() !== 'posthog') return {};
  try {
    return await provider.fetchProviderFlags(userId);
  } catch (err) {
    lastProviderErrorAt = Date.now();
    lastProviderError = err.message;
    console.warn(`[featureFlags] provider evaluation failed: ${err.message}`);
    return null; // caller falls back to env + defaults
  }
}

/**
 * Evaluate every registry flag for a user. Returns { key: boolean } in
 * snake_case plus the resolved ai_emergency_shutdown state.
 */
async function evaluateAll(userId) {
  const cached = cacheTtlMs() > 0 ? cache.get(String(userId)) : null;
  if (cached && cached.expiresAt > Date.now()) return cached.flags;

  const providerFlags = await getProviderFlags(userId);
  const flags = {};
  const resolved = new Map();

  // Provider outage (null) resolves through the SAME precedence chain with an
  // empty provider contribution — env guards, dependencies, allowlists, and
  // the emergency shutdown must not weaken when the provider is unreachable.
  const pf = providerFlags === null ? {} : providerFlags;
  // Resolve the control flag first so its env/provider value participates in
  // this same evaluation pass for every group:'ai' key.
  const shutdownFlag = resolveKey('ai_emergency_shutdown', pf, false, resolved, new Set(), userId);
  const aiShutdown = envAiShutdown() || shutdownFlag;
  resolved.set('ai_emergency_shutdown', shutdownFlag);
  for (const key of KEYS) flags[key] = resolveKey(key, pf, aiShutdown, resolved, new Set(), userId);

  if (cacheTtlMs() > 0) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(String(userId), { flags, expiresAt: Date.now() + cacheTtlMs() });
  }
  return flags;
}

async function isEnabled(key, userId) {
  if (!FEATURES[key]) return false; // unknown key => fail closed
  const flags = await evaluateAll(userId);
  return flags[key] === true;
}

/** Fast kill-switch check used inside aiProvider — env is synchronous. */
async function isAiShutdown(userId) {
  if (envAiShutdown()) return true;
  const flags = await evaluateAll(userId);
  return flags.ai_emergency_shutdown === true;
}

/** camelCase map for GET /config/features. */
async function clientConfig(userId) {
  const flags = await evaluateAll(userId);
  const out = {};
  for (const key of KEYS) out[FEATURES[key].clientKey] = flags[key];
  return out;
}

/** Test hook: drop the per-user cache between assertions. */
function resetCache() {
  cache.clear();
  lastProviderErrorAt = 0;
  lastProviderError = null;
}

function diagnostics() {
  return {
    provider: provider.providerName(),
    cacheSize: cache.size,
    cacheTtlMs: cacheTtlMs(),
    envAiShutdown: envAiShutdown(),
    lastProviderErrorAt: lastProviderErrorAt || undefined,
    lastProviderError: lastProviderError || undefined,
  };
}

module.exports = { evaluateAll, isEnabled, isAiShutdown, clientConfig, resetCache, diagnostics };
