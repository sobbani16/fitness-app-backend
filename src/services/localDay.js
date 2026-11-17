// Canonical timezone-aware local-day infrastructure. ONE place for:
// day keys, timezone resolution, 12h/24h conversion, DST-safe wall times.
// Event instants are always UTC; day keys are user-local. The server's own
// timezone never determines a member's day.
const { localParts, parseHHMM, wallTimeToUtc, inQuietHours, formatMinutes } = require('./reminders/time');

const IANA_RE = /^[A-Za-z_]+\/[A-Za-z_\-/]+$|^UTC$/;

function isValidZone(tz) {
  if (!tz || !IANA_RE.test(tz)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Effective zone for a user: explicit tz argument > user.timeZone > 'UTC'. */
function resolveZone(userTz, fallbackTz) {
  if (isValidZone(userTz)) return userTz;
  if (isValidZone(fallbackTz)) return fallbackTz;
  return 'UTC';
}

/** YYYY-MM-DD day key of an instant in a zone. */
function dayKey(instant, tz) {
  return localParts(new Date(instant), resolveZone(tz)).dateKey;
}

/** Inclusive [startUtc, endUtc) UTC bounds of a local day — DST safe. */
function dayRangeUtc(dayKeyStr, tz) {
  const start = wallTimeToUtc(dayKeyStr, 0, resolveZone(tz));
  const next = new Date(Date.parse(dayKeyStr + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const end = wallTimeToUtc(next, 0, resolveZone(tz));
  return { startUtc: start, endUtc: end };
}

/** The local day a just-ended sleep "belongs" to: the wake (end) day's key. */
function sleepAttributionDay(sleepEnd, tz) {
  return dayKey(sleepEnd, tz);
}

/** Previous-night sleep window: from previous day 12:00 to today 12:00 local. */
function lastNightRangeUtc(dayKeyStr, tz) {
  const { startUtc } = dayRangeUtc(dayKeyStr, tz);
  const noon = wallTimeToUtc(dayKeyStr, 12 * 60, resolveZone(tz));
  const prevKey = new Date(startUtc.getTime() - 86400000).toISOString().slice(0, 10);
  const prevNoon = wallTimeToUtc(dayKeyStr === prevKey ? dayKeyStr : prevKey, 12 * 60, resolveZone(tz));
  return { startUtc: prevNoon, endUtc: noon };
}

/** 12-hour input → canonical "HH:mm" (null on invalid). Handles "8:00 AM",
 * "12:30 pm", {hour, minute, period}. Noon/midnight are disambiguated. */
function to24h(value) {
  if (value && typeof value === 'object') {
    const h = Number(value.hour), m = Number(value.minute);
    const p = String(value.period || '').toUpperCase();
    if (!(h >= 1 && h <= 12) || !(m >= 0 && m <= 59) || !['AM', 'PM'].includes(p)) return null;
    const h24 = p === 'AM' ? (h === 12 ? 0 : h) : (h === 12 ? 12 : h + 12);
    return `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const s = String(value || '').trim();
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec(s);
  if (m) return to24h({ hour: m[1], minute: m[2], period: m[3] });
  return parseHHMM(s) != null ? s : null;
}

/** "13:30" → { hour: 1, minute: 30, period: 'PM' } for 12h displays. */
function to12h(hhmm) {
  const mins = parseHHMM(hhmm);
  if (mins == null) return null;
  const h = Math.floor(mins / 60), m = mins % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  return { hour: h % 12 === 0 ? 12 : h % 12, minute: m, period, display: `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${period}` };
}

module.exports = { isValidZone, resolveZone, dayKey, dayRangeUtc, lastNightRangeUtc, sleepAttributionDay, to24h, to12h, localParts, parseHHMM, wallTimeToUtc, inQuietHours, formatMinutes };
