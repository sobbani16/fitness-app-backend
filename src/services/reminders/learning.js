const { MIN_OBSERVATIONS, DEFAULTS } = require('./constants');
const { localParts, formatMinutes } = require('./time');

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round15(minutes) {
  return Math.round(minutes / 15) * 15 % 1440;
}

function uniqueDates(rows, tz) {
  const dates = new Set();
  for (const row of rows) dates.add(localParts(new Date(row.at), tz).dateKey);
  return [...dates].sort();
}

// Groups timestamped rows by weekday/weekend so shift patterns and weekend
// habits are learned separately. Returns at most one pattern per split.
function splitPatterns(rows, tz) {
  const splits = { weekday: [], weekend: [] };
  for (const row of rows) {
    const lp = localParts(new Date(row.at), tz);
    (lp.isWeekend ? splits.weekend : splits.weekday).push({ at: row.at, minutes: lp.minutes, dateKey: lp.dateKey });
  }
  const patterns = [];
  for (const [kind, samples] of Object.entries(splits)) {
    const dates = [...new Set(samples.map(s => s.dateKey))].sort();
    if (dates.length < MIN_OBSERVATIONS) continue;
    patterns.push({
      kind,
      observations: dates.length,
      dates,
      typicalMinutes: round15(median(samples.map(s => s.minutes))),
    });
  }
  return patterns;
}

// Typical local logging time per meal type. Missing days are skipped, never
// counted as evidence of anything.
function analyzeMeals(foodLogs, tz) {
  const byType = {};
  for (const log of foodLogs) {
    if (!log.mealType || !log.loggedAt) continue;
    (byType[log.mealType] = byType[log.mealType] || []).push({ at: log.loggedAt });
  }
  const out = {};
  for (const [type, rows] of Object.entries(byType)) out[type] = splitPatterns(rows, tz);
  return out;
}

// Median gap between consecutive same-day water logs. Gaps across days are not
// intervals — a user logging at 9 PM then 7 AM did not wait 10 hours.
function analyzeWater(waterLogs, tz) {
  const byDay = {};
  for (const log of waterLogs) {
    const lp = localParts(new Date(log.loggedAt), tz);
    (byDay[lp.dateKey] = byDay[lp.dateKey] || []).push(lp.minutes);
  }
  const intervals = [];
  const days = [];
  for (const [dateKey, minutes] of Object.entries(byDay)) {
    const sorted = minutes.sort((a, b) => a - b);
    let used = false;
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = sorted[i] - sorted[i - 1];
      if (gap >= 30) { intervals.push(gap); used = true; }
    }
    if (used) days.push(dateKey);
  }
  if (days.length < MIN_OBSERVATIONS) return null;
  return { observations: days.length, dates: days.sort(), intervalMinutes: round15(median(intervals)) };
}

// Typical taken-time per supplement (SupplementLog rows).
function analyzeSupplements(supplementLogs, tz) {
  const byName = {};
  for (const log of supplementLogs) (byName[log.supplementName] = byName[log.supplementName] || []).push({ at: log.loggedAt });
  const out = {};
  for (const [name, rows] of Object.entries(byName)) out[name] = splitPatterns(rows, tz);
  return out;
}

// Turns analysis into suggestion payloads. Always a proposal — never a
// schedule. `existing` lists active pending/accepted suggestion categories and
// manually configured categories so we don't reprompt what the user already
// controls or already has queued.
function buildSuggestions({ meals, water, supplements }, existing = new Set()) {
  const out = [];
  for (const [type, patterns] of Object.entries(meals || {})) {
    for (const p of patterns) {
      const category = `meal:${type}`;
      if (existing.has(`${category}:${p.kind}`)) continue;
      const typical = formatMinutes(p.typicalMinutes);
      const remindAt = formatMinutes((p.typicalMinutes + DEFAULTS.mealDelayMinutes) % 1440);
      out.push({
        category,
        title: `Remind me about ${type}?`,
        body: `You've logged ${type} around ${typical} on ${p.observations} ${p.kind} day${p.observations === 1 ? '' : 's'}. A reminder at ${remindAt} would only appear when nothing is logged.`,
        proposed: {
          times: [remindAt],
          daysOfWeek: p.kind === 'weekend' ? [0, 6] : [1, 2, 3, 4, 5],
          delayMinutes: DEFAULTS.mealDelayMinutes,
        },
        evidence: { observations: p.observations, dates: p.dates, typicalTime: typical, pattern: p.kind },
      });
    }
  }
  if (water && !existing.has('water')) {
    out.push({
      category: 'water',
      title: 'Adjust your water reminder interval?',
      body: `Across ${water.observations} days with multiple logs, your typical gap between drinks was about ${water.intervalMinutes} minutes.`,
      proposed: { intervalMinutes: water.intervalMinutes },
      evidence: { observations: water.observations, dates: water.dates, intervalMinutes: water.intervalMinutes },
    });
  }
  for (const [name, patterns] of Object.entries(supplements || {})) {
    for (const p of patterns) {
      const key = `supplement:${name}:${p.kind}`;
      if (existing.has(key)) continue;
      const typical = formatMinutes(p.typicalMinutes);
      out.push({
        category: 'supplement',
        title: `Move your ${name} reminder?`,
        body: `You logged ${name} around ${typical} on ${p.observations} ${p.kind} days. Move the reminder to ${typical}?`,
        proposed: { times: [typical], daysOfWeek: p.kind === 'weekend' ? [0, 6] : [1, 2, 3, 4, 5], supplementName: name },
        evidence: { observations: p.observations, dates: p.dates, typicalTime: typical, pattern: p.kind, supplementName: name },
      });
    }
  }
  return out;
}

module.exports = { analyzeMeals, analyzeWater, analyzeSupplements, buildSuggestions, uniqueDates };
