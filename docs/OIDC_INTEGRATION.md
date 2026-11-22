# OIDC Integration Contract — Humai Fitness

Provider-readiness spec. No external login is active; this documents the
agreed integration shape for a future provider (ForgeRock/Ping, Okta, Auth0).

## Current state (unchanged)

- Login: `POST /auth/login` — scrypt password → opaque bearer token.
- Session: `AuthSession.tokenHash` (SHA-256), 30-day expiry, `req.userId` from
  `authenticate()` only. Client-supplied userIds are never trusted.
- Authorization/RBAC stays 100% in Humai (roles, entitlements, feature flags).
- Every health/nutrition/workout/progress row joins on internal `User.id`.

## New: UserIdentity

`UserIdentity(userId, provider, issuer, subject)` — `UNIQUE(issuer, subject)`.
The ONLY allowed translation between an external account and a Humai user.
Linking requires an authenticated session (`POST /auth/identities/link`,
flag `external_identity_linking_enabled`, default OFF). Unlink is refused when
it would orphan an account with no password (lockout guard).

## RN flow: Authorization Code + PKCE

Use `react-native-app-auth` (or Expo `AuthSession`) — never a WebView password
form, never the implicit or ROPC flows.

1. Client generates `code_verifier`/`code_challenge` (S256) + `state` + `nonce`.
2. `GET {iss}/authorize?response_type=code&client_id&redirect_uri&scope=openid profile email&state&nonce&code_challenge&code_challenge_method=S256`
   via the system browser (ASWebAuthenticationSession / Chrome Custom Tabs).
3. Provider redirects to the app scheme `com.humai:/oauth2redirect` with `code`.
4. App POSTs `code` + `code_verifier` + `redirect_uri` to `POST /auth/oidc/exchange` (NEW — not built).
5. **Server** exchanges code at `{iss}/token`, validates the ID token, resolves
   `UserIdentity(issuer, sub)` → internal userId, then issues the existing
   Humai `AuthSession` bearer token. The app never stores provider tokens.

## Token validation requirements (server)

On every exchange/refresh the server MUST verify the ID token:

- `iss` — exact match to the configured issuer (normalized: https, no trailing slash).
- `aud` — contains Humai's `client_id`.
- `exp`/`iat`/`nbf` — valid, ≤5 min clock skew.
- `signature` — RS256/ES256 against the provider **JWKS** (`{iss}/jwks.json`),
  cached by `kid` with rotation handling (refetch on unknown `kid`, min TTL 5 min).
- `nonce` — echoes the value sent at authorize time.
- Reject `alg=none`, HS* with public clients, missing `sub`.

Use `jose` or `jwks-rsa`; do not hand-roll JWT parsing.

## Account mapping rules

- `sub` (with `iss`) is the only stable key — never `email`/`preferred_username`.
- Auto-provisioning on first OIDC login is a SEPARATE decision + flag
  (`oidc_auto_provision_enabled`, default OFF). Until enabled, unknown
  (iss, sub) pairs get an explicit "link or create" prompt.
- Email-linking requires `email_verified=true` in claims AND user confirmation.
- One external identity → exactly one user; one user → ≤5 identities.
- `User.passwordHash` stays nullable for future identity-only users.

## Sessions, logout, revocation, outage

- After exchange, issue a normal `AuthSession` (30 days) — identical to today.
- Logout deletes the local session; optionally calls `{iss}/end_session` with
  `id_token_hint` when the provider supports it (best-effort, non-blocking).
- Provider revocation events (back-channel logout) → delete matching sessions.
- Provider outage: existing password sessions keep working; OIDC login returns
  503 `provider_unavailable`; never fall back to accepting unverified tokens.
- Keep provider client secret server-side only; RN app holds no secrets.

## ForgeRock notes

- AM endpoint: `https://{host}/am/oauth2/realms/root` — issuer string must match
  EXACTLY what AM emits (realm path included).
- Supports discovery at `{iss}/.well-known/openid-configuration`.
- Register the app as a public native client: grant `authorization_code`,
  PKCE required, redirect URI = app scheme.
- Okta/Auth0 follow the same contract — only issuer/discovery URLs differ.

## Migration & rollout

`20261213600000_user_identities` — additive table only; no data changes.
Rollback: drop table + flag off; login path untouched.
