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

// --- India: IMD CAP alerts via WIS2 + CPCB AQI via data.gov.in -----------------

const capXml = ({ id = 'IN-1', event = 'Cyclone Warning', severity = 'Extreme', effective = '2000-01-01T00:00:00+05:30', expires = '2999-01-01T00:00:00+05:30', areaDesc = 'Chennai, Tamil Nadu', polygonUrl = 'https://sachet.ndma.gov.in/poly/1' } = {}) =>
  `<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2"><cap:identifier>${id}</cap:identifier><cap:status>Actual</cap:status><cap:msgType>Alert</cap:msgType><cap:info><cap:event>${event}</cap:event><cap:severity>${severity}</cap:severity><cap:effective>${effective}</cap:effective><cap:expires>${expires}</cap:expires><cap:headline>${event}</cap:headline>${polygonUrl ? `<cap:parameter><cap:valueName>Polygon URL</cap:valueName><cap:value>${polygonUrl}</cap:value></cap:parameter>` : ''}<cap:area><cap:areaDesc>${areaDesc}</cap:areaDesc></cap:area></cap:info></cap:alert>`;
const wis2 = (xmls) => ({ features: xmls.map(x => ({ properties: { metadata_id: 'urn:wmo:md:in-imd:cap_alerts', pubtime: new Date().toISOString(), content: { encoding: 'base64', value: Buffer.from(x).toString('base64') } } })) });
// Chennai-area polygon (~13.0–13.2 N, 80.0–80.4 E)
const CHENNAI_POLY = '<cap:polygon>13.0,80.0 13.2,80.0 13.2,80.4 13.0,80.4 13.0,80.0</cap:polygon>';
const cpcb = (records) => ({ records });

function indiaFetch({ wis2Res = wis2([]), wis2Error = null, polyText = CHENNAI_POLY, polyError = null, aq = AQ, aqError = null, cpcbRes = null, fc = FC } = {}) {
  const calls = [];
  return {
    calls,
    fn: jest.fn(async (url) => {
      calls.push(url);
      if (url.includes('wis2box.imd.gov.in')) { if (wis2Error) throw wis2Error; return { ok: true, json: async () => wis2Res }; }
      if (url.includes('sachet.ndma.gov.in') || url.includes('/poly/')) { if (polyError) throw polyError; return { ok: true, text: async () => polyText }; }
      if (url.includes('api.data.gov.in')) return { ok: true, json: async () => cpcbRes || { records: [] } };
      if (url.includes('air-quality-api')) { if (aqError) throw aqError; return { ok: true, json: async () => aq }; }
      return { ok: true, json: async () => fc };
    }),
  };
}
const DELHI = [28.6, 77.2], MUMBAI = [19.08, 72.88], CHENNAI = [13.08, 80.27], HYDERABAD = [17.38, 78.49], BENGALURU = [12.97, 77.59];

