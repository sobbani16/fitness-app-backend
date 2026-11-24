// Shared environment helpers. Mirrors the production gate used by
// routes/safetyFixtures.js: Railway staging runs NODE_ENV=production, so the
// real environment name wins when present.
function isProduction() {
  const rail = process.env.RAILWAY_ENVIRONMENT_NAME;
  return rail ? rail === 'production' : process.env.NODE_ENV === 'production';
}

/**
 * Resolve a capability/signing secret with a fail-closed production rule.
 * `envName` wins, then AUTH_LINK_SECRET. In production a missing value throws
 * at module load — a capability secret that defaults to a public value lets
 * any authenticated user forge signed URLs/tokens.
 */
function requiredSecret(envName, devFallback) {
  const value = process.env[envName] || process.env.AUTH_LINK_SECRET;
  if (value) return value;
  if (isProduction()) {
    throw new Error(`${envName} (or AUTH_LINK_SECRET) must be set in production — refusing to use a public fallback secret.`);
  }
  return devFallback;
}

module.exports = { isProduction, requiredSecret };
