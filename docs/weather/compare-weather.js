// pc-HUM-8 — reproducible weather comparison harness (audit-only).
// Exercises the REAL exported functions with local fixtures; no live
// providers, no DB, fixed clock. Run: `node docs/weather/compare-weather.js`
//
// Paths compared per scenario (all fed from the SAME observation):
//   A. v1 legacy: weatherService.deriveCondition → recommendationEngine
//      .recommendFromBalance(balance, {weather:{condition}})
//      → {location, weatherAdjusted}   (intermediate — the API response field)
//   B. v2 authority: activitySafety.evaluate(ctx, activity, env, {rules:[]})
//      → decision + reasons + betterTime for outdoor_walk + indoor_walk
//   C. v2 final: activitySafety.recommend(ctx, env, {rules:[]})
//      → disposition + suggestion (the producer-facing result)

const path = require('path');
const ROOT = path.join(__dirname, '../..');
const safety = require(path.join(ROOT, 'src/services/activitySafety'));
const { deriveCondition } = require(path.join(ROOT, 'src/services/weatherService'));
const { markStale } = require(path.join(ROOT, 'src/services/environmentService'));
const { recommendFromBalance } = require(path.join(ROOT, 'src/services/recommendationEngine'));

const NOW = new Date('2026-11-24T14:00:00Z');
// Fixed synthetic profile: healthy adult, no conditions/injuries/restrictions.
const CTX = { conditions: [], injuries: [], symptoms: [], surgeries: [], restrictions: [], preferences: {} };
const RULES = []; // engine structural rules only — matches envMatrix test convention
const BALANCE = { surplus: -50 }; // deterministic 'Close to target' base (location 'either')
const ACT_OUT = safety.getActivity('outdoor_walk');
const ACT_IN = safety.getActivity('indoor_walk');

const mkEnv = (o = {}) => ({
  provider: 'fixture', units: { temp: 'celsius', aqi: 'us_aqi' },
  available: true, weatherAvailable: true, stale: false,
  lat: 37.77, lon: -122.42,
  observedAt: NOW.toISOString(), fetchedAt: NOW.toISOString(),
  tempC: 20, apparentTempC: 20, humidityPct: 50, precipitationMm: 0,
  weatherCode: 1, windSpeedKmh: 8, windGustsKmh: 12, isDay: true, uvIndex: 3,
  aqi: { value: 30, source: 'fixture' }, aqiAvailable: true, aqiMeasuredCoverage: 'n/a',
  alerts: [], alertsUnscopedCount: 0, alertsAvailable: true, forecast: [],
  ...o,
});

const CASES = [
  { id: 'baseline',   label: 'Mild baseline (20C, clear, AQI 30)', env: mkEnv() },
  { id: 'rain',       label: 'Rain (WMO 61, 2mm precip)',          env: mkEnv({ weatherCode: 61, precipitationMm: 2 }) },
  { id: 'heat',       label: 'Extreme heat (apparent 42C)',        env: mkEnv({ tempC: 40, apparentTempC: 42 }) },
  { id: 'cold',       label: 'Extreme cold (apparent -20C)',       env: mkEnv({ tempC: -20, apparentTempC: -20 }) },
  { id: 'aqi',        label: 'Unhealthy AQI 160, mild weather',    env: mkEnv({ aqi: { value: 160, source: 'fixture' } }) },
  { id: 'thunder',    label: 'Thunderstorm (WMO 95, 20C)',         env: mkEnv({ weatherCode: 95 }) },
  { id: 'stale',      label: 'Stale observation (3h old)',         env: () => markStale({ ...mkEnv(), fetchedAt: new Date(NOW.getTime() - 3 * 3600e3).toISOString() }, { now: NOW }) },
  { id: 'missing',    label: 'Missing observation',                env: { available: false } },
  // Boundary sweep on the configured heat_danger cutoff (apparent >= 40.5C)
  { id: 'edge-40.4',  label: 'Boundary: apparent 40.4C (below)',   env: mkEnv({ tempC: 40.4, apparentTempC: 40.4 }) },
  { id: 'edge-40.5',  label: 'Boundary: apparent 40.5C (at)',      env: mkEnv({ tempC: 40.5, apparentTempC: 40.5 }) },
  { id: 'edge-40.6',  label: 'Boundary: apparent 40.6C (above)',   env: mkEnv({ tempC: 40.6, apparentTempC: 40.6 }) },
];

function v1(env) {
  if (!env || env.available === false) return { condition: null, location: 'n/a (no obs)', weatherAdjusted: null };
  const condition = deriveCondition({ tempC: env.tempC, precip: env.precipitationMm, code: env.weatherCode });
  const r = recommendFromBalance(BALANCE, { weather: { condition }, mealsLogged: 1 });
  return { condition, location: r.location, weatherAdjusted: r.weatherAdjusted, type: r.type };
}

function v2Eval(env, activity) {
  const r = safety.evaluate(CTX, activity, env, { rules: RULES, now: NOW });
  return { decision: r.decision, reasons: r.reasons, betterTime: r.betterTime };
}

function v2Rec(env) {
  const rec = safety.recommend(CTX, env, { rules: RULES, now: NOW });
  return { disposition: rec.disposition, suggestion: rec.suggestion && rec.suggestion.activityId, decision: rec.suggestion && rec.suggestion.decision, betterTime: rec.suggestion && rec.suggestion.betterTime };
}

const rows = [];
for (const c of CASES) {
  const env = typeof c.env === 'function' ? c.env() : c.env;
  const a = v1(env);
  const bo = v2Eval(env, ACT_OUT);
  const bi = v2Eval(env, ACT_IN);
  const cr = v2Rec(env);
  rows.push({ case: c.id, label: c.label, v1: a, outdoor: bo, indoor: bi, recommend: cr });
}

// Compact markdown table
const cell = s => String(s == null ? '—' : s).slice(0, 60);
console.log('\n## Weather comparison — same observation into each real path\n');
console.log('| case | obs (units) | v1 condition → location (adj?) | outdoor_walk decision | indoor_walk | recommend() suggestion |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) {
  const e = typeof CASES.find(c => c.id === r.case).env === 'function' ? null : CASES.find(c => c.id === r.case).env;
  const obs = r.case === 'missing' ? 'unavailable'
    : r.case === 'stale' ? 'stale 3h'
    : `${e.apparentTempC}C app, code ${e.weatherCode}, AQI ${e.aqi.value}, precip ${e.precipitationMm}mm`;
  console.log(`| ${r.case} | ${obs} | ${cell(r.v1.condition)} → ${r.v1.location} (${r.v1.weatherAdjusted}) | ${r.outdoor.decision}${r.outdoor.betterTime ? ` +betterTime` : ''} | ${r.indoor.decision} | ${r.recommend.suggestion || 'none'} (${r.recommend.decision || r.recommend.disposition}) |`);
}
console.log('\nDetails (reasons) — non-baseline divergences:\n');
for (const r of rows) {
  if (r.outdoor.decision === 'ALLOW' && r.recommend.suggestion) continue;
  console.log(`- ${r.case}: outdoor=${r.outdoor.decision} [${r.outdoor.reasons.join(' | ') || 'no reasons'}]`);
}
module.exports = { rows };
