const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Local wall-clock parts of `date` in an IANA zone. Falls back to UTC when the
// stored timezone is missing or invalid rather than throwing inside a tick.
function localParts(date, timeZone) {
  let tz = timeZone || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'UTC'; }
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  const weekday = WEEKDAY_INDEX[parts.weekday];
  const minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  return { minutes, weekday, isWeekend: weekday === 0 || weekday === 6, dateKey: `${parts.year}-${parts.month}-${parts.day}` };
}

function parseHHMM(value) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function formatMinutes(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// Handles ranges that wrap midnight (22:00 -> 07:00 covers 23:30 and 06:00).
function inQuietHours(minutes, start, end) {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s == null || e == null) return false;
  if (s === e) return true;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

// Converts a local wall time (dateKey + minutes) in `tz` to a UTC instant by
// converging on the offset. Nonexistent local times (spring-forward) land on
// the nearest real instant; deterministic, no tz library required.
function wallTimeToUtc(dateKey, minutes, tz) {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const desired = Date.UTC(y, mo - 1, d, 0, minutes, 0);
  let guess = desired;
  for (let i = 0; i < 3; i += 1) {
    const lp = localParts(new Date(guess), tz);
    const [ay, amo, ad] = lp.dateKey.split('-').map(Number);
    const actual = Date.UTC(ay, amo - 1, ad, 0, lp.minutes, 0);
    const diff = desired - actual;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

module.exports = { localParts, parseHHMM, formatMinutes, inQuietHours, wallTimeToUtc };
