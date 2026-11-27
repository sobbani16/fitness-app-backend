# Weather / Environment → Recommendation Logic Inventory

_Audit for pc-HUM-8 (DEV-04). Read-only survey of how weather/environmental
data reaches recommendation and safety logic. No behavior changed._

## 1. Overview — data flow

Two coexisting weather systems feed recommendations:

**A. Legacy "condition bucket" path (v1)**
```
mobile useWeather → GET /weather?lat&lon (routes/weather.js)
  → weatherService.fetchWeather (Open-Meteo current temp/precip/weather_code)
  → condition ∈ {hot | rainy | pleasant}
        ├─ mobile weatherContext.ts renders advisory text locally
        ├─ GET /recommendations?weather=hot|rainy|pleasant (routes/recommendations.js)
        │    → recommendationEngine.applyWeather — flips workout location outdoor↔indoor
        └─ POST /summary {weather} (routes/summary.js)
             → summaryService.buildInsight — narration only
```

**B. Weather Intelligence v2 + Activity Safety Engine (current authority)**
```
GET /weather/environment?lat&lon (routes/weather.js, flag weather_intelligence_v2)
  → environmentService.fetchEnvironment — normalized observation:
      tempC, apparentTempC, humidityPct, precipitationMm, weatherCode,
      windSpeedKmh/GustsKmh, isDay, uvIndex, aqi{value,source},
      alerts[] (NWS us / IMD CAP india), forecast[12h], *Available honesty flags

GET /activity-safety/recommendation?lat&lon (flag health_aware_recommendations)
POST /activity-safety/evaluate {activityId,lat,lon} (flag activity_safety_engine)
  → envFor() resolves env (fixture seam in non-prod → fetchEnvironment → markStale)
  → safety.recommend / evaluate → engine.evaluateActivity
      └─ environmental dimension: activitySafety/environment.js
         detectHazards(obs, profileFlags) → ENV_HAZARDS → per-hazard decision
         merged with medical/functional dimensions by DECISION_RANK
```

Invariants throughout path B: missing/stale/unavailable env data yields
`INSUFFICIENT_DATA` (never "safe"); indoor activities skip env gating
(`status: not_applicable`); only `outdoor_exposed` catalog entries are gated.

## 2. Module inventory

### Weather data ingestion / API clients
| File | Responsibility |
|---|---|
| `src/services/weatherService.js` | Open-Meteo current-conditions client → `{tempC, precipitation, weatherCode, condition, description}`; `geocodeCity` for manual city search. `setFetch` DI seam for tests. |
| `src/services/environmentService.js` | Normalized observation (v2): Open-Meteo forecast + air-quality APIs, NWS alerts (US box), IMD CAP via WIS2 (India box, polygon-verified), CPCB measured AQI (India, `DATA_GOV_IN_API_KEY` optional). `markStale` (>90 min → stale). Gov CA bundle for `*.imd.gov.in` TLS. |
| `certs/sectigo-public-server-auth-ca-dv-r36.pem` | Augmented CA for IMD WIS2 endpoint. |
| `src/services/activitySafety/envFixtureStore.js` | In-memory per-user env fixtures — staging only, synthetic-domain users only, enabled by `SAFETY_STATE_FIXTURE`/`SAFETY_ENV_FIXTURE` (routes/activitySafety.js `envFor`, routes/safetyFixtures.js). |

