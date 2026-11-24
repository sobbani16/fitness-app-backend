# Humai Security Audit Workspace

Persistent state for the master security audit. If this session was interrupted,
read `EXECUTION_STATE.json` first and resume from `next_exact_action`.

- `EXECUTION_STATE.json` — machine-readable checkpoint (phase, SHAs, findings, tests)
- `PROGRESS.md` — chronological log
- `FINDINGS.md` — finding table + clean categories
- `ROUTE_INVENTORY.md` — generated inventory of all Express routes/middleware
- `REMEDIATION_LOG.md` — per-fix changes, commits, verification
- `REGRESSION_RESULTS.md` — test outcomes
- `FINAL_REPORT.md` — Phase 8 report + release readiness

Safety rules in effect: no production DB/API access, no real emails/payments,
synthetic data only, no destructive git operations, no secret values in these files.
