// Weather service — uses Open-Meteo (free, no API key).
// Maps raw weather into our app's condition buckets: 'hot' | 'rainy' | 'pleasant'.

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

// Injectable for tests.
let _fetch = globalThis.fetch;
function setFetch(fn) { _fetch = fn; }

async function fetchWeather(lat, lon) {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) {
    throw new Error('lat and lon must be finite numbers');
  }
  const url = `${OPEN_METEO_URL}?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,weather_code`;
  const res = await _fetch(url);
  if (!res.ok) throw new Error(`weather fetch failed: ${res.status}`);
  const data = await res.json();
  const cur = data && data.current ? data.current : {};
  const tempC = Number(cur.temperature_2m);
  const precip = Number(cur.precipitation) || 0;
  const code = Number(cur.weather_code);
  return {
    tempC: isFinite(tempC) ? tempC : null,
    precipitation: precip,
    weatherCode: isFinite(code) ? code : null,
    condition: deriveCondition({ tempC, precip, code }),
    description: describe(code),
  };
}

// Mapping rules:
//   precipitation > 0 OR code indicates rain/snow/thunder -> 'rainy'
//   else tempC >= 28                                        -> 'hot'
//   else                                                    -> 'pleasant'
function deriveCondition({ tempC, precip, code }) {
  if (precip > 0 || isWetCode(code)) return 'rainy';
  if (isFinite(tempC) && tempC >= 28) return 'hot';
  return 'pleasant';
}

// Open-Meteo WMO codes. Treat drizzle/rain/snow/thunder as wet.
function isWetCode(code) {
  if (!isFinite(code)) return false;
  if (code >= 51 && code <= 67) return true; // drizzle + rain
  if (code >= 71 && code <= 77) return true; // snow
  if (code >= 80 && code <= 82) return true; // rain showers
  if (code >= 85 && code <= 86) return true; // snow showers
  if (code >= 95 && code <= 99) return true; // thunderstorm
  return false;
}

function describe(code) {
  if (!isFinite(code)) return 'unknown';
  if (code === 0) return 'clear sky';
  if (code <= 3) return 'partly cloudy';
  if (code === 45 || code === 48) return 'foggy';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain showers';
  if (code >= 85 && code <= 86) return 'snow showers';
  if (code >= 95) return 'thunderstorm';
  return 'unknown';
}

function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }

module.exports = { fetchWeather, deriveCondition, setFetch };
