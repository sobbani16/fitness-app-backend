# Findings — Humai Fitness Master Security Audit

Status legend: FIXED / OPEN / ACCEPTED-RISK. Evidence in EVIDENCE.md, fixes in REMEDIATION_LOG.md.

## Confirmed & fixed on security/master-audit-remediation

| ID | Sev | Area | Finding | Status |
|----|-----|------|---------|--------|
| SEC-F-001 | HIGH | Payments | Mock payment provider + `mock-secret` webhook fallback reachable in production — forgeable entitlement grants | FIXED |
| SEC-F-002 | HIGH | Payments | `payment.succeeded` not bound to purchase amount/currency; refund unbounded; purchase not bound to creating provider | FIXED |
| SEC-F-003 | MED | Payments | Public webhook route mounted before global IP limiter — unrate-limited signature-verification endpoint | FIXED |
| SEC-F-004 | HIGH | Capability tokens | `DOC_URL_SECRET`/`VIDEO_TOKEN_SECRET`/`FORM_CHECK_URL_SECRET`/`VIEW_AS_SECRET` dev-fallbacks usable in production | FIXED |
| SEC-F-005 | LOW | View-as | `timingSafeEqual` on unequal buffers → 500 on malformed signature | FIXED |
| SEC-F-006 | MED | Identity | `req.body.userId` accepted as identity fallback in personalPlans/menuAnalysis/exerciseController | FIXED |

## Open — tracked, needs dedicated work or release gating

| ID | Sev | Area | Finding | Status |
|----|-----|------|---------|--------|
| SEC-F-007 | MED | Secrets | `.env` git-tracked in mobile + admin (public URLs only, no creds — history check done) | FIXED on security branches; needs merge |
| SEC-F-008 | MED | Deps | backend 4 high vulns (prisma/effect, swagger-jsdoc chain) — needs prisma@7 major | OPEN — dedicated dep PR |
| SEC-F-009 | MED | Deps | mobile image-size high; web playwright/postcss/zod<4.6.6 high | OPEN — dedicated dep PR |
| SEC-F-010 | HIGH | Admin app | `fitness-app-admin` sends raw `x-user-id`, no session token — incompatible w/ backend auth; effectively non-functional → confirm decommission or wire sessions | OPEN — product decision |
| SEC-F-011 | MED | Payments | Only `mock` provider exists — real provider (Stripe) must be configured before launch; `PAYMENTS_WEBHOOK_SECRET` now required in prod | OPEN — launch config |
| SEC-F-012 | LOW | Audit trail | Prior audit left HF-0001/0016 criticals (allergy filter, calorie floor) — re-verify on this branch scope | OPEN — carry into launch checklist |

## Cleared (assessed, no issue)

- SEC-014 SQLi: all raw SQL parameterized via Prisma tagged templates.
- AuthN lifecycle: scrypt, 32B sessions, hashed tokens, atomic reset, session invalidation, enumeration-resistant.
- AuthZ: admin uniformly `requirePermission`; ownership checks across health/plans/docs/conversations.
- Uploads: magic-byte validation, private storage, short-lived signed URLs.
- AI: `store:false`, bounded tokens, quotas, feature-gated, structured JSON, server re-validation.
