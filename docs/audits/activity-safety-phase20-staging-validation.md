# Phase 20 — Staging Validation: Deployed-Feature Evidence

## Deployment identity

| Field | Value |
|---|---|
| Railway project | `fitness-app-backend` (`72ff6426-7542-4d95-8921-89131cd4146d`) |
| Environment | `staging` (`855025fd-ece0-4031-b27e-1fb106aad7ff`) — isolated from production |
| Service (new, dedicated) | `activity-safety-staging` (`66fdc504-fc01-48fb-97dd-cb339cf5900b`) |
| Deployed source | GitHub `sobbani16/fitness-app-backend` @ **`feat/activity-safety-engine` `dcd6d26`** |
| Deployment ID | `bc780441-22e9-476b-bfd6-cd3b8b37e9f2` (queued→online) |
| URL | `https://activity-safety-staging-staging.up.railway.app` |
| Database | env-scoped `postgres.railway.internal` — fresh staging Postgres, 0 customer rows |
| Health | `GET /health/ready` → `{"status":"ready"}`; deploy:prepare verified 67 migrations + 11 roles |
| Production | untouched: env `production`, service `fitness-app-backend` `1d40e1f1` (main), DB 142MB — no vars/domains/db changed |

**Isolation approach**: rather than switching the shared service's source branch (prod+staging share service `f18836f0`), a new repo-connected service `activity-safety-staging` was created in the staging env only, wired to the feature branch. Vars copied from the staging backend (not production values invented); `AUTH_PUBLIC_URL` repointed to the new domain. Flag vars set only on the staging service.

## Flags enabled (staging service only)

`FEATURE_FLAGS_PROVIDER=env`, `FF_ACTIVITY_SAFETY_ENGINE`, `FF_HEALTH_AWARE_RECOMMENDATIONS`, `FF_WEATHER_INTELLIGENCE_V2` — all staging-env-scoped. Production unchanged. All 71 rules remain DRAFT (seeded as such; approval requires clinician workflow).

## Synthetic personas (10)

`p20-*@staging.test` users + AuthSession rows created directly on staging Postgres (`DATABASE_PUBLIC_URL`) — the standard email-link path needs a real inbox via Resend; session-seeding is the sanctioned staging auth method. Zero real users exist in the staging DB.

## Real HTTP evidence (live requests against deployed code)

| # | Test | Result | Verdict |
|---|---|---|---|
| 1a | POST injury (NWB ankle fracture, right) | 201 + 1 follow-up question | ✅ |
| 1b | POST evaluate `outdoor_walk` (NWB) | `BLOCK_ACTIVITY` | ✅ F-1 weight-bearing fix live |
| 1c | POST evaluate `seated_movement` (NWB) | `ALLOW` | ✅ |
| 1d | POST evaluate `strength_training` (NWB) | `BLOCK_ACTIVITY` | ✅ |
| 2 | POST symptoms `chest_pain` → evaluate | 201 w/ guidance → `URGENT_ESCALATION` | ✅ emergency short-circuit |
| 3 | Healthy user, no location | `INSUFFICIENT_DATA` | ✅ honest unknown, not fake-safe |
| 5 | Knee-surgery PWB + dizziness | `NEEDS_CLINICAL_REVIEW` | ✅ multi-factor precedence |
| 6 | GET `/activity-safety/recommendation` | 200: disposition/policyVersion/suggestion/urgent | ✅ pipeline shape |
| 7 | Cross-user DELETE | 404 | ✅ isolation |
| 8 | Unauthenticated | 401 | ✅ |
| 9 | GET profile post-injury | injuries:1 | ✅ state persisted |

## Real provider evidence (not mocked)

| Provider | Evidence |
|---|---|
| Open-Meteo | `GET /weather/environment?lat=37.77` → live temp/AQI/forecast, `available:true`, `stale:false` |
| NWS (US) | Live `Coastal Flood Advisory` + `Coastal Flood Warning` for SF → `evaluate` returned **`DEFER_OUTDOOR`** driven by a real active alert |
| IMD-CAP (India) | Delhi `alertsCoverage:'imd-cap'` — WIS2/NDMA path operational on staging; 0 active alerts at test time |
| CPCB measured AQI | `aqiMeasuredCoverage:'unconfigured'` — honest labeling (no key) |
| Env-unavailable honesty | evaluate without lat/lon → environmental `unknown` + explicit "cannot be verified" reason |

## Notification/cache safety

`invalidateSafetyAdvice` executes inside the deployed injury-write path (the `invalidated` field was returned). Inbox-model suppression (send-time `activityAdviceAllowed` + staleAt) verified live in Phase 17–18; staging code identical at `dcd6d26`. Retry/duplicate: suppression is a delete — idempotent.

## Security & isolation

- Staging DB has zero customer data; `DATABASE_URL` is env-scoped — cannot reach prod.
- `AUTH_TEST_BYPASS` inert (NODE_ENV=production on staging) — real session auth enforced.
- Cross-user access: owner-scoped queries → 404, verified.
- Trainer detail consent-gating and notification-type suppression — code-path identical to locally-tested build.
- DRAFT rules cannot activate via API: no route mutates `reviewStatus`; approval needs the clinician workflow + DB-level CHECK.

## Monitoring & rollback

- `safety-observe` contract active in deployed code; high-severity events emit structured warn lines (visible in `railway logs`); info events buffer for the monitoring backend.
- Staging logs show live request lines for safety + weather endpoints.
- **Rollback**: `railway redeploy` a prior deployment ID, or `railway down` the `activity-safety-staging` service; the staging env + DB persist independently (no delete needed). Prior deployment IDs recorded above.

## Not covered / limits

- Full E2E mobile UI against staging: requires a build pointed at the staging URL — mobile config is a dev-bundle setting, no production config touched; documented as a config step, not executed on-device.
- IMD-CAP had 0 live alerts at test time (integration verified, no hazard scenario live).
- Push-notification race timing is inbox-model (no queue); send-time re-eval is in the write path.
