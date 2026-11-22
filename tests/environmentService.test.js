// NWS severe-weather alert integration — coverage, outage and region honesty.
const svc = require('../src/services/environmentService');
const { evaluateActivity } = require('../src/services/activitySafety/engine');
const { ACTIVITIES } = require('../src/services/activitySafety/activityCatalog');

const FC = {
  current: { time: '2026-01-01T12:00', temperature_2m: 20, apparent_temperature: 20, relative_humidity_2m: 50, precipitation: 0, weather_code: 2, wind_speed_10m: 10, wind_gusts_10m: 15, is_day: 1 },
  hourly: { time: ['2026-01-01T13:00'], temperature_2m: [21], apparent_temperature: [21], precipitation_probability: [10], weather_code: [2], uv_index: [3] },
};
const AQ = { current: { us_aqi: 30 } };
const nws = (features) => ({ features });

function fetchFor({ nwsRes = nws([]), nwsError = null } = {}) {
  const calls = [];
  return {
    calls,
    fn: jest.fn(async (url) => {
      calls.push(url);
      if (url.includes('api.weather.gov')) {
        if (nwsError) throw nwsError;
        return { ok: true, json: async () => nwsRes };
      }
      if (url.includes('air-quality-api')) return { ok: true, json: async () => AQ };
      return { ok: true, json: async () => FC };
    }),
  };
}
const httpErr = (s) => { const e = new Error(`status ${s}`); e.status = s; return e; };

const BASE_CTX = { conditions: [], injuries: [], surgeries: [], restrictions: [], symptomReports: [], mobility: {}, preferences: {} };

describe('environmentService — NWS alerts', () => {
  afterEach(() => svc.setFetch(globalThis.fetch));

  test('US point + active alert → alertsAvailable, alert normalized into hazard path', async () => {
    const f = fetchFor({ nwsRes: nws([{ properties: { event: 'Tornado Warning', severity: 'Extreme', effective: '2026-01-01T11:00Z', expires: '2999-01-01T13:00Z' } }]) });
    svc.setFetch(f.fn);
    const obs = await svc.fetchEnvironment(40.7, -74.0); // NYC
    expect(obs.alertsAvailable).toBe(true);
    expect(obs.alertsCoverage).toBe('nws-us');
    expect(obs.alerts).toEqual([{ event: 'Tornado Warning', severity: 'Extreme', effective: '2026-01-01T11:00Z', expires: '2999-01-01T13:00Z' }]);
    // end-to-end: normalized alert produces severe_alert hazard → outdoor deferral
    const res = evaluateActivity({ context: BASE_CTX, activity: ACTIVITIES.outdoor_walk, env: obs });
    expect(res.decision).toBe('DEFER_OUTDOOR');
  });

  test('expired alert is filtered out; unexpired kept', async () => {
    const f = fetchFor({ nwsRes: nws([
      { properties: { event: 'Heat Advisory', severity: 'Moderate', expires: '2000-01-01T00:00Z' } },
      { properties: { event: 'Flood Watch', severity: 'Severe', expires: '2999-01-01T00:00Z' } },
    ]) });
    svc.setFetch(f.fn);
    const obs = await svc.fetchEnvironment(40.7, -74.0);
    expect(obs.alerts.map(a => a.event)).toEqual(['Flood Watch']);
  });

  test('NWS 4xx (out-of-service-area point) → unsupported, not outage', async () => {
    const f = fetchFor({ nwsError: httpErr(400) });
    svc.setFetch(f.fn);
    const obs = await svc.fetchEnvironment(40.7, -74.0);
    expect(obs.alertsAvailable).toBe(false);
    expect(obs.alertsCoverage).toBe('unsupported');
    expect(obs.alerts).toEqual([]);
  });

  test('NWS outage/timeout → unavailable — alertsAvailable false, weather still served', async () => {
    const f = fetchFor({ nwsError: httpErr(503) });
    svc.setFetch(f.fn);
    const obs = await svc.fetchEnvironment(40.7, -74.0);
    expect(obs.alertsAvailable).toBe(false);
    expect(obs.alertsCoverage).toBe('unavailable');
    expect(obs.available).toBe(true);
    expect(obs.tempC).toBe(20);
  });

  test('non-US coordinates → NWS never called, coverage unsupported', async () => {
    const f = fetchFor();
    svc.setFetch(f.fn);
    const obs = await svc.fetchEnvironment(48.85, 2.35); // Paris
    expect(f.calls.some(u => u.includes('api.weather.gov'))).toBe(false);
    expect(obs.alertsAvailable).toBe(false);
    expect(obs.alertsCoverage).toBe('unsupported');
  });

  test('alertsAvailable false → engine requires alert data, never implies "no alerts"', async () => {
    const f = fetchFor({ nwsError: httpErr(503) });
    svc.setFetch(f.fn);
    const obs = await svc.fetchEnvironment(40.7, -74.0);
    const res = evaluateActivity({ context: BASE_CTX, activity: ACTIVITIES.outdoor_walk, env: obs });
    expect(res.requiredData).toContain('severe_weather_alerts');
  });
});