describe('environmentService — India (IMD CAP + CPCB)', () => {
  afterEach(() => { svc.setFetch(globalThis.fetch); delete process.env.DATA_GOV_IN_API_KEY; });

  test('Delhi poor air quality → modeled AQI hazard; CPCB unconfigured honestly reported', async () => {
    const f = indiaFetch({ aq: { current: { us_aqi: 180 } } });
    svc.setFetch(f.fn);
    const obs = await svc.fetchEnvironment(...DELHI);
    expect(obs.aqiAvailable).toBe(true);
    expect(obs.aqi.value).toBe(180);
    expect(obs.aqi.source).toBe('open-meteo-cams-modeled');
    expect(obs.aqiMeasuredCoverage).toBe('unconfigured'); // no DATA_GOV_IN_API_KEY
    const res = evaluateActivity({ context: BASE_CTX, activity: ACTIVITIES.outdoor_walk, env: obs });
    expect(res.decision).toBe('DEFER_OUTDOOR'); // aqi_unhealthy
  });

  test('Mumbai heavy rain → heavy_precip MODIFY', async () => {
    const wet = { ...FC, current: { ...FC.current, precipitation: 8 } };
    svc.setFetch(indiaFetch({ fc: wet }).fn);
    const obs = await svc.fetchEnvironment(...MUMBAI);
    const res = evaluateActivity({ context: BASE_CTX, activity: ACTIVITIES.outdoor_walk, env: obs });
    expect(res.decision).toBe('MODIFY');
    expect(res.dimensions.environmental.hazards).toContain('heavy_precip');
  });

  test('Chennai cyclone CAP alert with verified polygon → severe_alert DEFER, imd-cap coverage', async () => {
    const f = indiaFetch({ wis2Res: wis2([capXml({ event: 'Cyclone Warning', severity: 'Extreme' })]) });
    svc.setFetch(f.fn);
    const obs = await svc.fetchEnvironment(...CHENNAI);
    expect(obs.alertsCoverage).toBe('imd-cap');
    expect(obs.alertsAvailable).toBe(true);
    expect(obs.alerts[0].event).toBe('Cyclone Warning');
    expect(obs.alerts[0].scope).toBe('polygon-verified');
    const res = evaluateActivity({ context: BASE_CTX, activity: ACTIVITIES.outdoor_walk, env: obs });
    expect(res.decision).toBe('DEFER_OUTDOOR');
  });

  test('Hyderabad extreme heat → heat_danger DEFER', async () => {
    const hot = { ...FC, current: { ...FC.current, temperature_2m: 43, apparent_temperature: 43 } };
    svc.setFetch(indiaFetch({ fc: hot }).fn);
    const obs = await svc.fetchEnvironment(...HYDERABAD);
    expect(evaluateActivity({ context: BASE_CTX, activity: ACTIVITIES.outdoor_run, env: obs }).decision).toBe('DEFER_OUTDOOR');
  });

  test('Bengaluru normal conditions → ALLOW', async () => {
    svc.setFetch(indiaFetch().fn);
    const obs = await svc.fetchEnvironment(...BENGALURU);
    expect(evaluateActivity({ context: BASE_CTX, activity: ACTIVITIES.outdoor_walk, env: obs }).decision).toBe('ALLOW');
  });

  test('rural India: AQ provider down + no CPCB key → aqiAvailable false, weather still served, no fabricated index', async () => {
    const f = indiaFetch({ aqError: httpErr(503) });
    svc.setFetch(f.fn);
    const obs = await svc.fetchEnvironment(23.5, 85.3); // rural Jharkhand
    expect(obs.available).toBe(true);
    expect(obs.tempC).toBe(20);
    expect(obs.aqiAvailable).toBe(false);
    expect(obs.aqi).toBeNull();
    expect(obs.aqiMeasuredCoverage).toBe('unconfigured');
  });

  test('IMD CAP provider outage → alertsCoverage unavailable, never "no alerts"', async () => {
    const f = indiaFetch({ wis2Error: httpErr(503) });
    svc.setFetch(f.fn);
    const obs = await svc.fetchEnvironment(...DELHI);
    expect(obs.alertsCoverage).toBe('unavailable');
    expect(obs.alertsAvailable).toBe(false);
    const res = evaluateActivity({ context: BASE_CTX, activity: ACTIVITIES.outdoor_walk, env: obs });
    expect(res.requiredData).toContain('severe_weather_alerts');
  });

  test('expired CAP alert is dropped; provider still reports coverage', async () => {
    const f = indiaFetch({ wis2Res: wis2([capXml({ event: 'Flood Warning', expires: '2000-01-01T00:00:00+05:30' })]) });
    svc.setFetch(f.fn);
    const obs = await svc.fetchEnvironment(...CHENNAI);
    expect(obs.alertsCoverage).toBe('imd-cap');
    expect(obs.alertsAvailable).toBe(true);
    expect(obs.alerts).toEqual([]);
  });

  test('alert boundary: same feed, point outside the polygon → alert NOT applied (geographic scope honored)', async () => {
    const f = indiaFetch({ wis2Res: wis2([capXml({ event: 'Cyclone Warning', severity: 'Extreme' })]) });
    svc.setFetch(f.fn);
    const inside = await svc.fetchEnvironment(...CHENNAI);
    const outside = await svc.fetchEnvironment(...BENGALURU); // same feed, outside Chennai polygon
    expect(inside.alerts.length).toBe(1);
    expect(outside.alerts.length).toBe(0);
    expect(outside.alertsUnscopedCount).toBe(1); // honestly counted, not silently "no alert"
    expect(evaluateActivity({ context: BASE_CTX, activity: ACTIVITIES.outdoor_walk, env: outside }).decision).toBe('ALLOW');
  });

  test('areaDesc-only alert (no polygon) → unscoped, never inferred as covering the point', async () => {
    const f = indiaFetch({ wis2Res: wis2([capXml({ event: 'Flood Warning', polygonUrl: null })]) });
    svc.setFetch(f.fn);
    const obs = await svc.fetchEnvironment(...CHENNAI);
    expect(obs.alerts).toEqual([]);
    expect(obs.alertsUnscopedCount).toBe(1);
  });

  test('CPCB measured AQI overrides modeled when key configured (nearest station ≤50 km)', async () => {
    process.env.DATA_GOV_IN_API_KEY = 'test-key';
    const f = indiaFetch({
      aq: { current: { us_aqi: 60 } },
      cpcbRes: cpcb([{ city: 'Delhi', station: 'Anand Vihar', latitude: 28.65, longitude: 77.31, avg_value: 160, last_update: '21-11-2026 12:00' }]),
    });
    svc.setFetch(f.fn);
    const obs = await svc.fetchEnvironment(...DELHI);
    expect(obs.aqiMeasuredCoverage).toBe('ok');
    expect(obs.aqi.source).toBe('cpcb-station-pm25-us-epa-equivalent');
    expect(obs.aqi.value).toBe(210); // 160 µg/m³ PM2.5 → US-EPA AQI ~210 (150.5–250.4 band)
    expect(obs.aqi.station).toBe('Anand Vihar');
  });

  test('CPCB station beyond 50 km → measured coverage no-station-in-range, modeled AQI serves', async () => {
    process.env.DATA_GOV_IN_API_KEY = 'test-key';
    const f = indiaFetch({
      cpcbRes: cpcb([{ city: 'Jaipur', station: 'Adarsh Nagar', latitude: 26.9, longitude: 75.8, avg_value: 90, last_update: 'x' }]),
    });
    svc.setFetch(f.fn);
    const obs = await svc.fetchEnvironment(...DELHI);
    expect(obs.aqiMeasuredCoverage).toBe('no-station-in-range');
    expect(obs.aqi.value).toBe(30); // modeled fallback still labeled
    expect(obs.aqi.source).toBe('open-meteo-cams-modeled');
  });
});
