# Release Candidate Report — Phase 2

## Candidate

| Repo | Branch | Head | PR |
|------|--------|------|----|
| backend | `security/master-audit-remediation` | merge commit (includes origin/main) | prepare → `main` (PR body below) |
| mobile | `security/master-audit` | 8010c36 | prepare → `main` |
| web | `security/master-audit` | 246c53c | prepare → `main` |
| admin | `security/master-audit` | 2ecafe5 | prepare → `main` |

## What changed since Phase 1 NO-GO

| Launch blocker | Was | Now | Evidence |
|---|---|---|---|
| Prod secrets unprovisioned / predictable fallbacks | BLOCKER | RESOLVED in code — provisioning is a manual step | lib/env domain separation + predictable-value rejection; provision-secrets.js; registry |
| Mock payment provider usable in prod | BLOCKER | RESOLVED | getProvider prod-gate incl. RAILWAY_ENVIRONMENT_NAME; signed webhook can't entitle while flag off |
| Missing payment creds could break app | risk | RESOLVED | feature-conditional validateConfig; webhook secret throws lazily |
| Dependency advisories | 4 high backend, high web/mobile | RESOLVED except image-size (risk-accepted, build-time) | DEPENDENCY_REMEDIATION.md; npm audit 0 on web/admin; backend gate 0 unexpected |
| Admin app unauthenticated | BLOCKER | RESOLVED | real bearer session + admin-permission gate + logout; requires CORS_ORIGINS at deploy |
| Authorization revalidation | pending | RESOLVED | 68 Member A/B tests — no holes |
| CI gates | added | VERIFIED + hardened | audit-gate mechanism + behavioral test job |
| Calorie safety floor (HF-0016) | open | DOCUMENTED GATE | policy module exists; deliberately unwired pending clinical sign-off — NOT a code defect; product decision |
| EAS/device artifact validation | — | BLOCKED | no EAS creds/device in this environment |

## Regression status (this candidate, post-merge)

- backend: 6072+68 tests pass; 1 transient flake (`socket hang up`, asyncScenarios.api — passes 3/3 in isolation, DB pool pressure under full suite); suites 156/157+2 skipped
- mobile: 673/673, typecheck clean
- web: `next build` green; 0 TS errors (dashboard misalignment fixed); vitest configured
- admin: `vite build` green; typecheck clean

## Cross-repo compatibility

- Admin/web call `POST /auth/login`, `GET /me/roles`, `POST /auth/logout` — all exist on this backend branch (and main). No client/backend version skew.
- `CORS_ORIGINS` must include web+admin origins at deploy — new requirement introduced by using the browser admin app against the API.
- No DB migrations in this release — zero schema risk.

## PR descriptions (create via GitHub UI — gh CLI absent)

**backend PR** `security/master-audit-remediation → main`: "Security remediation: fail-closed payments (provider binding, amount/currency match, disabled-commerce webhook gate), domain-separated capability secrets with predictable-value rejection, disabled-feature-conditional config validation, identity-spoofing removal, dep overrides clearing high advisories, CI security gate (gitleaks+audit-gate+behavioral), 78 new security tests + 68 authz tests."
**mobile PR**: "Untrack committed .env (public URL only) + minimatch override clearing DoS advisories. 673/673 tests."
**web PR**: "Resolve all dependency advisories (zod4, next 15.5.29, postcss, playwright, vitest4) + fix dashboard Promise.all misalignment (functional data bug). Build+typecheck green."
**admin PR**: "Real session auth replacing spoofable x-user-id + dep advisories resolved + .env untracked. Requires backend CORS_ORIGINS to include the admin origin."

## State classification

- Code complete: **YES**
- Tests complete: **YES** (backend/mobile/web/admin; e2e browser-level flows blocked — needs live env)
- Release candidate ready: **YES**
- Production configuration ready: **NO** — secrets + CORS_ORIGINS provisioning is manual (runbook §1)
- Production deployment verified: **NO** — not deployed
- Public launch ready: **NO** — pending prod provisioning + PR merge + HF-0016 clinical decision + admin MFA decision + EAS validation
