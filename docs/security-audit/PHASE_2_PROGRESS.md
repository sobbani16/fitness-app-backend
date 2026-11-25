# Phase 2 Progress

## Completed
- [x] State restored + all Phase-1 claims re-verified (commits present, test counts re-run)
- [x] Disabled-commerce fail-closed: signed webhook cannot entitle while flag off (`commerce_disabled`), +test
- [x] lib/env: domain-separated HMAC derivation (HUMAI_SIGNING_MASTER/AUTH_LINK_SECRET → per-purpose keys), predictable-value rejection in prod, environmentName/isStaging helpers
- [x] validateConfig(): feature-conditional secret rules — disabled features warn, enabled missing secrets fail fast in prod (names only)
- [x] scripts/provision-secrets.js: gitignored 0600 output, never echoes values, --check verifies no tracked env
- [x] ENVIRONMENT_VARIABLE_REGISTRY.md (all 4 repos + Railway checklist)
- [x] Admin app auth: bearer session + /me/roles permission gate + logout + 401 handling; x-user-id removed entirely (commits 2efbe73)
- [x] Dependencies: backend overrides (deepmerge-ts/effect/minimatch — prisma 7 rejected, still pins vulnerable effect); web zod4+next15.5.29+postcss+playwright+vitest4 → **0 vulns**; admin axios/vite/audit-fix → **0 vulns**; mobile minimatch override (image-size risk-accepted, build-time only, metro breaks on v2)
- [x] scripts/audit-gate.js + known-advisories.json allowlist; CI behavioral job runs securityHardening.test.js
- [x] Member A/B suite: tests/authorization.memberAB.test.js — **68 tests**, no authz holes
- [x] Web dashboard Promise.all misalignment fixed (real data bug; 25 pre-existing TS errors → 0); next build green
- [x] origin/main merged into backend security branch — clean; combined candidate re-tested
- [x] Mobile: 673/673 tests, typecheck; .easignore covers .env
- [x] Docs: DEPENDENCY_REMEDIATION, SECRET_ROTATION_RUNBOOK, PAYMENT_DISABLED_VERIFICATION, PAYMENT_PROVIDER_PROPOSAL, ADMIN_AUTHENTICATION_REPORT, AUTHORIZATION_COVERAGE_REPORT (28-category matrix), RELEASE_CANDIDATE_REPORT, PRODUCTION_RELEASE_RUNBOOK
- [x] Backend full regression on final candidate: 6072+ pass; 1 transient DB flake (isolated reruns green)

## In flight
- [ ] Independent second-pass review (subagent running)

## Remaining manual actions (see FINAL_SECURITY_SIGNOFF)
- PR creation (gh absent — descriptions ready in RELEASE_CANDIDATE_REPORT)
- Railway secret provisioning + CORS_ORIGINS
- Branch protection rules
- HF-0016 clinical decision; admin MFA decision
- EAS/mobile artifact + device validation
- Credential rotation (local .env keys)
