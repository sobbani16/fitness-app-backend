# Production Release Runbook — Security Candidate

Branches: backend `security/master-audit-remediation`, mobile `security/master-audit`,
web `security/master-audit`, admin `security/master-audit`. Deploy order matters:
**backend first** (clients depend on its auth contract), then web + admin, mobile last.

## 0. Pre-deployment checks (manual)

- [ ] PRs reviewed + merged (URLs in RELEASE_CANDIDATE_REPORT — create via GitHub UI; `gh` unavailable locally)
- [ ] Branch protection on `main`: require `security` + `test` workflows green, require review
- [ ] `npx prisma migrate status` — confirm no pending drift vs manifest (deploymentReadiness checks it at boot)
- [ ] DB backup snapshot taken

## 1. Secret provisioning (Railway — manual)

Run `node scripts/provision-secrets.js` → paste `.env.generated` into Railway Variables → delete file.

Minimum prod set (registry: ENVIRONMENT_VARIABLE_REGISTRY.md):
```
DATABASE_URL          (existing)
AUTH_LINK_SECRET      64-hex
AUTH_PUBLIC_URL       https://<prod backend origin>
RESEND_API_KEY + AUTH_EMAIL_FROM
CORS_ORIGINS          https://<web origin>,https://<admin origin>
NODE_ENV=production
```
Capability secrets — either per-purpose (`DOC_URL_SECRET`, `VIDEO_TOKEN_SECRET`,
`FORM_CHECK_URL_SECRET`, `VIEW_AS_SECRET`) or one `HUMAI_SIGNING_MASTER`
(HMAC domain-separation derives the rest). Commerce stays dark:
leave `PAYMENTS_PROVIDER` unset; `PAYMENTS_WEBHOOK_SECRET` only when a real provider lands.

## 2. Backend deploy

- Deploy branch → watch boot log: `validateConfig` throws listing missing VAR NAMES only if the minimum set is incomplete; `[config]` warnings for disabled features are expected and safe.
- Smoke: `GET /health` 200; login flow on a test account; `GET /me/roles`; signed-document URL round-trip.
- `assertDeploymentReady` verifies migration manifest + RBAC catalog at boot — a failed boot means migration drift; do NOT `migrate dev`; follow ROLLBACK_PLAN.

## 3. Web deploy

- Env: `BACKEND_URL`/API origin, `APP_URL` own origin. Session cookie becomes `Secure` automatically (NODE_ENV=production).
- Smoke: login → dashboard renders (the misalignment fix makes real data visible — sanity check a known account); BFF CSRF headers present on mutation (verify 403 without `x-requested-with`).

## 4. Admin deploy

- Requires `CORS_ORIGINS` including the admin origin (else every call fails preflight — expected, not a bug).
- Smoke: login with an email-verified ADMIN account (provision via `scripts/provision-admin.js` if none); confirm member account is refused ("no administrative access").
- Verify `/admin/analytics`, `/admin/users`, `/audit-logs` load; sign-out → confirm re-entry requires login.

## 5. Mobile release

- `EXPO_PUBLIC_API_URL` → prod backend. EAS build → store submission.
- Smoke: fresh login, meal log, health-score screen, supplement schedule. Commerce screens must NOT appear (flag off).
- Blocker: no EAS build performed in this pass (credentials/device) — see BLOCKERS.

## 6. Post-deploy verification

- gitleaks + audit-gate green on the merge commit.
- 24h watch: 401/403 rates per surface, webhook 4xx rate (should be ~0 — no provider configured), auth email delivery.
- Verify `/webhooks/payments/mock` 400s on unsigned bodies (public route still rate-limited + signature-gated — probe with an EMPTY/invalid body only; no attack simulation).

## 7. Rollback

Per-repo `git revert` of the security merge commit; backend revert order: web/admin clients keep working (they only added auth usage of existing endpoints). Secrets: keep newly provisioned vars — old code ignores unknown vars. If the domain-separated `requiredSecret` causes an unexpected capability failure, set the specific `*_SECRET` var rather than reverting. Full detail: ROLLBACK_PLAN.md.

## 8. Incident response

- Credential compromise → SECRET_ROTATION_RUNBOOK (§Emergency): rotate; AUTH_LINK_SECRET rotation kills all sessions (intended); PAYMENTS_WEBHOOK_SECRET unset freezes webhooks while rotating.
- Authz incident → feature-flag off the affected surface (`FF_*` env override) while patching; data exposure → preserve audit logs, assess scope via `AuditLog`.
