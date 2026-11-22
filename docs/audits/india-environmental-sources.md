# India Environmental Sources — Investigation & Integration Verdicts

**Phase 15 P3** · verified 2026-11-22 · every verdict below was checked against the live endpoint, not assumed.

## Verdict table

| Source | What it provides | Access / licensing | Verdict |
|---|---|---|---|
| **IMD CAP alerts via WMO WIS2** (`wis2box.imd.gov.in/oapi`) | Live CAP 1.2 alerts: event, severity, urgency, certainty, effective/onset/expires, headline, `areaDesc`, NDMA polygon URL | WIS2 "core" data policy — openly published by IMD; no key required | ✅ **INTEGRATED** (live-verified Delhi → `alertsCoverage: 'imd-cap'`) |
| **IMD API platform** (`api.imd.gov.in`) | City forecast, current wx, district nowcast (Cat1–12) | Official note: organizations must contact the IMD nodal officer for terms/authorization — not keyless | ⏸ Documented; not integrated (requires organizational approval + district-level, not point) |
| **CPCB real-time AQI via data.gov.in** (resource `3b01bcb8…`) | Per-station pollutant concentrations (PM2.5/PM10/NO2/SO2/CO/O3/NH3) with lat/lon + last_update | Govt Open Data License — India; **requires a registered api-key** (`DATA_GOV_IN_API_KEY`) | ✅ **Integrated behind key** — measured station AQI (PM2.5 → US-EPA map) overrides modeled when configured; `unconfigured` when absent |
| **Open-Meteo CAMS AQI** | Modeled US-AQI covering India | Free non-commercial use | ✅ already serving — labeled `open-meteo-cams-modeled` (modeled ≠ measured, never blurred) |
| NDMA SACHET polygon endpoint | `cap:polygon` geography for each alert | Same govt publication as the alerts it backs | ✅ integrated — used solely for point-in-polygon scope verification |

## Geographic-scope honesty (hard requirement)

- A CAP alert only applies to a coordinate when its **NDMA polygon resolves and contains the point** — ray-cast test, cached per alert.
- `areaDesc` (district/state text) is **never** treated as point coverage. Alerts without verifiable polygons are counted in `alertsUnscopedCount`, not silently dropped nor silently applied.
- Effect window: `expires` honored; missing expiry is capped at 72 h from publication (CAP semantics, not inference). Future `effective/onset` alerts are not yet active.
- Boundary behavior tested: same feed, point inside vs outside the polygon → alert applied only inside.

## Field semantics (kept separate per requirement)

- `weatherAvailable` — Open-Meteo forecast actually served.
- `aqiAvailable` — a real AQI value exists (measured CPCB or modeled CAMS).
- `aqiMeasuredCoverage` — `'ok' | 'unconfigured' | 'no-station-in-range' | 'unavailable'` for India.
- `alertsAvailable` / `alertsCoverage` — `'imd-cap' | 'nws-us' | 'unsupported' | 'unavailable'`; outage never claims "no alerts".

## TLS note

`wis2box.imd.gov.in` serves its leaf certificate without the intermediate chain — Node's CA store cannot verify it (curl resolves via AIA). Fix: `certs/sectigo-public-server-auth-ca-dv-r36.pem` (the public Sectigo intermediate, fetched from the issuer URL embedded in the leaf's AIA extension) is bundled and **appended** to the root store for gov.in hosts only — no verification is disabled anywhere.

## Test coverage (18 tests, all green)

Delhi poor AQI · Mumbai heavy rain · Chennai cyclone CAP + polygon · Hyderabad extreme heat · Bengaluru normal · rural monitoring gaps (AQ outage + unconfigured CPCB) · IMD feed outage → `unavailable` · expired CAP filtered · boundary crossing · areaDesc-only unscoped · CPCB key-configured measured override · CPCB station >50 km fallback.

## Remaining human actions

1. **Register a data.gov.in key** and set `DATA_GOV_IN_API_KEY` in staging/prod to activate measured CPCB station AQI (otherwise `unconfigured` — modeled CAMS still serves, labeled).
2. **Optional**: request organizational access to `api.imd.gov.in` for district-nowcast/city-forecast augmentation — WIS2 CAP already covers severe-weather alerts, so this is coverage refinement, not a blocker.
3. Review polygon-cache eviction policy if alert volume grows (currently unbounded LRU-less Map — bounded by the ≤10 active-alert candidate window).
