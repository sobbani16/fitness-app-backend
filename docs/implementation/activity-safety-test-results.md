# Activity Safety — Test Results Log

Updated after every test run. Newest first.

## 2026-11-21 — baseline (audit phase, pre-implementation)
- `npx jest tests/weatherService.test.js` → 10/10 pass
- `npx jest src/services/__tests__/weatherContext.test.ts src/hooks/__tests__/useWeather.test.js` (mobile) → 15/15 pass
- `recommendFromBalance` direct invocation: 5 surplus tiers × {hot,rainy,pleasant,none} = 20 runs, output identical → `applyWeather` confirmed dead (no test caught it; `tests/recommendationEngine.test.js:47` assertion is tautological)
- Live Open-Meteo probe (read-only): returns `temperature_2m`, `precipitation`, `weather_code` as parsed
