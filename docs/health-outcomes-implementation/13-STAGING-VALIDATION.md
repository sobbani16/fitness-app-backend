# 13 — Staging Validation

**Status:** BLOCKED — no staging environment credentials/access exist for this project

## Completed at dev scope (what staging would verify)
- Migration validated on disposable `fitness_auth_readiness` DB + `fitness_test` (apply + resolve, non-destructive)
- Idempotent SQL (safe re-apply); rollback path documented (doc 02)
- All features disabled by default — a deploy changes nothing observable until flags enable

## Required when staging exists
1. Apply migration to staging DB; verify `migrate status`
2. Synthetic users → exercise `/me/health-conditions`, `/me/medications`, `/me/clinical-measurements`, `/me/health-conditions/plan`
3. Cross-user authorization spot-checks; deletion round-trip on a synthetic account
4. Enable flags one at a time; verify fail-closed behavior on flag-off
5. Record deployed SHAs + findings here
