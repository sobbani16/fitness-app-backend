// Progress Coach — actionable opportunities derived from REAL Daily Progress
// V2 component deficits (never arbitrary "+5 points"), plus a consistency
// streak computed from persisted V2 day records. Deterministic; Leo may
// explain these objects but never invents points.
const { getPrisma } = require('../lib/prisma');
const { computeDay, CALC_VERSION } = require('./dailyProgress');
const ld = require('./localDay');

const prisma = new Proxy({}, { get: (_t, p) => getPrisma()[p] });

const TEMPLATES = {
  nutrition: { type: 'LOG_MEAL', title: 'Log a meal you ate', next: 'LogMeal', explains: 'Based on your remaining nutrition goal' },
  hydration: { type: 'LOG_WATER', title: 'Log water you\u2019ve consumed', next: 'Dashboard', explains: 'Based on your remaining hydration goal' },
  activity: { type: 'COMPLETE_WORKOUT', title: 'Complete your planned activity', next: 'LogExercise', explains: 'Based on today\u2019s activity plan' },
  sleep: null, // sleep is retrospective — no actionable same-day push
  habits: { type: 'COMPLETE_HABIT', title: 'Complete one of your habits', next: 'MindHome', explains: 'Based on habits you chose' },
  planActions: { type: 'PLAN_ACTION', title: 'Finish a planned action', next: 'DailyProgressDetail', explains: 'Based on your coach plan' },
};

// Projected points = recompute the component as if the action were done,
// clamped to that component's remaining applicable budget. No overlaps: each
// opportunity is tied to exactly one component's remaining points.
function opportunity(component, progress, tz) {
  const t = TEMPLATES[component.key];
  if (!t || component.status === 'NOT_APPLICABLE' || component.status === 'GOAL_MET') return null;
  const remaining = Math.round((component.applicable - component.earned) * 10) / 10;
  if (remaining <= 0.5) return null;
  const projected = Math.min(remaining, component.applicable); // completing fully = remaining budget
  return {
    id: `${progress.dayKey}|${component.key}`,
    component: component.key,
    actionType: t.type,
    title: t.title,
    explanation: `${t.explains} · ${component.note || ''}`.trim(),
    remainingPoints: remaining,
    projectedPoints: Math.round(projected * 10) / 10,
    version: CALC_VERSION,
    assumptions: `Completing this component's goal raises ${component.key} progress to 100% of its ${component.applicable}-pt applicable weight`,
    confidence: component.status === 'INSUFFICIENT_DATA' ? 'low' : 'medium',
    status: 'AVAILABLE',
    expiresAt: null,
    suggestedNext: t.next,
    requiresConfirmation: true,
    requiresTrainerApproval: false,
    timezone: tz,
  };
}

// Rank by relevance, not raw points: actionable-now first, then feasible
// (small remaining budget = quick win), dedup by component.
function rank(opps, nowLocalMinutes) {
  const hour = nowLocalMinutes / 60;
  const score = (o) => {
    let s = 0;
    if (o.component === 'nutrition') s += hour >= 10 && hour <= 21 ? 30 : 0; // sensible meal window
    if (o.component === 'hydration') s += hour >= 7 && hour <= 22 ? 20 : 0;
    if (o.component === 'activity') s += hour >= 6 && hour <= 20 ? 20 : -40; // no late-night workout push
    if (o.component === 'habits' || o.component === 'planActions') s += 15;
    s += Math.min(o.projectedPoints, 20); // smaller tiebreak, never dominant
    return s;
  };
  return [...opps].sort((a, b) => score(b) - score(a));
}

async function opportunities(userId, { tz, now = new Date() } = {}) {
  const progress = await computeDay(userId, { tz, now, persist: false });
  const zone = progress.timezone;
  const mins = ld.localParts(now, zone).minutes;
  const opps = progress.components.map((c) => opportunity(c, progress, zone)).filter(Boolean);
  return { dayKey: progress.dayKey, earned: progress.earned, applicable: progress.applicable, version: CALC_VERSION, top: rank(opps, mins).slice(0, 3), all: rank(opps, mins) };
}

// --- Consistency streak: sustainable participation, not perfection.
// A day qualifies when earned >= QUALIFY_FRACTION of applicable OR an
// applicable component hit GOAL_MET (incl. honored rest days). Transparent,
// plan-relative, and never requires 100/100.
const QUALIFY_FRACTION = 0.5;
const PAUSE_REASONS = new Set(['illness', 'travel', 'rest', 'other']);

async function streak(userId, { tz, now = new Date() } = {}) {
  const zone = ld.resolveZone(tz);
  const todayKey = ld.dayKey(now, zone);
  const [days, prefs] = await Promise.all([
    prisma.dailyProgressDay.findMany({ where: { userId }, orderBy: { dayKey: 'desc' }, take: 120 }),
    prisma.userStreakPreferences?.findUnique?.({ where: { userId } }).catch?.(() => null) ?? null,
  ]);
  const paused = prefs?.pausedUntil && new Date(prefs.pausedUntil) > now;
  const qualified = new Set();
  const byDay = Object.fromEntries(days.map((d) => [d.dayKey, d]));
  for (const d of days) {
    const comps = Array.isArray(d.components) ? d.components : [];
    const anyMet = comps.some((c) => c.status === 'GOAL_MET' || c.status === 'GOAL_MET'.toLowerCase());
    const frac = d.applicable > 0 ? d.earned / d.applicable : 0;
    if (frac >= QUALIFY_FRACTION || anyMet) qualified.add(d.dayKey);
  }
  // Walk back from today (or yesterday if today not yet qualified) allowing
  // one grace day per 7 — pause days neither break nor extend.
  let current = 0;
  const cursor = new Date(`${todayKey}T00:00:00Z`);
  const pauseDays = new Set((prefs?.pauseDays || []));
  let graceUsed = 0;
  for (let i = 0; i < 400; i++) {
    const k = cursor.toISOString().slice(0, 10);
    if (qualified.has(k)) { current++; }
    else if (pauseDays.has(k) || paused) { /* paused: skip without breaking */ }
    else if (i === 0) { /* today may still be in progress — check yesterday */ }
    else if (graceUsed < 1 && byDay[k]) { graceUsed++; }
    else break;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  let longest = 0, run = 0;
  const sorted = days.map((d) => d.dayKey).sort();
  for (const k of sorted) { run = qualified.has(k) ? run + 1 : 0; longest = Math.max(longest, run); }
  const todayMet = qualified.has(todayKey);
  return {
    current, longest, todayKey, todayQualified: todayMet,
    qualifyRule: `Day qualifies at ${Math.round(QUALIFY_FRACTION * 100)}% of applicable points or any completed goal — rest days count`,
    paused: Boolean(paused), history: days.slice(0, 30).map((d) => ({ dayKey: d.dayKey, earned: d.earned, qualified: qualified.has(d.dayKey) })),
    explanation: todayMet ? 'Today\u2019s consistency goal is met' : current > 0 ? 'One more planned action could complete today\u2019s consistency goal' : 'You can start your consistency today',
  };
}

module.exports = { opportunities, streak, QUALIFY_FRACTION };
