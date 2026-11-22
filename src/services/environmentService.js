// Environmental observation service (weather intelligence v2).
// Fetches a normalized observation the safety engine consumes:
//   feels-like, humidity, wind/gusts, UV, precip probability + 12h forecast
//   from Open-Meteo, and US AQI from Open-Meteo's air-quality API.
// Open-Meteo has no government alert feed — `alertsAvailable` is honestly
// false so the engine never implies "no alerts" from an absent field.
// No API key and no user health data is sent to providers; only lat/lon.

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
// NWS alert feed — authoritative US government source (api.weather.gov).
// Coverage: US states + territories only; the point query rejects
// out-of-service-area coordinates, which maps cleanly to honest coverage.
const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active';
// Coarse US-ish bounding box — skips the call entirely for clearly
// unsupported regions; points inside the box but outside the service
// area are caught by the provider's 4xx.
const NWS_BOX = { latMin: 14, latMax: 72, lonMin: -180, lonMax: -60 };
// India bounding box — severe-weather coverage via IMD CAP alerts published
// on the WMO WIS2 node (wis2box.imd.gov.in, 'core' data policy = open).
// IMD's own API platform requires organizational authorization; WIS2 does not.
const IN_BOX = { latMin: 6, latMax: 38, lonMin: 66, lonMax: 98 };
const WIS2_MESSAGES_URL = 'https://wis2box.imd.gov.in/oapi/collections/messages/items';
const CAP_METADATA_ID = 'urn:wmo:md:in-imd:cap_alerts';
// CPCB real-time station data via data.gov.in — Govt Open Data License India;
// requires a registered api-key (DATA_GOV_IN_API_KEY). Absent key → measured
// coverage stays 'unconfigured'; modeled AQI still serves with attribution.
const CPCB_RESOURCE_URL = 'https://api.data.gov.in/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69';
const CPCB_MAX_STATION_KM = 50;
const STALE_AFTER_MS = 90 * 60 * 1000; // >90 min old → unusable for decisions

let _fetch = globalThis.fetch;
function setFetch(fn) { _fetch = fn; }
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const valid = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

// wis2box.imd.gov.in serves its leaf cert without intermediates; Node's CA
// store lacks the public Sectigo DV R36 intermediate (curl AIA-resolves it).
// Augment — never replace — the store for *.imd.gov.in / *.ndma.gov.in only.
const fs = require('fs'), https = require('https'), tls = require('tls'), path = require('path');
const GOV_EXTRA_CA = fs.readFileSync(path.join(__dirname, '../../certs/sectigo-public-server-auth-ca-dv-r36.pem'), 'utf8');
const GOV_CA = [...tls.rootCertificates, GOV_EXTRA_CA];
function govFetch(url, redirects = 1) {
  return new Promise((resolve, reject) => {
    const u = url.startsWith('http://') ? 'https://' + url.slice(7) : url;
    https.get(u, { ca: GOV_CA, timeout: 5000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume(); return govFetch(res.headers.location, redirects - 1).then(resolve, reject);
      }
      let body = ''; res.on('data', c => body += c);
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => JSON.parse(body), text: async () => body }));
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('gov fetch timeout')); });
  });
}
const govFetchFn = () => (_fetch === globalThis.fetch ? govFetch : _fetch); // tests keep the _fetch seam

