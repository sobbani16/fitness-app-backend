# Deployment identity record — 2026-11-26T23:35Z (pc-HUM-53 workstream N)

Captured under Decision #127 authority. Inspection only — zero mutations.
Method: Railway deployment metadata cross-checked against app-reported
`/health/version` — the card's key acceptance ("HTTP 200 ≠ intended commit")
verified through the app itself, not the platform's claim.

## Cross-verified identity matrix

| service / env | Railway meta commit | app-reported commit | match | service state |
|---|---|---|---|---|
| fitness-app-backend / staging | `df9e09d66a03` (DEPLOYING 23:31:14Z) | `aecddee8a8de` | in-transition — see note 1 | serving prior build |
| fitness-app-backend / production | `df9e09d66a03` (BUILDING 23:31:14Z) | n/a — probed staging domain only | — | build in flight |
| activity-safety-staging / staging | `1c45d1d19829` (SUCCESS 17:36:11Z) | `1c45d1d19829` | **EXACT** | serving verified commit |
| activity-safety-staging / production | `1c45d1d19829` | — | — | **CRASHED since 17:37:55Z** — see note 2 |

## Notes

1. **In-flight deploy observed**: merge of PR #36 (`df9e09d`, current
   origin/main HEAD) triggered auto-deploys to both environments at 23:31:14Z
   during inspection. The staging service's app-reported `aecddee8a8de` is the
   previously-running build — proving exactly why commit-specific metadata
   matters: platform metadata and serving reality diverge during transitions,
   and only the app-reported value is ground truth for what is serving.
   merge→prod auto-deploy re-confirmed live.
2. **CRASHED duplicate service — report only, no action taken**: a service
   named `activity-safety-staging` exists in the PRODUCTION environment and
   has been CRASHED since 17:37:55Z (~2 minutes after its deploy). Unknown
   whether intentional-abandoned or a real failure. Recorded for founder
   decision — no restart/delete/investigation beyond metadata per §4.2
   discipline. Exact ask in PR.
3. **`builtAt` is null everywhere** — `BUILD_TIMESTAMP` is not injected in
   either environment. Recorded as an identity-completeness gap.
4. **Environment misclassification fixed on this branch**: `version.js`
   previously classified by NODE_ENV alone — 'production' in both Railway
   environments, making them indistinguishable through the app. Now prefers
   `RAILWAY_ENVIRONMENT_NAME` (closed enum). After the next deploy of this
   change, the identity matrix becomes fully self-describing.
5. Contract surface at capture time: `contract: 2`, `minClientContract: 1`
   on both probed services — mobile compatibility window intact.

## Verification commands (reproducible)
```
railway deployment list --service <svc> --environment <env> --json   # platform meta
curl -s <service-url>/health/version                                 # app ground truth
git merge-base --is-ancestor <commit> origin/main                    # ancestry
```
