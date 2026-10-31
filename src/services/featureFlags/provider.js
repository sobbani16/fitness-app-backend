/**
 * Feature-flag provider abstraction — the only module that knows about PostHog.
 * Swapping providers means changing this file, nothing else.
 *
 * Providers:
 *   'posthog' - PostHog Cloud via posthog-node (remote /decide evaluation).
 *   'env'     - registry defaults + FF_* env overrides only. Automatic when no
 *               POSTHOG_API_KEY is configured, and the documented rollback path
 *               (FEATURE_FLAGS_PROVIDER=env or off).
 *   'off'     - registry defaults only; ignores even FF_* targeting.
 */

let posthogClient = null;

function providerName() {
  const configured = (process.env.FEATURE_FLAGS_PROVIDER || '').trim();
  if (configured) return configured;
  return process.env.POSTHOG_API_KEY ? 'posthog' : 'env';
}

function getClient() {
  if (posthogClient) return posthogClient;
  const { PostHog } = require('posthog-node');
  posthogClient = new PostHog(process.env.POSTHOG_API_KEY, {
    host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
    // Server-side only: no event capture needed for flag evaluation.
    flushAt: 1,
    flushInterval: 0,
    disableGeoip: true,
  });
  return posthogClient;
}

/**
 * Resolve all PostHog-managed flags for one user.
 * Returns a map of { flagKey: boolean } containing only flags PostHog
 * evaluated as enabled for this distinct_id (targeting + rollout already
 * applied server-side by PostHog). Throws on provider failure — the caller
 * decides the fallback policy.
 */
async function fetchProviderFlags(userId) {
  const flags = await getClient().getAllFlags(String(userId), {}, {});
  const out = {};
  for (const [key, value] of Object.entries(flags || {})) {
    out[key] = value === true || (typeof value === 'string' && value !== 'false');
  }
  return out;
}

async function shutdown() {
  if (posthogClient) await posthogClient.shutdown().catch(() => {});
  posthogClient = null;
}

module.exports = { providerName, fetchProviderFlags, shutdown };
