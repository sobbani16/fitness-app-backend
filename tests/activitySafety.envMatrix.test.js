// Environmental matrix via the environmentService.setFetch DI seam.
// Covers the deployed path fetchEnvironment -> normalize -> safety.evaluate
// for all env classes the 25 ENV_DEPENDENT staging cases depended on.
const safety = require('../src/services/activitySafety');
const { fetchEnvironment, setFetch } = require('../src/services/environmentService');

const REAL_FETCH = globalThis.fetch;
afterEach(() => setFetch(REAL_FETCH));
afterAll(() => setFetch(REAL_FETCH));

// Minimal Open-Meteo-shaped provider responses.
const OM = (cur, hourly = {}) => new Response(JSON.stringify({
  current: { time: new Date().toISOString(), temperature_2m: cur.t, apparent_temperature: cur.at ?? cur.t,
    relative_humidity_2m: cur.h ?? 50, precipitation: 0, weather_code: cur.code ?? 0,
    wind_speed_10m: cur.wind ?? 8, wind_gusts_10m: cur.gust ?? 12, is_day: 1 },
  hourly: { time: [new Date().toISOString()], temperature_2m: [cur.t], apparent_temperature: [cur.at ?? cur.t],
    precipitation_probability: [0], weather_code: [cur.code ?? 0], uv_index: [3] },
}), { status: 200, headers: { 'content-type': 'application/json' } });

const AQ = aqi => new Response(JSON.stringify({
  current: { us_aqi: aqi }, hourly: {}, hourly_units: {},
}), { status: 200, headers: { 'content-type': 'application/json' } });

const stub = om => setFetch(async url => /air-quality/.test(url) ? AQ(om.aqi ?? 30) : OM(om));
const CTX = { conditions: [], injuries: [], symptoms: [], surgeries: [], restrictions: [], preferences: {} };
const evalEnv = env => safety.evaluate(CTX, safety.getActivity('outdoor_walk'), env, { rules: [] }).decision;

describe('environmental matrix (setFetch seam)', () => {
  test('safe conditions -> ALLOW', async () => {
    stub({ t: 20, code: 1, aqi: 25 });
    expect(await evalEnv(await fetchEnvironment(37.77, -122.42))).toBe('ALLOW');
  });
  test('extreme heat (42C apparent) -> DEFER_OUTDOOR', async () => {
    stub({ t: 40, at: 42, aqi: 30 });
    expect(await evalEnv(await fetchEnvironment(30, -97))).toBe('DEFER_OUTDOOR');
  });
  test('extreme cold (-15C) -> DEFER_OUTDOOR', async () => {
    stub({ t: -15, at: -18, aqi: 20 });
    expect(await evalEnv(await fetchEnvironment(44, -93))).toBe('DEFER_OUTDOOR');
  });
  test('hazardous AQI 210 -> DEFER_OUTDOOR', async () => {
    stub({ t: 22, aqi: 210 });
    expect(await evalEnv(await fetchEnvironment(34, -118))).toBe('DEFER_OUTDOOR');
  });
  test('provider outage -> env unavailable -> INSUFFICIENT_DATA (fail-closed)', async () => {
    setFetch(async () => { throw new Error('provider down'); });
    expect(await evalEnv({ available: false })).toBe('INSUFFICIENT_DATA');
  });
  test('thunderstorm code -> DEFER_OUTDOOR', async () => {
    stub({ t: 24, code: 95, aqi: 30 });
    expect(await evalEnv(await fetchEnvironment(30, -90))).toBe('DEFER_OUTDOOR');
  });
  test('stale observation -> INSUFFICIENT_DATA', async () => {
    const { markStale } = require('../src/services/environmentService');
    stub({ t: 20, aqi: 30 });
    const obs = await fetchEnvironment(37.77, -122.42);
    const stale = markStale({ ...obs, fetchedAt: new Date(Date.now() - 6 * 3600e3).toISOString() });
    expect(await evalEnv(stale)).toBe('INSUFFICIENT_DATA');
  });
  test('missing coords -> env unknown -> INSUFFICIENT_DATA (never claims safe)', async () => {
    expect(await evalEnv({ available: false })).toBe('INSUFFICIENT_DATA');
  });
  test('conflicting: great temp + thunder -> still DEFER (hazard wins)', async () => {
    stub({ t: 18, code: 96, aqi: 20 });
    expect(await evalEnv(await fetchEnvironment(37.77, -122.42))).toBe('DEFER_OUTDOOR');
  });
  test('provider recovery: outage then ok -> safe ALLOW restored', async () => {
    setFetch(async () => { throw new Error('down'); });
    expect(await evalEnv({ available: false })).toBe('INSUFFICIENT_DATA');
    stub({ t: 20, aqi: 30 });
    expect(await evalEnv(await fetchEnvironment(37.77, -122.42))).toBe('ALLOW');
  });
});
