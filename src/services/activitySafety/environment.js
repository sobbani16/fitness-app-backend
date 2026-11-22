// Environmental suitability — evaluates a normalized EnvironmentalObservation
// against an activity's exposure. Bands follow NWS heat-index / wind-chill and
// EPA AQI guidance (see docs/clinical/activity-safety-evidence-register.md §B.11).
// Missing or stale data is never treated as "safe": outdoor activities with
// unverifiable conditions yield INSUFFICIENT_DATA.

const { DECISIONS: D, DECISION_RANK, ENV_HAZARDS: H, THUNDER_CODES } = require('./constants');

// Sensitive-group flags (profile-side) that tighten AQI/heat/cold bands.
const AQI_SENSITIVE_FLAGS = ['asthma', 'eib', 'copd', 'cad', 'heart_failure', 'arrhythmia', 'pregnancy', 'diabetes_t1', 'diabetes_t2'];
const HEAT_SENSITIVE_FLAGS = ['pregnancy', 'ms', 'diabetes_t1', 'diabetes_t2', 'obesity', 'heart_failure', 'cad'];
const COLD_SENSITIVE_FLAGS = ['cad', 'hypertension', 'asthma'];

function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

// --- hazard extraction ------------------------------------------------------

function detectHazards(env, profileFlags) {
  const hazards = [];
  const reasons = [];
  const sensitive = new Set(profileFlags || []);
  const aqiSensitive = AQI_SENSITIVE_FLAGS.some(f => sensitive.has(f)) || sensitive.has('age_65_plus');
  const heatSensitive = HEAT_SENSITIVE_FLAGS.some(f => sensitive.has(f)) || sensitive.has('age_65_plus')
    || (sensitive.has('med_flags') && sensitive.has('heat_sensitivity'));
  const coldSensitive = COLD_SENSITIVE_FLAGS.some(f => sensitive.has(f));

  const code = num(env.weatherCode);
  const alertText = (env.alerts || []).map(a => `${a.event || ''} ${a.severity || ''}`.toLowerCase()).join(' ');
  if ((code != null && THUNDER_CODES.includes(code)) || /thunder|lightning/.test(alertText)) {
    hazards.push(H.THUNDERSTORM);
    reasons.push('Thunderstorm risk present — exposed outdoor activity is deferred (NWS lightning guidance).');
  }
  if (env.alerts && env.alerts.length > 0 && /warning|emergency|extreme|severe|tornado|hurricane|flood|blizzard|ice/.test(alertText)) {
    hazards.push(H.SEVERE_ALERT);
    reasons.push('Active severe-weather alert for this area.');
  }

  const aqi = env.aqi && num(env.aqi.value);
  if (aqi != null) {
    if (aqi >= 201) { hazards.push(H.AQI_HAZARDOUS); reasons.push(`AQI ${aqi} (very unhealthy/hazardous) — outdoor exertion deferred per EPA guidance.`); }
    else if (aqi >= 151) { hazards.push(H.AQI_UNHEALTHY); reasons.push(`AQI ${aqi} (unhealthy) — outdoor exertion deferred per EPA guidance.`); }
    else if (aqi >= 101) {
      if (aqiSensitive) { hazards.push(H.AQI_USG); reasons.push(`AQI ${aqi} is unhealthy for sensitive groups — your profile flags elevated sensitivity.`); }
    }
  }

  const apparent = num(env.apparentTempC) ?? num(env.tempC);
  if (apparent != null) {
    if (apparent >= 40.5) { hazards.push(H.HEAT_DANGER); reasons.push('Heat index in the NWS danger range — outdoor exertion deferred.'); }
    else if (apparent >= 35 && heatSensitive) { hazards.push(H.HEAT_SENSITIVE_DANGER); reasons.push('Heat index ≥35 °C with your heat-sensitivity flags — outdoor exertion deferred.'); }
    else if (apparent >= 32) { hazards.push(H.HEAT_EXTREME_CAUTION); reasons.push('Heat index ≥32 °C (NWS extreme-caution band) — heat illness is possible with prolonged exertion; prefer cooler hours or indoor.'); }
    else if (apparent >= 28 && heatSensitive) { hazards.push(H.HEAT_CAUTION); reasons.push('Heat index ≥28 °C with your heat-sensitivity flags — modify timing/intensity.'); }
    else if (apparent <= -18) { hazards.push(H.COLD_DANGER); reasons.push('Extreme cold / wind-chill danger range — outdoor exposure deferred.'); }
    else if (apparent <= -7) {
      const windy = (num(env.windSpeedKmh) || 0) >= 20 || (num(env.windGustsKmh) || 0) >= 30;
      const wet = (num(env.precipitationMm) || 0) > 0 || (code != null && code >= 51);
      if (windy || wet) { hazards.push(H.COLD_CAUTION); reasons.push('Cold with wind/precipitation raises exposure risk — modify timing/coverage.'); }
      else if (coldSensitive) { hazards.push(H.COLD_CAUTION); reasons.push('Cold exposure flagged against your cardiovascular/respiratory profile.'); }
    }
  }

  const uv = num(env.uvIndex);
  if (uv != null && uv >= 8) { hazards.push(H.UV_EXTREME); reasons.push('UV index very high/extreme — timing and shade matter.'); }
  else if (uv != null && uv >= 6) hazards.push(H.UV_VERY_HIGH);

  const gusts = num(env.windGustsKmh);
  if (gusts != null && gusts >= 50) { hazards.push(H.HIGH_WIND); reasons.push('High wind gusts — debris and balance risk outdoors.'); }

  const precip = num(env.precipitationMm);
  if ((precip != null && precip >= 5) || (code != null && [96, 97, 98, 99].includes(code))) {
    hazards.push(H.HEAVY_PRECIP); reasons.push('Heavy precipitation — footing and visibility risk.');
  }

  return { hazards, reasons };
}

