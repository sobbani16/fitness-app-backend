# Environment Variable Registry

Classification: **PRIVATE** = credential/secret (never commit), **PUBLIC** = non-sensitive config,
**INTERNAL** = server-side non-secret config. Values are never recorded here.

## Backend (fitness-app-backend)

| Variable | Consumer | Req | Class | Feature dep | Prod requirement | Rotation |
|----------|----------|-----|-------|-------------|------------------|----------|
| `DATABASE_URL` | prisma | yes | PRIVATE | all | Postgres TLS URL | on leak/dbpw change |
| `AUTH_LINK_SECRET` | authLifecycle, env master fallback | yes | PRIVATE | auth sessions, email links | 64-hex random (32B); also serves as signing master | on suspicion; 90d policy |
| `HUMAI_SIGNING_MASTER` | lib/env domain-separation | opt | PRIVATE | capability tokens | 64-hex; alternative to per-purpose vars | with AUTH_LINK_SECRET |
| `AUTH_PUBLIC_URL` | authLifecycle | yes | INTERNAL | email links | https origin (localhost http dev-only) | n/a |
| `RESEND_API_KEY` | authEmail | yes | PRIVATE | transactional email | live resend key | on leak |
| `AUTH_EMAIL_FROM` | authEmail | yes | INTERNAL | email sender | verified sender domain | n/a |
| `PAYMENTS_WEBHOOK_SECRET` | payments/provider | cond | PRIVATE | paid commerce | required iff `PAYMENTS_PROVIDER` != mock | on leak; per-provider |
| `PAYMENTS_PROVIDER` | payments/provider | opt | INTERNAL | commerce | unset/`mock` → commerce effectively dark | n/a |
| `DOC_URL_SECRET` | communication | cond | PRIVATE | document signed URLs | 64-hex or master-derived | on leak |
| `VIDEO_TOKEN_SECRET` | communication | cond | PRIVATE | video signed URLs | 64-hex or master-derived | on leak |
| `FORM_CHECK_URL_SECRET` | formChecks | cond | PRIVATE | form-check video URLs | 64-hex or master-derived | on leak |
| `VIEW_AS_SECRET` | viewAsService | cond | PRIVATE | super-admin view-as | 64-hex or master-derived | on leak |
| `OPENAI_API_KEY` | aiProvider | cond | PRIVATE | AI_ENABLED=true | required iff AI on | on leak |
| `OPENAI_MODEL` | aiProvider | opt | INTERNAL | AI | pinned model id | n/a |
| `AI_ENABLED` | aiProvider | opt | INTERNAL | AI kill-switch | `true` to enable | n/a |
| `AI_EMERGENCY_SHUTDOWN` | featureFlags | opt | INTERNAL | AI kill-switch | `true` halts all AI | n/a |
| `AI_USER_DAILY_CALL_CAP` / `AI_USER_DAILY_TOKEN_CAP` | aiProvider | opt | INTERNAL | AI quotas | sane defaults exist | n/a |
| `CHAT_DAILY_LIMIT`, `FOOD_AI_*` | quotas | opt | INTERNAL | AI quotas | defaults ok | n/a |
| `LIVEKIT_URL/API_KEY/API_SECRET` | communication | cond | PRIVATE | live sessions | required iff video calls enabled | on leak |
| `CORS_ORIGINS` | app | yes(prod) | INTERNAL | browser clients | CSV allowlist incl. admin+web origins | n/a |
| `SPOONACULAR_API_KEY`, `USDA_API_KEY`, `YOUTUBE_API_KEY`, `DATA_GOV_IN_API_KEY` | food/catalog | cond | PRIVATE | respective integrations | required iff feature used | on leak |
| `POSTHOG_API_KEY`/`POSTHOG_HOST` | telemetry | opt | PRIVATE | analytics | optional | on leak |
| `API_IP_RATE_LIMIT`,`API_RATE_LIMIT`,`MESSAGE_RATE_LIMIT`,`WEBHOOK_RATE_LIMIT` | limiters | opt | INTERNAL | abuse control | defaults 600/…/…/120 | n/a |
| `TRUST_PROXY_HOPS` | app | opt | INTERNAL | rate-limit correctness | set per deploy topology | n/a |
| `ENABLE_API_DOCS` | swagger | opt | INTERNAL | docs | `false`/unset in prod | n/a |
| `AUTH_TEST_BYPASS` | authenticate | **never prod** | INTERNAL | tests | must be unset in prod (startup guard throws) | n/a |
| `NODE_ENV`/`RAILWAY_ENVIRONMENT_NAME` | env detection | yes | INTERNAL | prod detection | railway sets env name; prod detected via name | n/a |
| `PORT` | index | opt | INTERNAL | http | railway-assigned | n/a |
| `DOCUMENT_STORAGE_DIR`,`DOCUMENT_MAX_BYTES`,`DOC_SCAN_CMD`,`DOC_SCAN_REQUIRED` | document uploads | opt | INTERNAL/PRIVATE | uploads | scan cmd prod-recommended | n/a |
| `FORM_CHECK_MAX_BYTES` | uploads | opt | INTERNAL | uploads | default | n/a |
| `FEATURE_FLAGS_PROVIDER` + `FF_*` | featureFlags | opt | INTERNAL | flags | provider + per-flag overrides | n/a |
| `SEED_TRAINER_PASSWORD`, `QA_*`, `FOOD_SMOKE_*`, `SMOKE_*`, `POSE_DIAGNOSTIC_TESTER_IDS`, `SAFETY_*_FIXTURE`, `SCENARIO_REVIEWER` | scripts/QA | dev-only | PRIVATE(test) | QA tooling | never in prod | rotate if reused |
| `ENTITLEMENT_MODE` | commerce | opt | INTERNAL | commerce | default | n/a |

## Mobile (fitness-app-mobile)

| Variable | Consumer | Req | Class | Notes |
|----------|----------|-----|-------|-------|
| `EXPO_PUBLIC_API_URL` | api client | yes | PUBLIC | backend base URL — public by design (EXPO_PUBLIC_* bundles plaintext) |

## Web (fitness-app-web)

| Variable | Consumer | Req | Class | Notes |
|----------|----------|-----|-------|-------|
| `BACKEND_URL`/`API_URL` | BFF proxy route | yes | INTERNAL server-side | never NEXT_PUBLIC-expose a secret |
| `APP_URL` | BFF CSRF origin check | yes | PUBLIC | own origin |
| `NODE_ENV` | cookie secure flag | yes | INTERNAL | prod → `Secure` cookies |

## Admin (fitness-app-admin)

| Variable | Consumer | Req | Class | Notes |
|----------|----------|-----|-------|-------|
| `VITE_API_URL` | api client | yes | PUBLIC | backend base URL (bundled plaintext) |

## Railway provisioning checklist

1. `railway variables set` (or dashboard) per var above; mark PRIVATE as secret.
2. Generate secrets: `node scripts/provision-secrets.js` → paste `.env.generated` → delete file.
3. Minimum prod set: `DATABASE_URL`, `AUTH_LINK_SECRET`, `AUTH_PUBLIC_URL`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `CORS_ORIGINS`.
4. Commerce stays dark: leave `PAYMENTS_PROVIDER` unset; `PAYMENTS_WEBHOOK_SECRET` only needed when a real provider is configured.
5. `CORS_ORIGINS` must include the deployed web + admin origins.
6. Verify startup: `validateConfig()` logs warnings for disabled-feature secrets and fails fast listing only missing var names.
7. After provisioning: deploy → check `/health` → confirm no `[config]` warnings for enabled features.
