// Leo Score Calendar — month-level progress over authoritative V2 records.
// One bounded query per month; per-day targets persisted so historical days
// are judged against THEIR assigned target, never today's.
const { getPrisma } = require('../lib/prisma');
const ld = require('./localDay');
const prisma = new Proxy({}, { get: (_t, p) => getPrisma()[p] });

const COLOR_POLICY_VERSION = 1;
const NEAR = 0.8; // yellow band: >= 80% of target — configurable, versioned

// Day color from score vs the day's OWN assigned target.
function colorFor(day, todayKey) {
  if (!day) return 'GRAY';
  if (day.dayKey === todayKey) return 'TODAY';
  if (day.dayKey > todayKey) return 'GRAY'; // future — projected target only
  const comps = Array.isArray(day.components) ? day.components : [];
  const anyData = comps.some((c) => c.status === 'GOAL_MET' || c.status === 'IN_PROGRESS') || day.earned > 0;
  if (!anyData) return 'GRAY'; // missing data ≠ bad day
  const target = day.dailyTarget ?? 70;
  if (day.earned >= target) return 'GREEN';
  if (day.earned >= target * NEAR) return 'YELLOW';
  return 'RED';
}

// Adaptive daily target (§9): 0.6·avg7 + 0.4·avg30, round to 5, ±5 weekly,
// coverage-gated. Pure heuristic — not medical.
function adaptiveTarget(days, current = 70) {
  const eligible = (ds) => ds.filter((d) => d.earned > 0 || (Array.isArray(d.components) && d.components.some((c) => c.status === 'GOAL_MET' || c.status === 'IN_PROGRESS')));
  const last7 = eligible(days.slice(0, 7)), last30 = eligible(days.slice(0, 30));
  const avg = (ds) => ds.length ? ds.reduce((a, d) => a + d.earned, 0) / ds.length : null;
  const a7 = avg(last7), a30 = avg(last30);
  if (last7.length < 5 || last30.length < 14) return { target: current, changed: false, reason: 'insufficient_coverage', eligible7: last7.length, eligible30: last30.length };
  const blended = Math.round((0.6 * a7 + 0.4 * a30) / 5) * 5;
  const delta = Math.max(-5, Math.min(5, blended - current)); // never swing >5/wk
  const target = Math.min(90, Math.max(10, current + delta));
  return { target, changed: target !== current, reason: target > current ? 'increase' : target < current ? 'decrease' : 'steady', blended, avg7: Math.round(a7 * 10) / 10, avg30: Math.round(a30 * 10) / 10 };
}

async function calendar(userId, { month, tz, now = new Date() } = {}) {
  const zone = ld.resolveZone(tz);
  const todayKey = ld.dayKey(now, zone);
  const [y, m] = (month || todayKey.slice(0, 7)).split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const [rows, prefs] = await Promise.all([
    prisma.dailyProgressDay.findMany({ where: { userId, dayKey: { gte: `${y}-${String(m).padStart(2, '0')}-01`, lte: `${y}-${String(m).padStart(2, '0')}-${daysInMonth}` } } }),
    prisma.userPlanningPreferences.findUnique({ where: { userId }, select: { restDays: true } }).catch(() => null),
  ]);
  const byDay = Object.fromEntries(rows.map((d) => [d.dayKey, d]));
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const k = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const row = byDay[k];
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    days.push({
      dayKey: k, weekday, isToday: k === todayKey, future: k > todayKey,
      restDay: (prefs?.restDays || []).includes(weekday),
      earned: row?.earned ?? null, target: row?.dailyTarget ?? null,
      version: row?.version ?? null,
      color: k <= todayKey ? colorFor(row ? { ...row, dayKey: k } : null, todayKey) : 'GRAY',
      qualified: row ? undefined : undefined, // streak qualification surfaced via /progress-coach/streak
    });
  }
  const elapsed = days.filter((d) => d.dayKey <= todayKey && d.earned != null);
  const earned = elapsed.reduce((a, d) => a + d.earned, 0);
  const metTarget = days.filter((d) => d.color === 'GREEN').length;
  const avg = elapsed.length ? Math.round((earned / elapsed.length) * 10) / 10 : null;
  return {
    month: `${y}-${String(m).padStart(2, '0')}`, timezone: zone, colorPolicy: COLOR_POLICY_VERSION, nearThreshold: NEAR,
    days,
    summary: {
      daysInMonth, recorded: elapsed.length, earned,
      targetToDate: elapsed.reduce((a, d) => a + (d.target ?? 70), 0),
      monthlyTarget: days.reduce((a, d) => a + (d.target ?? 70), 0),
      average: avg, daysMetTarget: metTarget, gray: days.filter((d) => d.color === 'GRAY' && d.dayKey <= todayKey).length,
    },
    computedAt: now.toISOString(),
  };
}

module.exports = { calendar, adaptiveTarget, colorFor, COLOR_POLICY_VERSION };
