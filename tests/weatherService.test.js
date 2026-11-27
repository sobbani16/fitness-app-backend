const { deriveCondition, fetchWeather, normalizeWind, geocodeCity, setFetch } = require('../src/services/weatherService');

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

  it('requests wind fields and returns them as km/h numbers', async () => {
    let requestedUrl = '';
    setFetch(async url => {
      requestedUrl = url;
      return {
        ok: true,
        json: async () => ({ current: { temperature_2m: 18, precipitation: 0, weather_code: 3, wind_speed_10m: 24.5, wind_gusts_10m: 41.2 } }),
      };
    });
    const r = await fetchWeather(40, -74);
    expect(requestedUrl).toContain('wind_speed_10m');
    expect(requestedUrl).toContain('wind_gusts_10m');
    expect(r.windSpeedKmh).toBe(24.5);
    expect(r.windGustsKmh).toBe(41.2);
  });

  it('returns null wind fields when the provider omits them', async () => {
    setFetch(async () => ({
      ok: true,
      json: async () => ({ current: { temperature_2m: 18, precipitation: 0, weather_code: 3 } }),
    }));
    const r = await fetchWeather(40, -74);
    expect(r.windSpeedKmh).toBeNull();
    expect(r.windGustsKmh).toBeNull();
  });

  // Wind normalization regressions (founder directive 2026-11-27): unavailable
  // provider values must stay unavailable — a false 0 km/h reads as dead calm
  // and can suppress downstream wind cautions.
  it.each([
    ['explicit null', null],
    ['explicit undefined', undefined],
    ['empty string', ''],
    ['invalid string', 'not-a-number'],
    ['NaN', NaN],
    ['negative value', -3.5],
  ])('wind %s normalizes to null (unavailable), never zero', async (_label, bad) => {
    setFetch(async () => ({
      ok: true,
      json: async () => ({ current: { temperature_2m: 18, precipitation: 0, weather_code: 3, wind_speed_10m: bad, wind_gusts_10m: bad } }),
    }));
    const r = await fetchWeather(40, -74);
    expect(r.windSpeedKmh).toBeNull();
    expect(r.windGustsKmh).toBeNull();
  });

  it('legitimate measured zero wind is preserved as 0, distinct from unavailable', async () => {
    setFetch(async () => ({
      ok: true,
      json: async () => ({ current: { temperature_2m: 18, precipitation: 0, weather_code: 1, wind_speed_10m: 0, wind_gusts_10m: 0 } }),
    }));
    const r = await fetchWeather(40, -74);
    expect(r.windSpeedKmh).toBe(0);
    expect(r.windGustsKmh).toBe(0);
  });

  it('numeric strings from the provider are accepted as numbers', async () => {
    setFetch(async () => ({
      ok: true,
      json: async () => ({ current: { temperature_2m: 18, precipitation: 0, weather_code: 1, wind_speed_10m: '12.5', wind_gusts_10m: '30' } }),
    }));
    const r = await fetchWeather(40, -74);
    expect(r.windSpeedKmh).toBe(12.5);
    expect(r.windGustsKmh).toBe(30);
  });

  it('throws on non-ok response', async () => {
    setFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(fetchWeather(40, -74)).rejects.toThrow(/500/);
  });
});

describe('geocodeCity', () => {
  afterEach(() => setFetch(globalThis.fetch));

  it('rejects a blank city without calling the provider', async () => {
    const spy = jest.fn();
    setFetch(spy);
    await expect(geocodeCity('  ')).rejects.toThrow('city name');
    expect(spy).not.toHaveBeenCalled();
  });

  it('trims provider results to name, country and coordinates', async () => {
    setFetch(async () => ({ ok: true, json: async () => ({ results: [
      { name: 'Pune', country: 'India', latitude: 18.52, longitude: 73.86, population: 3000000, timezone: 'Asia/Kolkata' },
      { name: 'Bad', latitude: 'x' },
    ] }) }));
    expect(await geocodeCity('pune')).toEqual([{ name: 'Pune', country: 'India', latitude: 18.52, longitude: 73.86 }]);
  });

  it('returns an empty list when the provider has no match', async () => {
    setFetch(async () => ({ ok: true, json: async () => ({}) }));
    expect(await geocodeCity('nowhere')).toEqual([]);
  });
});

describe('normalizeWind', () => {
  it.each([
    [null, null], [undefined, null], ['', null], ['garbage', null],
    [NaN, null], [-1, null], [-0.5, null], [Infinity, null],
  ])('invalid input %p → null', (input, expected) => {
    expect(normalizeWind(input)).toBe(expected);
  });
  it.each([[0, 0], [0.0, 0], [12.5, 12.5], ['8', 8], [120, 120]])('valid input %p → %p', (input, expected) => {
    expect(normalizeWind(input)).toBe(expected);
  });
});
