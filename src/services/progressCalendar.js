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

// Same evidence rule colorFor uses: a real record (any component progress or
// earned points) — an all-gray day is missing data, not a poor day.
function componentsHaveEvidence(row) {
  const comps = Array.isArray(row?.components) ? row.components : [];
  return comps.some((c) => c.status === 'GOAL_MET' || c.status === 'IN_PROGRESS') || (row?.earned ?? 0) > 0;
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
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const pmKey = `${py}-${String(pm).padStart(2, '0')}`;
  const pmDays = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const [rows, prefs, lmRows] = await Promise.all([
    prisma.dailyProgressDay.findMany({ where: { userId, dayKey: { gte: `${y}-${String(m).padStart(2, '0')}-01`, lte: `${y}-${String(m).padStart(2, '0')}-${daysInMonth}` } } }),
    prisma.userPlanningPreferences.findUnique({ where: { userId }, select: { restDays: true, dailyTarget: true } }).catch(() => null),
    prisma.dailyProgressDay.findMany({ where: { userId, dayKey: { gte: `${pmKey}-01`, lte: `${pmKey}-${pmDays}` } } }),
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
      lastMonth: (() => {
        const le = lmRows.filter((r) => componentsHaveEvidence(r));
        const leAvg = le.length ? Math.round(le.reduce((a, r) => a + r.earned, 0) / le.length * 10) / 10 : null;
        return {
          month: pmKey, recorded: le.length, earned: le.reduce((a, r) => a + r.earned, 0), average: leAvg,
          daysMetTarget: le.filter((r) => colorFor(r, todayKey) === 'GREEN').length,
          deltaAvg: avg != null && leAvg != null ? Math.round((avg - leAvg) * 10) / 10 : null,
        };
      })(),
    },
    computedAt: now.toISOString(),
  };
}

function summarize(days, todayKey) {
  const rec = days.filter((d) => d.dayKey <= todayKey && d.earned != null);
  return {
    earned: rec.reduce((a, d) => a + d.earned, 0),
    target: days.reduce((a, d) => a + (d.target ?? 70), 0),
    targetToDate: rec.reduce((a, d) => a + (d.target ?? 70), 0),
    average: rec.length ? Math.round((rec.reduce((a, d) => a + d.earned, 0) / rec.length) * 10) / 10 : null,
    daysMetTarget: days.filter((d) => d.color === 'GREEN').length,
    recorded: rec.length,
  };
}

// Weekly adaptive-target review (P2): assigns the target for days going
// FORWARD — never rewrites history. Starter stays 70 until coverage exists;
// manual/paused modes are respected and never auto-changed.
const STARTER_TARGET = 70;
function weekKey(now) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3); // ISO week Thursday
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fDay = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fDay + 3);
  const week = 1 + Math.round((d - firstThu) / (7 * 86400e3));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function assignWeeklyTarget(userId, { tz, now = new Date(), force = false } = {}) {
  const zone = ld.resolveZone(tz);
  const wk = weekKey(now);
  const rows = await prisma.dailyProgressDay.findMany({ where: { userId }, orderBy: { dayKey: 'desc' }, take: 30 });
  const prefs = await prisma.userPlanningPreferences.upsert({ where: { userId }, create: { userId }, update: {} });
  const current = prefs.dailyTarget ?? STARTER_TARGET;
  if (!force && prefs.targetReviewedWeek === wk) {
    return { target: current, mode: prefs.targetMode, changed: false, reason: 'already_reviewed', week: wk };
  }
  if (prefs.targetMode === 'manual' || prefs.targetMode === 'paused') {
    return { target: current, mode: prefs.targetMode, changed: false, reason: 'user_controlled', week: wk };
  }
  const r = adaptiveTarget(rows, current);
  await prisma.userPlanningPreferences.update({ where: { userId }, data: { targetReviewedWeek: wk } });
  if (!r.changed) return { target: current, mode: prefs.dailyTarget ? 'adaptive' : 'starter', changed: false, reason: r.reason, week: wk };
  await prisma.userPlanningPreferences.update({ where: { userId }, data: { dailyTarget: r.target, targetMode: 'adaptive' } });
  return { target: r.target, previous: current, mode: 'adaptive', changed: true, reason: r.reason, blended: r.blended, avg7: r.avg7, avg30: r.avg30, week: wk };
}

// Week view (local Mon–Sun) + previous-week comparison. Comparisons state
// coverage honestly — a 2-day week is never read as a completed week.
async function week(userId, { tz, now = new Date() } = {}) {
  const zone = ld.resolveZone(tz);
  const todayKey = ld.dayKey(now, zone);
  const mon = new Date(`${todayKey}T00:00:00Z`);
  const wd = (mon.getUTCDay() + 6) % 7;
  mon.setUTCDate(mon.getUTCDate() - wd);
  const keys = [...Array(14)].map((_, i) => { const d = new Date(mon); d.setUTCDate(d.getUTCDate() + i - 7); return d.toISOString().slice(0, 10); });
  const rows = await prisma.dailyProgressDay.findMany({ where: { userId, dayKey: { in: keys } } });
  const byDay = Object.fromEntries(rows.map((r) => [r.dayKey, r]));
  const mk = (k) => { const r = byDay[k]; return { dayKey: k, weekday: new Date(`${k}T00:00:00Z`).getUTCDay(), earned: r?.earned ?? null, target: r?.dailyTarget ?? null, color: colorFor(r ? { ...r, dayKey: k } : null, todayKey), isToday: k === todayKey }; };
  const thisWeek = keys.slice(7).map(mk);
  const lastWeek = keys.slice(0, 7).map(mk);
  const tw = summarize(thisWeek, todayKey), lw = summarize(lastWeek, todayKey);
  return {
    weekStart: keys[7], weekEnd: keys[13], timezone: zone, days: thisWeek,
    summary: tw,
    lastWeek: { days: lastWeek, summary: lw },
    comparison: tw.average != null && lw.average != null
      ? { deltaAvg: Math.round((tw.average - lw.average) * 10) / 10, note: `This week is ${tw.recorded} of 7 recorded days; last week had ${lw.recorded}.` }
      : { deltaAvg: null, note: 'Not enough recorded days to compare weeks.' },
  };
}

module.exports = { calendar, week, adaptiveTarget, assignWeeklyTarget, weekKey, colorFor, COLOR_POLICY_VERSION, STARTER_TARGET };