// --- per-hazard outdoor disposition -----------------------------------------

const HAZARD_OUTDOOR_DECISION = {
  [H.THUNDERSTORM]: D.DEFER_OUTDOOR,
  [H.SEVERE_ALERT]: D.DEFER_OUTDOOR,
  [H.HEAT_DANGER]: D.DEFER_OUTDOOR,
  [H.HEAT_SENSITIVE_DANGER]: D.DEFER_OUTDOOR,
  [H.HEAT_EXTREME_CAUTION]: D.MODIFY,
  [H.HEAT_CAUTION]: D.MODIFY,
  [H.COLD_DANGER]: D.DEFER_OUTDOOR,
  [H.AQI_HAZARDOUS]: D.DEFER_OUTDOOR,
  [H.AQI_UNHEALTHY]: D.DEFER_OUTDOOR,
  [H.AQI_USG]: D.MODIFY,
  [H.COLD_CAUTION]: D.MODIFY,
  [H.UV_EXTREME]: D.MODIFY,
  [H.UV_VERY_HIGH]: D.MODIFY,
  [H.HIGH_WIND]: D.MODIFY,
  [H.HEAVY_PRECIP]: D.MODIFY,
};

// --- better-time suggestion --------------------------------------------------

// Scan the short-term forecast for the first hour where the *blocking* hazards
// clear. Only hazards that were actually blocking are retested; missing
// forecast data never produces a time claim.
function findBetterTime(env, blockingHazards) {
  const fc = Array.isArray(env.forecast) ? env.forecast : [];
  if (!fc.length || !blockingHazards.length) return null;
  // AQI/alerts have no per-hour forecast in the current payload — a time
  // claim for those hazards would be invented. Skip suggesting entirely.
  const unresolvable = blockingHazards.some(h => [H.AQI_HAZARDOUS, H.AQI_VERY_UNHEALTHY, H.AQI_UNHEALTHY, H.AQI_USG, H.SEVERE_ALERT, H.UV_EXTREME, H.UV_VERY_HIGH, H.HIGH_WIND].includes(h));
  if (unresolvable) return null;
  for (const hour of fc) {
    const t = num(hour.apparentTempC) ?? num(hour.tempC);
    const code = num(hour.weatherCode);
    const clear =
      !(blockingHazards.includes(H.THUNDERSTORM) && code != null && THUNDER_CODES.includes(code)) &&
      !(blockingHazards.includes(H.HEAT_DANGER) && t != null && t >= 40.5) &&
      !(blockingHazards.includes(H.HEAT_SENSITIVE_DANGER) && t != null && t >= 35) &&
      !(blockingHazards.includes(H.HEAT_EXTREME_CAUTION) && t != null && t >= 32) &&
      !(blockingHazards.includes(H.HEAT_CAUTION) && t != null && t >= 28) &&
      !(blockingHazards.includes(H.COLD_DANGER) && t != null && t <= -18) &&
      !(blockingHazards.includes(H.HEAVY_PRECIP) && (num(hour.precipitationProbabilityPct) || 0) >= 70);
    if (clear && hour.time) return { time: hour.time };
  }
  return null;
}

/**
 * evaluateEnvironment(env, activity, profileFlags)
 * env: normalized observation (see routes/weather v2 / tests fixtures).
 * activity: catalog entry — only outdoor-exposed activities are gated.
 * profileFlags: condition/profile flags (asthma, pregnancy, ms, age_65_plus,
 *               med flag keys like 'heat_sensitivity').
 */
function evaluateEnvironment(env, activity, profileFlags) {
  const exposes = activity && activity.demands && activity.demands.categories.includes('outdoor_exposed');
  const dim = { status: 'not_applicable', hazards: [], reasons: [], requiredData: [], betterTime: null };
  if (!exposes) return dim;
  dim.status = 'ok';

  if (!env || env.available === false) {
    return { ...dim, status: 'unknown', decision: D.INSUFFICIENT_DATA, decisions: [D.INSUFFICIENT_DATA],
      requiredData: ['environmental_observation'],
      reasons: ['Weather data unavailable — outdoor conditions cannot be verified. No outdoor-safety claim is made.'] };
  }
  if (env.stale) {
    return { ...dim, status: 'stale', decision: D.INSUFFICIENT_DATA, decisions: [D.INSUFFICIENT_DATA],
      requiredData: ['fresh_environmental_observation'],
      reasons: ['Weather data is stale — cannot verify current conditions. No outdoor-safety claim is made.'] };
  }

  const { hazards, reasons } = detectHazards(env, profileFlags);
  dim.hazards = hazards;
  dim.reasons = reasons;

  let decision = D.ALLOW;
  const blocking = [];
  for (const h of hazards) {
    const d = HAZARD_OUTDOOR_DECISION[h];
    if (!d) continue;
    if (d === D.DEFER_OUTDOOR) blocking.push(h);
    if (DECISION_RANK[d] > DECISION_RANK[decision]) decision = d;
  }
  // alerts field unavailable ≠ no alerts — when the provider can't tell us,
  // thunderstorm inference still runs on codes; note the gap.
  if (env.alertsAvailable === false) dim.requiredData.push('severe_weather_alerts');

  dim.decision = decision;
  dim.decisions = decision === D.ALLOW ? [] : [decision];
  if (decision !== D.ALLOW) dim.betterTime = findBetterTime(env, blocking.length ? blocking : hazards);
  return dim;
}

module.exports = { evaluateEnvironment, detectHazards, findBetterTime, AQI_SENSITIVE_FLAGS, HEAT_SENSITIVE_FLAGS, COLD_SENSITIVE_FLAGS };
