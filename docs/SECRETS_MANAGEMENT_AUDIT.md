# Secrets Management Audit

**Date:** 2026-03-10 · **Scope:** backend + mobile repos

## Verdict: solid baseline, two medium fixes applied/found

### What is already right

- **Auth model:** opaque 256-bit bearer tokens; only SHA-256 hashes at rest (`AuthSession`); 30-day expiry; comprehensive revocation paths (logout, password reset, role change, migration, admin ops). No JWT anywhere.
- **Passwords:** `crypto.scrypt` with unique 128-bit salt, `timingSafeEqual` verify, fixed dummy work for unknown accounts, generic login errors, `User.passwordHash` only — no plaintext anywhere.
- **Session spoofing:** `authenticate` overwrites `x-user-id` with the session identity — client-supplied IDs can't be trusted anywhere downstream.
- **Mobile storage:** `expo-secure-store` (Keychain/Keystore) for the session; AsyncStorage holds non-credential data only, account-keyed.
- **Bundle safety:** `scripts/verify-release.cjs` blocks any `EXPO_PUBLIC_*` name matching `SECRET|PASSWORD|TOKEN|API_KEY|DATABASE`; `apiUrl.ts` rejects credentialed URLs.
- **Logging hygiene:** morgan skips `/auth` paths; 5xx handler logs `{path, code}` only; email worker never logs recipients/tokens; feedback service redacts keys/emails/measurements.
- **Deploy gating:** `deploy-prepare.js` validates `AUTH_LINK_SECRET`/`AUTH_PUBLIC_URL`/`RESEND_API_KEY` *before* migrations; prod boot hard-fails if `AUTH_TEST_BYPASS` is set.
- **`.env.example`:** no live secrets (verified — the earlier OpenAI key leak was scrubbed this session before the push).

### Findings

| # | Sev | Finding | Status |
|---|---|---|---|
| 1 | Medium | `scrypt` uses **Node defaults N=2¹⁴** — below OWASP (2¹⁷)/RFC 7914 (2¹⁵). `salt:hash` format has no param field → needs versioned hash + rehash-on-login | **Deferred** — approved as separate PR (auth-touching change) |
| 2 | Medium | Backend `.gitignore` covered only `.env` — not `.env.*` variants | **Fixed** (`.env.*` + `!.env.example`) |
| 3 | Low | 8 env vars undocumented (`YOUTUBE_API_KEY`, `CORS_ORIGINS`, `TRUST_PROXY_HOPS`, `API_RATE_LIMIT`, `ENABLE_API_DOCS`, `CHAT_DAILY_LIMIT`, `VOICE_TRANSCRIBE_MODEL`, `AUTH_TEST_BYPASS`) | **Fixed** (added to `.env.example`) |
| 4 | Info | Provider keys ride in outbound URL query params (Spoonacular/USDA/YouTube) — required by those APIs; server-side only, never logged | Noted |
| 5 | Info | PostHog `phc_` project token is *public-class* (designed for client apps) but we treat it as server config — in Railway vars, never `EXPO_PUBLIC_`, never in the flag API response (verified by route test) | By design |

### Operator checklist (cannot be verified from the repo)

- [ ] Rotate the OpenAI key that lived in `.env.example` before scrubbing (it was in plaintext locally; never entered git history)
- [ ] Confirm prod `AUTH_LINK_SECRET` is the 64-hex format the validators expect
- [ ] Enable MFA on: PostHog org, Railway, GitHub, Apple Developer
- [ ] PostHog project permissions: least-privilege — flag editing only for admins
- [ ] Railway vars audit — confirm the 7 secret-class vars are set via Variables, not committed config
- [ ] Git history scan (`git log -p .env.example` or gitleaks) to confirm the scrubbed key never committed

### Architecture notes for the flag system

- `GET /config/features` emits **booleans only** — no targeting rules, cohorts, or PostHog internals (enforced by `clientConfig` + route test asserting no `phc_/posthog` strings leak).
- `POSTHOG_API_KEY` is read only by `posthog-node` in `provider.js` — single module, lazy-init.
- Flags are never a secrets channel — registry stores booleans/metadata only.
- Infisical deferred per plan; Railway Variables are the secrets store for beta.
