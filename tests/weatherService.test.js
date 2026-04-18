const { deriveCondition, fetchWeather, setFetch } = require('../src/services/weatherService');

describe('deriveCondition', () => {
  it('returns rainy when precipitation > 0', () => {
    expect(deriveCondition({ tempC: 20, precip: 0.2, code: 0 })).toBe('rainy');
  });
  it('returns rainy on rain/thunder codes even without precip', () => {
    expect(deriveCondition({ tempC: 20, precip: 0, code: 63 })).toBe('rainy');
    expect(deriveCondition({ tempC: 20, precip: 0, code: 95 })).toBe('rainy');
  });
  it('returns hot when temp >= 28', () => {
    expect(deriveCondition({ tempC: 30, precip: 0, code: 0 })).toBe('hot');
  });
  it('returns pleasant otherwise', () => {
    expect(deriveCondition({ tempC: 20, precip: 0, code: 0 })).toBe('pleasant');
  });
});

describe('fetchWeather', () => {
  afterEach(() => setFetch(globalThis.fetch));

  it('throws on invalid coords', async () => {
    await expect(fetchWeather(NaN, 0)).rejects.toThrow();
  });

  it('returns parsed response (mocked fetch)', async () => {
    setFetch(async () => ({
      ok: true,
      json: async () => ({ current: { temperature_2m: 29, precipitation: 0, weather_code: 0 } }),
    }));
    const r = await fetchWeather(40, -74);
    expect(r.tempC).toBe(29);
    expect(r.condition).toBe('hot');
    expect(r.description).toBe('clear sky');
  });

  it('throws on non-ok response', async () => {
    setFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(fetchWeather(40, -74)).rejects.toThrow(/500/);
  });
});
