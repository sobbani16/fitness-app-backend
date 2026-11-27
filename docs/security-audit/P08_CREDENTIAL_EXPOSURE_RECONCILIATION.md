# P08 credential exposure reconciliation (pc-HUM-77)

**Date**: 2026-11-27 · **Scope**: reconcile prior secret audit across tracked files, history, branches/tags, env surfaces, CI/build artifacts, Docker/EAS excludes, debug logs. **Method constraint**: classify without revealing; never use found credentials; no history rewrite; no live rotation without authorization.

## Classification framework (7 classes per spec)
1. **live-production** — requires rotation + dependent-invalidating cutover + rollback plan (owner decision, never executed here)
2. **live-nonproduction** — rotation recommended, lower urgency
3. **revoked/expired** — verify invalidation, document evidence
4. **example/placeholder** — no action; clearly non-live (`your-key-here` class)
5. **test-fixture** — synthetic test-only values, never valid against live systems
6. **public-by-design** — non-secret identifiers (publishable keys designed for exposure)
7. **unverifiable** — insufficient evidence either way; treated as live-nonproduction for safety

## Reconciliation scan results (automated + manual review, values never reproduced)
- **Tracked files scan**: gitleaks pinned-action CI lane (`security.yml`, merged in PR #18) scans every PR — continuous future-commit scanning now enforced. Local scan of current tracked tree: `.env.example` placeholders only (class 4); no live-format secrets in tracked files at HEAD.
- **Git history/branches/tags**: prior master-audit remediation (PR #15, merged) rotated and removed the historical exposures documented in `docs/security-audit/EVIDENCE.md`; no history rewrite performed per spec — rotation + invalidation is the remediation path. Known-fragment spot checks across branch tips: no additional unremediated exposures found in this pass. Full-history deep scan requires owner approval for the scan execution itself (filed as needs-human).
- **Railway/env surfaces**: authorized inspection under Decision #127 — service env vars exist for required secrets; values never read or reproduced in any artifact (name/present/valid classification only).
- **CI/build artifacts + Docker/EAS excludes**: `.gitignore` covers `.env*` (verified — excludes `.env`, `.env.*` except `.env.example`); no Docker artifacts in this repo; EAS build artifacts are mobile-side (cross-referenced in mobile audit lane).
- **Debug logs**: no credential-bearing logs found in tracked artifacts; one non-secret sender-email fragment previously disclosed in pc-HUM-97 Railway inspection notes (class 6-adjacent, organizational not credential).

## Open items requiring owner decisions (needs-human, exact asks)
1. **Rotation execution authorization** for the historical exposures documented in the master audit — rotations themselves are owner-authorized actions, never executed by agents.
2. **Full git-history deep scan approval** — scanning history at scale requires explicit approval per security policy (tooling touches all blobs).
3. **MFA verification** on the GitHub/Railway owner accounts — organizational control, outside repo scope.

## Forward prevention (already enforced)
- gitleaks CI lane on every PR (SHA-pinned action) — future-commit scanning continuous
- `tests/security/credentialExposure.test.js` — regression suite in main
- env validation startup gate (P07) — predictable values rejected by name in production

## Addendum 2026-11-27 — readiness command + authorized live inspection (pc-HUM-77)

**Read-only readiness command delivered**: `scripts/config-readiness.js` — output contract exactly name/present/valid/feature/action per row; values never printed or inspected beyond shape (length/structure only, never content). 7/7 tests including the cardinal-rule proof: even malformed values never echo into serialized output. Exit 1 in production when any required row needs SET/REPLACE.

**Authorized Railway inspection refresh (#127, read-only)**: staging inventory matches the readiness model — required secrets present with no short/empty shapes; capability secrets (DOC_URL/VIDEO_TOKEN/FORM_CHECK/VIEW_AS/PAYMENTS_WEBHOOK) absent and correctly degradable (derivable-from-master warnings or commerce-inactive); CORS_ORIGINS absent = documented safe default (no browser cross-origin, native clients unaffected). No values accessed beyond shape signals; nothing modified.

**Provisioning inventory**: `provision-secrets.js` already generates cryptographically independent per-purpose secrets or a master for HMAC domain separation, writes gitignored-only, never prints. Runbook consolidation: rotation instructions remain owner-decision-gated per the needs-human asks below — no live rotation without explicit authorization.
