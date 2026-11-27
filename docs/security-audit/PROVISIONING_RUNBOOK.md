# Provisioning Runbook — Humai backend secrets (pc-HUM-77, verified 2026-11-27)

Operator procedure for provisioning, verifying, rotating, and incident-handling
backend secrets. Every executable claim here was verified against the actual
scripts this session. Never-values discipline applies throughout: secret values
are never printed, logged, or committed — including in this document.

Companion documents (referenced, not duplicated):
- `P07_ACCEPTANCE_TRACEABILITY.md` — validation design + test pins
- `P08_CREDENTIAL_EXPOSURE_RECONCILIATION.md` — 7-class exposure framework
- `P08_CROSS_REPO_RECONCILIATION.md` — per-repo preventive posture

## 1. Initial provisioning of a new environment

Order: generate → place → verify → smoke.

```
node scripts/provision-secrets.js            # writes .env.generated (mode 0600)
```

VERIFIED BEHAVIOR: generates 6 independent 32-byte hex secrets
(AUTH_LINK_SECRET, DOC_URL_SECRET, VIDEO_TOKEN_SECRET, FORM_CHECK_URL_SECRET,
VIEW_AS_SECRET, PAYMENTS_WEBHOOK_SECRET), writes with mode 0600, prints only
the file path and purpose NAMES — values never echoed (verified this session:
stdout contains zero hex material). The file carries a DO-NOT-COMMIT header.

Placement: paste values into the secret manager (Railway Variables for server
envs). Then DELETE `.env.generated` — it is a transfer artifact, not storage.
The file is gitignored (`.env.generated` in .gitignore) so it cannot be
committed accidentally; delete it anyway.

Non-generated requirements the script does not cover (set manually):
DATABASE_URL, RESEND_API_KEY, OPENAI_API_KEY (if AI enabled), CORS_ORIGINS
(optional — absent is the safe default, see P07 traceability row c).

## 2. Generation modes — honest tradeoff

**Independent-per-purpose (default)**: 6 unrelated secrets. Rotation granularity:
rotate one purpose without touching others. Operational cost: 6 variables to manage.

**HMAC-master (alternative)**: set only HUMAI_SIGNING_MASTER (or rely on
AUTH_LINK_SECRET as master); `requiredSecret` derives per-purpose keys via
HMAC-SHA256(master, "humai:<purpose>") — cryptographically independent despite
one root (domain separation pinned in tests/securityHardening.test.js).
SHARP EDGE: the script does NOT generate a master value — the master line in
.env.generated is a comment placeholder. Operators choosing master mode must
generate 64 hex chars themselves (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
— printed locally, never in shared logs). Rotation cost: rotating the master
rotates EVERY derived purpose simultaneously — all signed URLs/tokens invalidate
at once. Choose independent mode when granular rotation matters.

## 3. Verification loop

```
node scripts/config-readiness.js
```

VERIFIED BEHAVIOR (this session): read-only, emits `name | present | valid |
feature | action` rows only, exit 0 in non-production even with everything
absent. Interpretation:

| action class | meaning | operator response |
|---|---|---|
| SET — startup blocked without it | required var absent/invalid | provision before deploy; production boot will refuse (exit 1, verified in bootChain tests) |
| REPLACE-type | present but predictable/malformed | regenerate; predictable values are rejected as if missing in production |
| optional — feature inactive | capability absent | informational only — disabled commerce/docs/video never break fitness (pinned) |

Exit codes: 1 in production when any required row needs action; 0 otherwise.
Values never appear in output — including deliberately malformed ones (pinned
by configReadiness tests).

## 4. Railway variable-setting procedure

1. Confirm authorization window — variable changes restart the service.
2. Set variables in Railway dashboard/CLI. Never paste values into shared
   channels, issue trackers, or PR text.
3. Verify KEYS-ONLY afterward: list variable names, never values (the
   2026-11-26 live inventory inspection used exactly this discipline).
4. Post-change smoke: `/health` responds; check logs for `[config]` warnings —
   capability warnings are informational, missing-required is fatal by design.

## 5. Rotation procedure — REQUIRES OWNER AUTHORIZATION before execution

Authorization is not yet granted (needs-human register, P08 doc). When granted:

1. Generate replacement(s) with provision-secrets (independent mode) or a new
   master (master mode — remember it invalidates all purposes at once).
2. Stage: set the new value in the target environment; service restarts.
3. Cutover verification: dependent flows still work (auth links sign/verify,
   signed URLs validate). Old-value dependents invalidate immediately —
   in-flight signed URLs/doc links die at restart; communicate timing.
4. Invalidate the old value at the provider/issuer where applicable
   (RESEND_API_KEY/OPENAI_API_KEY are provider-side revocations; signing
   secrets invalidate simply by replacement).
5. Verify with config-readiness; confirm no service is still running the old
   value (single-service topology makes this trivial; multi-service would need
   per-service confirmation).
6. Rollback: restore the prior value IF it was not exposure-driven. NEVER roll
   back to a suspected-exposed secret — rollback of an exposure rotation means
   accepting the exposure, escalate instead.

## 6. Incident response — suspected exposure, first hour

1. Classify per the 7-class framework (P08 doc) WITHOUT reproducing the value.
2. Live-production (class 1): treat as rotation-authorized-emergency — escalate
   to owner immediately; do not wait for the standing authorization if the
   exposure is active-public. Document every action taken.
3. Snapshot evidence before changing anything: where exposed, since when
   (commit/member/channel), who has seen it.
4. Execute rotation per §5 with dependent-invalidation; verify; then remove
   the exposure reference (no history rewrite — the P08 constraint).
5. Cross-check the other repos' posture (P08 cross-repo addendum) — an
   exposure path in one repo often exists in siblings.

## 7. Common failure modes (all verified behaviors)

| symptom | cause | resolution |
|---|---|---|
| boot exits 1 naming variables | required config missing in production | provision per §1 — validation correctly precedes serving (bootChain-pinned) |
| "predictable value" rejection | dev-flavored value set in production | generate real entropy per §1; predictable == missing by design |
| derivation failure at module load | no dedicated secret AND no master in production | set the dedicated var or a master — fail-closed is intentional |
| AUTH_TEST_BYPASS active in "production" | NODE_ENV=test misconfiguration | impossible post-hardening: Railway-aware isProduction() vetoes bypass even when NODE_ENV=test (bootChain-pinned) |
| tests seed wrong database | seed scripts read DATABASE_URL not TEST_DATABASE_URL | export DATABASE_URL explicitly for the seed chain (the pc-HUM-38 trap — bit twice) |
| validation reports on a var nothing consumes | FIXED 2026-11-27: SECRET_RULES named orphan FORM_CHECK_SECRET; canonical consumer name FORM_CHECK_URL_SECRET restored | — |

## Sharp edges honestly documented

- provision-secrets.js does not generate the master value (comment placeholder only).
- `--check` verifies no env files tracked but only for the repo it's run in —
  sibling repos need their own checks (see cross-repo addendum for their posture).
- config-readiness cannot validate VALUE correctness, only shape — a wrong-but-
  well-formed secret passes shape validation. Provider-side verification (a live
  signing round-trip) is the only full proof; not automated.
