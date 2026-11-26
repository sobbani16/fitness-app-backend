# Credential Rotation Runbook

Evidence of exposure scope: SECRET_AUDIT.md + git history review — tracked
`.env` files contained only public identifiers (EXPO_PUBLIC_API_URL,
VITE_API_URL); no private credential was found in any tracked file. Local
(untracked) backend `.env` holds real keys — rotate if the machine or the file
was ever shared. **Never print values while executing this runbook.**

## For each credential: AUTH_LINK_SECRET, HUMAI_SIGNING_MASTER, PAYMENTS_WEBHOOK_SECRET, DOC_URL_SECRET, VIDEO_TOKEN_SECRET, FORM_CHECK_URL_SECRET, VIEW_AS_SECRET, DATABASE_URL password, OPENAI_API_KEY, RESEND_API_KEY, LIVEKIT_*, SPOONACULAR/USDA/YOUTUBE/DATA_GOV_IN keys

1. **Generate** — `node scripts/provision-secrets.js` (gitignored, 0600, never echoes) or provider console for API keys.
2. **Provision** — set the new value in Railway Variables / secret manager. Do not deploy yet if the service can pick it up on restart only — see step 4.
3. **Verify dependents** — for signing secrets: in-flight signed URLs issued under the old key will fail verification after cutover. Prefer issuing secrets per-purpose (`DOC_URL_SECRET` etc.) so a single rotation doesn't invalidate every capability. For AUTH_LINK_SECRET: outstanding email action links (reset/verify) die at cutover — acceptable, users re-request.
4. **Transition consumers** — redeploy; `validateConfig` + `requiredSecret` fail fast if a value is missing or predictable, listing names only.
5. **Revoke** — delete/revoke the old credential at the provider (or drop the old env var). For DB credentials: rotate the role password, then update `DATABASE_URL`.
6. **Verify rejection** — confirm the old credential no longer works (provider dashboard shows revoked; for signing keys, confirm a pre-cutover signed URL now 403s).
7. **Monitor** — 24h elevated watch on 401/403 rates per surface (auth sessions, signed URLs, webhooks, email sends).

## Emergency (suspected compromise)

- AUTH_LINK_SECRET / session compromise → rotate immediately; all sessions die (users re-login) — intended blast radius.
- PAYMENTS_WEBHOOK_SECRET → rotate AND freeze webhooks: leave the var unset in prod → `webhookSecret()` throws 503 → no event can be forged while creds rotate.
- DB credential → rotate password, update DATABASE_URL, redeploy; review `_prisma` access logs.
- Provider keys (OpenAI/Resend/LiveKit) → revoke at provider, provision replacement, redeploy.

## Session / token specifics

- Session tokens: sha256-hashed in DB, 30-day expiry; mass-revoke via `AuthSession` delete where `userId`/`createdAt` matches the incident window.
- View-as tokens: 30-min TTL, HMAC — rotation of VIEW_AS_SECRET kills outstanding tokens (re-issue as needed).
- OIDC creds: provider-console rotation; no storage in repo.
