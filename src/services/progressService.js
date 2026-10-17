const { httpError } = require('../lib/errors');
const DAY = 86400000;
function progressRange({ from, to, timeZone = 'UTC' }) {
  const valid = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
  if (!valid(from) || !valid(to)) throw httpError(400, 'Valid from and to dates are required');
  const count = (Date.parse(to) - Date.parse(from)) / DAY + 1;
  if (count < 1 || count > 180) throw httpError(400, 'Choose 1 to 180 days');
  if (typeof timeZone !== 'string' || timeZone.length > 100) throw httpError(400, 'Invalid time zone');
  let formatter;
  try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }); }
  catch { throw httpError(400, 'Invalid time zone'); }
  const date = value => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  return { from, to, count, timeZone, date, start: new Date(Date.parse(from) - DAY), end: new Date(Date.parse(to) + 2 * DAY) };
}
function buildProgress(range, { meals = [], weights = [], water = [], steps = [], workouts = [] }) {
  const entries = Array.from({ length: range.count }, (_, i) => ({
    date: new Date(Date.parse(range.from) + i * DAY).toISOString().slice(0, 10), mealCount: 0,
    calories: null, protein: null, carbs: null, fat: null, fiber: null,
    weightKg: null, waterMl: null, steps: null, workouts: 0,
  }));
  const byDate = new Map(entries.map(x => [x.date, x]));
  for (const m of meals) {
    const day = byDate.get(range.date(m.loggedAt)); if (!day) continue;
    for (const [field, key] of [['calories', 'calories'], ['protein', 'proteinG'], ['carbs', 'carbsG'], ['fat', 'fatG'], ['fiber', 'fiberG']]) {
      day[field] = !Number.isFinite(m[key]) || (day.mealCount > 0 && day[field] === null) ? null : (day[field] || 0) + m[key];
    }
    day.mealCount++;
  }
  for (const w of weights) { const day = byDate.get(range.date(w.recordedAt)); if (day && Number.isFinite(w.weightKg)) day.weightKg = w.weightKg; }
  for (const w of water) { const day = byDate.get(range.date(w.loggedAt)); if (day && Number.isFinite(w.amountMl)) day.waterMl = (day.waterMl ?? 0) + w.amountMl; }
  // Steps.date already represents the reported calendar date, not an instant in the viewer's zone.
  // Older concurrent upserts can leave duplicate rows; max avoids counting the same device total twice.
  for (const s of steps) { const day = byDate.get(new Date(s.date).toISOString().slice(0, 10)); if (day && Number.isFinite(s.steps)) day.steps = Math.max(day.steps ?? 0, s.steps); }
  for (const w of workouts) { const day = byDate.get(range.date(w.startedAt)); if (day) day.workouts++; }
  return entries;
}
module.exports = { progressRange, buildProgress };
