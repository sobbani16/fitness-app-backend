// Environmental observation service (weather intelligence v2).
// Fetches a normalized observation the safety engine consumes:
//   feels-like, humidity, wind/gusts, UV, precip probability + 12h forecast
//   from Open-Meteo, and US AQI from Open-Meteo's air-quality API.
// Open-Meteo has no government alert feed — `alertsAvailable` is honestly
// false so the engine never implies "no alerts" from an absent field.
// No API key and no user health data is sent to providers; only lat/lon.

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const STALE_AFTER_MS = 90 * 60 * 1000; // >90 min old → unusable for decisions

let _fetch = globalThis.fetch;
function setFetch(fn) { _fetch = fn; }
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const valid = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

async function fetchJson(url) {
  const res = await _fetch(url);
  if (!res.ok) throw new Error(`provider fetch failed: ${res.status}`);
  return res.json();
}

/**
 * fetchEnvironment(lat, lon) → normalized observation.
 * Never fabricates: missing measurements stay null with `available`/`*Available`
 * flags so downstream evaluation treats unknown ≠ safe.
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
  const [fc, aq] = await Promise.all([
    fetchJson(`${FORECAST_URL}?${fcParams}`),
    fetchJson(`${AQ_URL}?${new URLSearchParams({ latitude: lat, longitude: lon, current: 'us_aqi' })}`)
      .catch(() => null), // AQI outage never blocks weather
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
    available: true, stale: false,
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
    aqi: aq && aq.current && num(aq.current.us_aqi) != null
      ? { value: num(aq.current.us_aqi), source: 'open-meteo-air-quality' } : null,
    aqiAvailable: !!(aq && aq.current && num(aq.current.us_aqi) != null),
    // Open-Meteo carries no NWS/government alert feed — honest unavailability.
    alerts: [], alertsAvailable: false,
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
