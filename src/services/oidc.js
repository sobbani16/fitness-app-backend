// OIDC validation + exchange plumbing (readiness — dark until configured).
// Requires env: OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_TOKEN_URI, OIDC_JWKS_URI.
// Flag oidc_login_enabled gates the route; missing config -> 503, never a fallback.
const { createRemoteJWKSet, jwtVerify } = require('jose');
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { resolveUserByIdentity, linkIdentity } = require('./identity');
const { createSession } = require('./authService');

let jwks;
function config() {
  const { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_TOKEN_URI, OIDC_JWKS_URI } = process.env;
  if (!OIDC_ISSUER || !OIDC_CLIENT_ID || !OIDC_TOKEN_URI || !OIDC_JWKS_URI) {
    throw httpError(503, 'OIDC provider is not configured.');
  }
  return { issuer: OIDC_ISSUER.replace(/\/$/, ''), clientId: OIDC_CLIENT_ID, tokenUri: OIDC_TOKEN_URI, jwksUri: OIDC_JWKS_URI };
}

function getJWKS(uri) {
  if (!jwks || jwks._uri !== uri) { jwks = createRemoteJWKSet(new URL(uri), { cacheMaxAge: 5 * 60 * 1000 }); jwks._uri = uri; }
  return jwks;
}

// Validates iss, aud, exp/iat, signature via JWKS (auto-rotation on new kid).
// Optional nonce must match the value sent at authorize time.
async function validateIdToken(idToken, { nonce, issuer, audience, jwksUri } = {}) {
  const cfg = config();
  const { payload } = await jwtVerify(idToken, getJWKS(jwksUri || cfg.jwksUri), {
    issuer: issuer || cfg.issuer,
    audience: audience || cfg.clientId,
    clockTolerance: 300, // ≤5 min skew
  });
  if (!payload.sub) throw httpError(401, 'ID token missing subject.');
  if (nonce !== undefined && payload.nonce !== nonce) throw httpError(401, 'ID token nonce mismatch.');
  return payload;
}

// Server-side code exchange (PKCE verifier supplied by the RN client).
async function exchangeCode({ code, codeVerifier, redirectUri, nonce }) {
  const cfg = config();
  if (!code || !codeVerifier) throw httpError(400, 'code and code_verifier are required.');
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code,
    client_id: cfg.clientId, redirect_uri: redirectUri || '', code_verifier: codeVerifier,
  });
  const r = await fetch(cfg.tokenUri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10000) }).catch(() => { throw httpError(503, 'Identity provider unavailable.'); });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(502, `Provider token exchange failed: ${data.error || r.status}`);
  const claims = await validateIdToken(data.id_token, { nonce });
  return { issuer: cfg.issuer, subject: claims.sub, claims };
}

// Maps a validated identity to a Humai session. Provisioning stays OFF —
// unlinked identities get 404 so the client shows the link/sign-in path.
async function oidcLogin({ issuer, subject, claims = {}, allowProvision = false }) {
  const prisma = getPrisma();
  let userId = await resolveUserByIdentity(issuer, subject, prisma);
  if (!userId && allowProvision) {
    if (claims.email_verified !== true) throw httpError(400, 'Provider email must be verified to auto-provision.');
    const user = await prisma.user.create({ data: { email: (claims.email || '').toLowerCase() || `oidc-${subject}@external`, emailVerifiedAt: claims.email ? new Date() : null } });
    await linkIdentity(user.id, { issuer, subject, provider: 'oidc' }, prisma);
    userId = user.id;
  }
  if (!userId) throw httpError(404, 'No linked Humai account for this identity. Sign in to link it.');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return createSession(user, prisma);
}

module.exports = { validateIdToken, exchangeCode, oidcLogin, _resetJwks: () => { jwks = null; } };
