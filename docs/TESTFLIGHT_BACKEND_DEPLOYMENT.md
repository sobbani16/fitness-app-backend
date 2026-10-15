# Backend required by TestFlight 1.0.0 (5)

The deployed legacy commit da84fab has no /auth/login or /auth/register. This release brings the existing local authenticated backend, lifecycle/ownership changes and supporting migrations into source control. It includes existing local nutrition work; weekly plans remain hidden in the beta mobile configuration and are not production-approved.

Validation: 240 backend tests and 37 disposable PostgreSQL integration tests passed October 15, 2026. These tests did not modify production data.

Railway build generates Prisma Client. Pre-deploy validates authentication settings before applying additive migrations and idempotent RBAC seed. No reset, dummy user seed or legacy account transfer runs. Missing configuration blocks deployment before database changes. Existing device-ID data requires the reviewed migration flow; arbitrary device IDs no longer authenticate.

Required service variables: DATABASE_URL, AUTH_PUBLIC_URL (the HTTPS API origin), AUTH_LINK_SECRET (random 32-byte hex), RESEND_API_KEY and AUTH_EMAIL_FROM (verified Resend sender). Set secrets through Railway; never commit them. Confirm email delivery after deployment. A health response alone is not acceptance: test registration, inbox verification, login, profile, export and deletion.

Rollout status and live results are tracked in fitness-app-mobile/docs/TESTFLIGHT_RELEASE.md and PRODUCTION_HANDOFF.md. Public App Store release remains deferred.