async function fetchJson(url, { headers } = {}) {
  const res = await _fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  if (!res.ok) { const e = new Error(`provider fetch failed: ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

// Fetch NWS active alerts for a point. Returns:
//   { status:'ok', alerts:[...] }          provider answered — coverage real
//   { status:'unsupported', alerts:[] }    provider rejects out-of-area points
//   { status:'unavailable', alerts:[] }    outage/timeout — alerts unknown
async function fetchNwsAlerts(lat, lon, now = new Date()) {
  const inBox = lat >= NWS_BOX.latMin && lat <= NWS_BOX.latMax && lon >= NWS_BOX.lonMin && lon <= NWS_BOX.lonMax;
  if (!inBox) return { status: 'unsupported', alerts: [] };
  try {
    const data = await fetchJson(`${NWS_ALERTS_URL}?${new URLSearchParams({ point: `${lat},${lon}` })}`,
      { headers: { 'User-Agent': 'humai-fitness-app (activity-safety; contact: dev@humai.app)', Accept: 'application/geo+json' } });
    const t = now.getTime();
    const alerts = (Array.isArray(data?.features) ? data.features : [])
      .map(f => f?.properties || {})
      .filter(p => p.event)
      .filter(p => !p.expires || new Date(p.expires).getTime() > t)
      .map(p => ({ event: String(p.event), severity: String(p.severity || 'Unknown'), effective: p.effective || null, expires: p.expires || null }));
    return { status: 'ok', alerts };
  } catch (err) {
    return { status: err.status && err.status >= 400 && err.status < 500 ? 'unsupported' : 'unavailable', alerts: [] };
  }
}

// --- CAP (Common Alerting Protocol) helpers -----------------------------------

const capTag = (xml, tag) => {
  const m = xml.match(new RegExp(`<cap:${tag}>([^<]*)</cap:${tag}>`));
  return m ? m[1].trim() : null;
};
const capParam = (xml, name) => {
  const m = xml.match(new RegExp(`<cap:parameter>\\s*<cap:valueName>${name}</cap:valueName>\\s*<cap:value>([^<]*)</cap:value>\\s*</cap:parameter>`));
  return m ? m[1].trim() : null;
};
// CAP polygon = whitespace-separated 'lat,lon' pairs. Ray-cast point test.
function pointInPolygon(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]; const [yj, xj] = poly[j];
    if (((yi > lat) !== (yj > lat)) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const parsePolygonText = (txt) => (txt || '').trim().split(/\s+/)
  .map(p => p.split(',').map(Number)).filter(pair => pair.length === 2 && pair.every(Number.isFinite));

const polygonCache = new Map(); // identifier → parsed polygon points
async function fetchPolygon(url) {
  if (polygonCache.has(url)) return polygonCache.get(url);
  const res = await govFetchFn()(url);
  if (!res.ok) throw new Error(`polygon fetch failed: ${res.status}`);
  const xml = await res.text();
  const m = xml.match(/<cap:polygon>([^<]+)<\/cap:polygon>/);
  const poly = m ? parsePolygonText(m[1]) : [];
  polygonCache.set(url, poly);
  return poly;
}

// Fetch IMD CAP alerts for a point via the WMO WIS2 node.
// Geographic honesty: an alert only covers the point when its NDMA polygon
// resolves and contains it — areaDesc (district/state text) never becomes a
// point claim; unverifiable geography is reported as unscoped, not matched.
async function fetchIndiaCapAlerts(lat, lon, now = new Date()) {
  const inBox = lat >= IN_BOX.latMin && lat <= IN_BOX.latMax && lon >= IN_BOX.lonMin && lon <= IN_BOX.lonMax;
  if (!inBox) return { status: 'unsupported', alerts: [] };
  try {
    const res = await govFetchFn()(`${WIS2_MESSAGES_URL}?${new URLSearchParams({ metadata_id: CAP_METADATA_ID, limit: '100', f: 'json' })}`);
    if (!res.ok) { const e = new Error(`wis2 fetch failed: ${res.status}`); e.status = res.status; throw e; }
    const data = await res.json();
    const t = now.getTime();
    const t72h = t - 72 * 3600 * 1000;
    const candidates = (Array.isArray(data?.features) ? data.features : [])
      .map(f => { try { return { props: f.properties || {}, xml: Buffer.from(f.properties?.content?.value || '', 'base64').toString('utf8') }; } catch { return null; } })
      .filter(x => x && x.props.metadata_id === CAP_METADATA_ID && x.xml.includes('<cap:alert'))
      .map(x => ({
        identifier: capTag(x.xml, 'identifier'),
        event: capTag(x.xml, 'event'),
        severity: capTag(x.xml, 'severity') || 'Unknown',
        urgency: capTag(x.xml, 'urgency'),
        certainty: capTag(x.xml, 'certainty'),
        effective: capTag(x.xml, 'effective'),
        onset: capTag(x.xml, 'onset'),
        expires: capTag(x.xml, 'expires'),
        headline: capTag(x.xml, 'headline'),
        instruction: capTag(x.xml, 'instruction'),
        areaDesc: capTag(x.xml, 'areaDesc'),
        polygonUrl: capParam(x.xml, 'Polygon URL'),
        pubtime: x.props.pubtime,
      }))
      .filter(a => a.event)
      .filter(a => { // effective-window honesty
        if (a.expires && new Date(a.expires).getTime() <= t) return false;
        const start = a.effective || a.onset;
        if (start && new Date(start).getTime() > t) return false;
        if (!a.expires) { // no expiry → cap at 72h from publication
          const pub = a.pubtime ? new Date(a.pubtime).getTime() : t;
          if (pub < t72h) return false;
        }
        return true;
      })
      .slice(0, 10);

    const alerts = []; let unscoped = 0;
    for (const a of candidates) {
      const { polygonUrl, ...rest } = a;
      if (!polygonUrl) { unscoped += 1; continue; }
      let poly = null;
      try { poly = await fetchPolygon(polygonUrl); } catch { poly = null; }
      if (!poly || poly.length < 3 || !pointInPolygon(lat, lon, poly)) { unscoped += 1; continue; }
      alerts.push({ ...rest, scope: 'polygon-verified' });
    }
    return { status: 'ok', alerts, unscopedCount: unscoped };
  } catch {
    return { status: 'unavailable', alerts: [] };
  }
}

// CPCB measured AQI (nearest station within 50 km) — GODL-licensed, key-gated.
// Concentrations are mapped to US-EPA AQI breakpoints so hazard bands stay
// comparable; the source is always labeled so modeled vs measured never blur.
function pm25ToUsAqi(c) {
  const bp = [[0, 12, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150], [55.5, 150.4, 151, 200], [150.5, 250.4, 201, 300], [250.5, 350.4, 301, 400], [350.5, 500.4, 401, 500]];
  for (const [lo, hi, aLo, aHi] of bp) if (c >= lo && c <= hi) return Math.round(((aHi - aLo) / (hi - lo)) * (c - lo) + aLo);
  return c > 500.4 ? 500 : null;
}
const km = (a, b, c, d) => { const R = 6371, rad = x => x * Math.PI / 180; const h = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

async function fetchCpcbAqi(lat, lon) {
  const key = process.env.DATA_GOV_IN_API_KEY;
  if (!key) return { status: 'unconfigured' };
  try {
    const data = await fetchJson(`${CPCB_RESOURCE_URL}?${new URLSearchParams({ 'api-key': key, format: 'json', limit: '200', 'filters[pollutant_id]': 'PM2.5' })}`);
    const rows = (Array.isArray(data?.records) ? data.records : [])
      .map(r => ({ city: r.city, station: r.station, lat: num(r.latitude), lon: num(r.longitude), avg: num(r.avg_value), updated: r.last_update }))
      .filter(r => r.lat != null && r.avg != null);
    let best = null;
    for (const r of rows) { const d = km(lat, lon, r.lat, r.lon); if (!best || d < best.km) best = { ...r, km: d }; }
    if (!best || best.km > CPCB_MAX_STATION_KM) return { status: 'no-station-in-range' };
    const value = pm25ToUsAqi(best.avg);
    return { status: 'ok', aqi: { value, source: 'cpcb-station-pm25-us-epa-equivalent', station: best.station, city: best.city, stationKm: Math.round(best.km * 10) / 10, measuredAt: best.updated } };
  } catch { return { status: 'unavailable' }; }
}

/**
 * fetchEnvironment(lat, lon) → normalized observation.
 * Never fabricates: missing measurements stay null with `available`/`*Available`
 * flags so downstream evaluation treats unknown ≠ safe. Weather availability,
 * AQI availability and severe-weather alert coverage are separate fields —
 * an outage in one never masquerades as "clear" in another.
 */
async function fetchEnvironment(lat, lon) {
  lat = num(lat); lon = num(lon);
  if (!valid(lat, lon)) throw new Error('lat and lon must be valid coordinates');
  const now = new Date();

  const fcParams = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: 'auto',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,is_day',
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,weather_code,uv_index',
    forecast_hours: '12',
  });
  const inIndia = lat >= IN_BOX.latMin && lat <= IN_BOX.latMax && lon >= IN_BOX.lonMin && lon <= IN_BOX.lonMax;
  const [fc, aq, alerts, cpcb] = await Promise.all([
    fetchJson(`${FORECAST_URL}?${fcParams}`),
    fetchJson(`${AQ_URL}?${new URLSearchParams({ latitude: lat, longitude: lon, current: 'us_aqi' })}`)
      .catch(() => null), // AQI outage never blocks weather
    (inIndia ? fetchIndiaCapAlerts(lat, lon, now) : fetchNwsAlerts(lat, lon, now)), // alert outage never blocks weather
    inIndia ? fetchCpcbAqi(lat, lon) : Promise.resolve({ status: 'unsupported' }),
  ]);

  const cur = fc && fc.current ? fc.current : {};
  const forecast = [];
  const H = fc && fc.hourly ? fc.hourly : {};
  const times = Array.isArray(H.time) ? H.time : [];
  for (let i = 0; i < times.length && forecast.length < 12; i += 1) {
    if (new Date(times[i]) <= now) continue; // only future hours
    forecast.push({
      time: times[i],
      tempC: num(H.temperature_2m?.[i]),
      apparentTempC: num(H.apparent_temperature?.[i]),
      precipitationProbabilityPct: num(H.precipitation_probability?.[i]),
      weatherCode: num(H.weather_code?.[i]),
      uvIndex: num(H.uv_index?.[i]),
    });
  }

  const obs = {
    provider: 'open-meteo', units: { temp: 'celsius', aqi: 'us_aqi' },
    available: true, weatherAvailable: true, stale: false,
    lat, lon, observedAt: cur.time || now.toISOString(), fetchedAt: now.toISOString(),
    tempC: num(cur.temperature_2m),
    apparentTempC: num(cur.apparent_temperature),
    humidityPct: num(cur.relative_humidity_2m),
    precipitationMm: num(cur.precipitation) || 0,
    weatherCode: num(cur.weather_code),
    windSpeedKmh: num(cur.wind_speed_10m),
    windGustsKmh: num(cur.wind_gusts_10m),
    isDay: cur.is_day === 1,
    uvIndex: forecast.length ? num(forecast[0].uvIndex) : null, // v1 free tier has no current UV — nearest hour
    // Measured station AQI (CPCB, India, when configured) beats modeled AQI —
    // sources are labeled so measured vs modeled never blur.
    aqi: cpcb.status === 'ok' ? cpcb.aqi
      : aq && aq.current && num(aq.current.us_aqi) != null
        ? { value: num(aq.current.us_aqi), source: 'open-meteo-cams-modeled' } : null,
    aqiAvailable: cpcb.status === 'ok' || !!(aq && aq.current && num(aq.current.us_aqi) != null),
    aqiMeasuredCoverage: inIndia ? cpcb.status : 'n/a', // 'ok'|'unconfigured'|'no-station-in-range'|'unavailable'
    // Government alert feed: NWS (US + territories) or IMD CAP via WIS2 (India).
    // `alertsAvailable` is true only when the provider actually answered for a
    // covered point — outage or unsupported region both leave it false so the
    // engine never implies "no alerts" from an absent field.
    alerts: alerts.alerts,
    alertsUnscopedCount: alerts.unscopedCount || 0, // active alerts whose geography could not be verified for this point
    alertsAvailable: alerts.status === 'ok',
    alertsCoverage: alerts.status === 'ok' ? (inIndia ? 'imd-cap' : 'nws-us') : alerts.status,
    alertsSource: inIndia ? 'wis2box.imd.gov.in (IMD CAP / WMO WIS2)' : 'api.weather.gov',
    forecast,
  };
  return obs;
}

/** Mark an observation stale if it outlived the freshness window. */
function markStale(obs, { now = new Date() } = {}) {
  if (!obs) return null;
  const t = new Date(obs.fetchedAt || obs.observedAt || 0).getTime();
  return (now.getTime() - t) > STALE_AFTER_MS ? { ...obs, stale: true } : obs;
}

module.exports = { fetchEnvironment, markStale, setFetch, STALE_AFTER_MS };