### Weather/environment models
| File | Responsibility |
|---|---|
| `prisma/schema.prisma` → `EnvironmentalObservation` | Persisted normalized snapshot (`payload` json, `qualityStatus`, `expiresAt`). **Defined but never written/read in src/** — observations are fetched live per request; only `ActivitySafetyEvaluation.environmentObsId` could link to one. |
| `src/services/activitySafety/constants.js` → `ENV_HAZARDS`, `WET_CODES`, `THUNDER_CODES` | Hazard vocabulary (15 keys) + WMO weather-code groups. |

### Recommendation engines consuming weather
| File | Responsibility |
|---|---|
| `src/services/activitySafety/environment.js` | `evaluateEnvironment` — hazard detection + per-hazard decision + `findBetterTime` (first forecast hour where blocking hazards clear). |
| `src/services/activitySafety/engine.js` | `evaluateActivity` merges environmental dimension with medical/functional; injects `ctx.envHazards` + `env_unknown`/`env_stale` flags for rule matching. |
| `src/services/activitySafety/index.js` | `recommend()` — ranks candidate catalog; `betterTime` surfaced on suggestions. |
| `src/services/recommendationEngine.js` | Legacy `applyWeather` — `hot`/`rainy` → `location:'indoor'`; `pleasant` → upgrades `either` workout to `outdoor`. Only sees the 3-bucket condition, not hazards. |
| `src/services/summaryService.js` | Narrates `weather.condition` in insight text (honesty flag `weatherAdjusted`). |

### Safety / eligibility rules referencing environment
| File | Responsibility |
|---|---|
| `src/services/activitySafety/rulesData.js` | Seed ActivitySafetyRule rows — ~12 env-conditional rules (respiratory×AQI/cold, metabolic heat-sensitivity, pregnancy+heat, MS+heat, fall-risk×precip/wind, age 65+ heat, and generic AS-ENV-001..007 thunderstorm/severe-alert/heat/AQI/cold/UV/precip + `workout_planned`×any-hazard annotate). |
| `src/services/activitySafety/gate.js` | `safetyGate(prisma, userId, {env})` — push-level gate used by producers. **All current callers pass no env** (see §5). |
| `src/services/activitySafety/recommendationSafety.js` | Stale-advice invalidation + send-time `activityAdviceAllowed` re-gate (no env input). |
| `src/routes/activitySafety.js` | `/recommendation`, `/evaluate` endpoints; `envFor` env resolution incl. fixture seam. |

## 3. Weather condition types & thresholds

### Condition buckets (v1, weatherService.js)
`rainy` = precip >0 or wet WMO code (51–67, 71–77, 80–82, 85–86, 95–99) · `hot` = tempC ≥ 28 · else `pleasant`.

### Hazard keys (ENV_HAZARDS) and detection bands (environment.js)
| Hazard | Trigger | Outdoor decision |
|---|---|---|
| `thunderstorm` | WMO 95–99 or alert text thunder/lightning | DEFER_OUTDOOR |
| `severe_alert` | alert text matches warning/emergency/extreme/tornado/hurricane/flood/blizzard/ice | DEFER_OUTDOOR |
| `heat_danger` | apparent ≥ 40.5 °C | DEFER_OUTDOOR |
| `heat_sensitive_danger` | apparent ≥ 35 °C + heat-sensitive flags (pregnancy, ms, diabetes, obesity, heart_failure, cad, age_65+, med heat_sensitivity) | DEFER_OUTDOOR |
| `heat_extreme_caution` | apparent ≥ 32 °C | MODIFY |
| `heat_caution` | apparent ≥ 28 °C + heat-sensitive flags | MODIFY |
| `cold_danger` | apparent ≤ −18 °C | DEFER_OUTDOOR |
| `cold_caution` | apparent ≤ −7 °C + (wind ≥20/gust ≥30 km/h or precip) or cold-sensitive flags (cad, hypertension, asthma) | MODIFY |
| `aqi_hazardous` | US AQI ≥ 201 | DEFER_OUTDOOR |
| `aqi_unhealthy` | US AQI ≥ 151 | DEFER_OUTDOOR |
| `aqi_usg` | US AQI ≥ 101 + sensitive flags (respiratory/cardiac/pregnancy/diabetes/65+) | MODIFY |
| `uv_extreme` / `uv_very_high` | uvIndex ≥ 8 / ≥ 6 | MODIFY |
| `high_wind` | gusts ≥ 50 km/h | MODIFY |
| `heavy_precip` | precip ≥ 5 mm or WMO 96–99 | MODIFY |

`ENV_HAZARDS` also defines `aqi_very_unhealthy` and rulesData references `smoke`
(AS-RESP-002) — **neither is ever produced by `detectHazards`**; rules
mentioning them only fire via the adjacent hazard keys.

### Feature flags
`weather_intelligence_v2` (GET /weather/environment), `activity_safety_engine`
(/activity-safety/*), `health_aware_recommendations` (/recommendation),
`activity_safety_shadow_mode` (shadow eval persistence).

### Duplication / inconsistencies
- **Three parallel weather vocabularies**: 3-bucket `condition` (v1), 15-key `ENV_HAZARDS` (v2 engine), mobile `weatherContext.ts` thresholds (VERY_HOT_C=32 °C, freezing ≤0 °C). Mobile text logic is duplicated client-side rather than consuming engine output.
- `28 °C` means "hot" in v1 but only `heat_caution` (and only for sensitive profiles) in v2.
- `EnvironmentalObservation` Prisma model is unused — no persistence layer for env snapshots.
- `findBetterTime` duplicates hazard thresholds inline rather than reusing `detectHazards` — future band changes could drift.

## 4. Existing tests & fixtures

| File | Coverage |
|---|---|
| `tests/activitySafety.envMatrix.test.js` | End-to-end env matrix via `environmentService.setFetch`: clear→ALLOW, 42 °C→DEFER, −18 °C→DEFER, AQI 210→DEFER, thunder code→DEFER, outage→INSUFFICIENT_DATA, stale→INSUFFICIENT_DATA, conflicting (nice temp + thunder)→DEFER, recovery after outage. |
| `tests/environmentService.test.js` | Normalization, staleness, provider-failure semantics, alert coverage flags. |
| `tests/weatherService.test.js` | Condition bucketing + geocode. |
| `tests/activitySafety.engine.test.js` / `.scenarioMatrix.test.js` (15k lines) | Rule matching incl. envHazards × conditions × categories. |
| `tests/activitySafety.e2e.test.js` / `.routes.test.js` | Route-level recommendation & fixture seam. |
| `tests/recommendationEngine.test.js` / `summaryService.test.js` | v1 `applyWeather` location flipping + narration. |
| Mobile: `src/hooks/__tests__/useWeather.test.js`, `src/services/__tests__/weatherContext.test.ts` | Client advisory text rules. |

Run: `npx jest tests/<file>.test.js --runInBand`.

## 5. Open questions / gaps

1. **`safetyGate` is invoked without env by every producer** — personalPlans, chat, formChecks, sleepRecovery, trainerCopilot, weeklyHealthReview, progressCoach all call `safetyGate(prisma, userId)` with `env=null`. Inside the engine that becomes INSUFFICIENT_DATA on all `outdoor_exposed` candidates (rank > MODIFY → excluded from eligible and counted as blocked). Effect: gate consumers can only surface indoor candidates and never see real hazards — weather is honored only on `/activity-safety/*` paths that pass lat/lon. Intentional or an integration gap?
2. **Two recommendation engines exist** — legacy `recommendationEngine.applyWeather` (3 buckets, location flip, no safety context) still powers `/recommendations` + `/summary`, parallel to the v2 safety pipeline. Clients could see contradictory guidance (v1 says "pleasant → take it outside" while v2 would defer for AQI).
3. **No env persistence** — `EnvironmentalObservation` model unused; evaluations record `environmentObsId` but nothing writes it, so post-hoc comparison can't reconstruct what env produced a decision.
4. **`todayActions` health-priorities engine ignores environment entirely** — no env rules despite being the flagship "next action" surface.
5. `uvIndex` uses nearest forecast hour (no current UV on free tier) — documented, but worth noting in comparisons.
6. Hazard→decision mapping is single-hop; no hysteresis — borderline values (e.g., apparentTemp 40.4 vs 40.6) flip decisions across the boundary by design.
7. Mobile advisory (`weatherContext.ts`) duplicates thresholds with different semantics and is unaware of profile sensitivity — display-only, but could contradict engine output on the same screen.

## 6. Mobile survey (brief)

- `src/api/weather.ts` — `getWeather` (v1 bucket) + `geocodeCity`.
- `src/api/activitySafety.ts` — `/activity-safety/recommendation` & `/evaluate` pass `lat,lon` (v2 path consumed by app).
- `src/hooks/useWeather.ts` + `src/storage/weather.ts` — location resolution (GPS/saved city), cached observation.
- `src/services/weatherContext.ts` — **client-side duplicated rules**: rest-day suppress, ≤0 °C freezing, wet, ≥32 °C very-hot; advisory text only.
- `src/components/today/OptionalDetails.tsx` (`WeatherDetail`) + `DashboardScreen.tsx` — renders weather line + suggestion on Today.
- `src/api/recommendations.ts`, `api/summary.ts` — accept/pass `weather` param to v1 endpoints.
