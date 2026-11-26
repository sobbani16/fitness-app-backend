# Admin Application Authentication — Phase 2 Report

## Previous state (confirmed finding)

`fitness-app-admin` sent `x-user-id: <localStorage 'admin_user_id'>` as its only
credential — against the real backend every request 401s (no Bearer token) and
any typed-in user id was trusted by nothing. The app was non-functional AND its
identity model was spoofable-by-design.

## Implemented (branch `security/master-audit`, commits 2efbe73 + deps)

- **Login**: `src/pages/Login.tsx` → `POST /auth/login` (backend: scrypt verify,
  per-email 10/15min + per-IP 30/15min limits, 32B session token, 30d expiry).
- **Session**: `src/auth/session.ts` — `{token, expiresAt, user}` persisted,
  expiry-checked on every read; cleared on 401 via `humai:session-expired`.
- **Transport**: `src/api.ts` — `Authorization: Bearer <token>`; **`x-user-id`
  explicitly deleted** from every request (the backend would overwrite it, but
  never send a spoofable header).
- **Authorization**: `AuthContext` loads `GET /me/roles`; `RequireAuth` gate
  requires a live session AND an admin permission
  (`MANAGE_*|VIEW_AUDIT_LOGS|VIEW_PLATFORM_ANALYTICS|SUPER_ADMIN_PANEL` — same
  predicate as the web app's `lib/roles.ts`). Accounts without admin perms are
  logged straight out. Backend re-enforces per request — the client gate is UX.
- **Logout**: `POST /auth/logout` (server-side session row deleted) + local clear.
- **Session expiry/revocation**: 401 → `clearSession()` + redirect `/login`.
  Revoked admin role → next privileged API call 403s server-side (role
  permissions are looked up live per request in `requirePermission`).

## Backend authorization (re-verified)

Every admin route carries `requirePermission(...)`: MANAGE_USERS, MANAGE_ROLES,
MANAGE_TRAINERS, VIEW_PLATFORM_ANALYTICS, ACADEMY_CLINICAL_REVIEW,
MANAGE_FEATURE_FLAGS, VIEW_AUDIT_LOGS, SUPER_ADMIN_PANEL. Role grants come from
`UserRole`/`RolePermission` — a member/trainer cannot reach them; role
revocation stops privileged calls immediately (live lookup, no cache).
Admin provisioning: `scripts/provision-admin.js` requires an existing
password-authenticated, email-verified account — no public "create admin" path.

## Deploy prerequisites

- `CORS_ORIGINS` on the backend must include the admin origin (currently unset —
  all browser origins blocked). Bearer auth needs no `credentials` flag and no
  CSRF layer (token is never ambient).
- Admin accounts must be email-verified (`requireVerifiedEmail` precedes
  `/admin/*`) — the provision script enforces this.

## MFA note

No MFA exists in the backend today. For SUPER_ADMIN accounts before public
launch: either (a) deploy MFA via the auth service (TOTP — new table +
endpoints, ~1 sprint) or (b) accept the documented risk — admin surface is
small (allowlist `CORS_ORIGINS`, VPN/IP allowlist at the edge for the admin
origin is the cheap compensating control). **Recorded as a manual-action item.**

## Tests

`tests/authorization.memberAB.test.js` covers member↔member; admin-permission
enforcement is covered by existing route tests (admin.test.js etc. — every
requirePermission path exercises 401/403). E2E roles matrix (anonymous/member/
trainer/nutritionist/admin/super-admin/expired/revoked) is scripted in
`tests/e2e`-style via the memberAB suite + `securityHardening`; a browser-level
admin E2E needs a deployed backend — recorded in BLOCKERS.
