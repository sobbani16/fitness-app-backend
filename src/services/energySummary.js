// EnergySummaryService — the single backend-owned source for "calories in vs
// out". Mobile and web both render this structure so numbers always agree.
//
// Terminology contract (do not interchange):
//   BMR            profile-based basal estimate (Mifflin-St Jeor) — an estimate,
//                  never presented as a measurement.
//   resting energy wearable-reported basal/resting kcal over a time interval —
//                  a device measurement, reported with its coverage window.
//   active energy  movement-related kcal over an interval. Wearable "workout"
//                  calories are typically already inside it — never add both.
//   TDEE           BMR * activity-factor — a full-day FORECAST that already
//                  includes routine movement. Exercise is not added on top.
//   expended so far   measured or estimated kcal for elapsed local time.
//   projected day     full-day forecast (actual so far + baseline remainder).
//   logged intake     recorded food kcal — potentially incomplete, never a
//                  confirmed total intake and never a confirmed deficit.
//
// Source precedence (never blindly summed across providers):
//   1. wearable provider with the most covered interval-minutes for the day
//   2. same/other provider's resting records for resting energy
//   3. profile estimate (Mifflin-St Jeor + activity factor)
//   4. explicit null — missing data is reported, not zeroed
//
// Time handling: all day boundaries are resolved in the user's IANA timezone
// via Intl — DST transitions naturally produce 23h/25h days because elapsed
// fractions are computed on instants, not wall-clock hours.

const { calculateBMR, calculateTDEE, ACTIVITY_FACTORS } = require('./calorieEngine');

const ALGORITHM_VERSION = 'energy-v1';
const PROVIDER_ORDER = ['healthkit', 'health_connect', 'fitbit'];
const STALE_SYNC_MS = 26 * 3600000;
const MS_MIN = 60000;

// ---------- timezone helpers (no dependency — Intl-based, DST-correct) ------

function tzOffsetMs(timeZone, instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  const asUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour === 24 ? 0 : +m.hour, +m.minute, +m.second);
  return asUtc - instant.getTime();
}

function nextDateStr(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// UTC instants of local midnight → next local midnight for `dateStr` in `tz`.
// Converges in <=3 iterations even across DST transitions.
function localDayBounds(dateStr, timeZone) {
  function localMidnight(str) {
    const L = Date.parse(`${str}T00:00:00Z`); // local midnight expressed as if UTC
    let guess = L;
    for (let i = 0; i < 4; i++) guess = L - tzOffsetMs(timeZone, new Date(guess));
    return guess;
  }
  const start = localMidnight(dateStr);
  const end = localMidnight(nextDateStr(dateStr));
  return { start: new Date(start), end: new Date(end) };
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`));
}

function isValidTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 100) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// ---------- interval dedup --------------------------------------------------

// Clip a record to [start,end); allocate its kcal proportionally across only
// the still-uncovered portion of its interval. Overlapping records from the
// same provider+metric therefore never double-count; different providers are
// never summed at all (the caller picks one provider per metric).
function dedupedKcal(records, kcalField, dayStartMs, dayEndMs) {
  const sorted = records
    .filter(r => Number.isFinite(r[kcalField]) && r[kcalField] > 0 && r.startAt < r.endAt)
    .map(r => ({ s: Math.max(r.startAt.getTime(), dayStartMs), e: Math.min(r.endAt.getTime(), dayEndMs), kcal: r[kcalField], span: r.endAt.getTime() - r.startAt.getTime() }))
    .filter(r => r.e > r.s)
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const covered = []; // disjoint [s,e) union, kept sorted
  let kcal = 0;
  let coveredMs = 0;
  for (const r of sorted) {
    let uncovered = r.e - r.s;
    for (const c of covered) {
      const ov = Math.min(r.e, c[1]) - Math.max(r.s, c[0]);
      if (ov > 0) uncovered -= ov;
    }
    if (uncovered <= 0) continue;
    kcal += r.kcal * (uncovered / Math.max(r.span, 1)); // allocate over the record's ORIGINAL span
    covered.push([r.s, r.e]);
    covered.sort((a, b) => a[0] - b[0]);
    // merge union for subsequent overlap checks
    for (let i = covered.length - 1; i > 0; i--) {
      if (covered[i][0] <= covered[i - 1][1]) { covered[i - 1][1] = Math.max(covered[i - 1][1], covered[i][1]); covered.splice(i, 1); }
    }
    coveredMs = covered.reduce((s, c) => s + (c[1] - c[0]), 0);
  }
  return { kcal, coveredMs };
}

// ---------- profile ----------------------------------------------------------

function profileFor(user) {
  const missing = [];
  const weightKg = user?.currentWeightKg;
  const heightCm = user?.heightCm;
  const sex = user?.gender === 'female' || user?.gender === 'male' ? user.gender : 'other';
  let age = null;
  if (user?.dateOfBirth) {
    age = Math.floor((Date.now() - new Date(user.dateOfBirth).getTime()) / (365.25 * 86400000));
  }
  if (!(weightKg > 0)) missing.push('weight');
  if (!(heightCm > 0)) missing.push('height');
  if (!(age > 0)) missing.push('dateOfBirth');
  if (missing.length) return { missing };
  try {
    const bmr = calculateBMR({ sex, weightKg, heightCm, age });
    const activityLevel = ACTIVITY_FACTORS[user.activityLevel] ? user.activityLevel : 'sedentary';
    const tdee = calculateTDEE(bmr, activityLevel);
    return { bmr, tdee, activityLevel, missing: [] };
  } catch { return { missing: ['profile'] }; }
}

// ---------- main -------------------------------------------------------------

async function getUserEnergySummary(prisma, userId, { date, timeZone, now = new Date() } = {}) {
  const [user, reminderPref, macroGoal] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, dateOfBirth: true, gender: true, heightCm: true, currentWeightKg: true,
        goalType: true, activityLevel: true, timeZone: true,
      },
    }),
    prisma.reminderPreference.findUnique({ where: { userId }, select: { timezone: true } }).catch(() => null),
    prisma.macroGoal.findUnique({ where: { userId }, select: { caloriesTarget: true, source: true } }).catch(() => null),
  ]);
  if (!user) return null;

  const tz = isValidTz(timeZone) ? timeZone : isValidTz(user.timeZone) ? user.timeZone
    : isValidTz(reminderPref?.timezone) ? reminderPref.timezone : 'UTC';
  const dateStr = isValidDate(date) ? date : new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const { start: dayStart, end: dayEnd } = localDayBounds(dateStr, tz);
  const dayMs = dayEnd - dayStart; // 23/24/25h across DST — elapsed math is on instants
  const isToday = now >= dayStart && now < dayEnd;
  const elapsedFrac = now <= dayStart ? 0 : now >= dayEnd ? 1 : (now - dayStart) / dayMs;

  const [records, foodLogs] = await Promise.all([
    prisma.healthEnergyRecord.findMany({
      where: { userId, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
      select: { provider: true, sourceId: true, startAt: true, endAt: true, activeKcal: true, restingKcal: true, syncedAt: true },
    }),
    prisma.foodLog.findMany({
      where: { userId, loggedAt: { gte: dayStart, lt: dayEnd } },
      select: { calories: true, loggedAt: true },
      orderBy: { loggedAt: 'desc' },
    }),
  ]);

  const lastSyncAt = records.reduce((m, r) => r.syncedAt > m ? r.syncedAt : m, null);
  const syncStale = lastSyncAt ? (now - lastSyncAt) > STALE_SYNC_MS : false;

  // Per-provider covered minutes decides which single provider reports "active".
  const byProvider = {};
  for (const r of records) {
    const p = r.provider;
    (byProvider[p] ||= []).push(r);
  }
  const providerActive = {};
  for (const [p, recs] of Object.entries(byProvider)) {
    providerActive[p] = dedupedKcal(recs, 'activeKcal', dayStart.getTime(), dayEnd.getTime());
  }
  const activeProvider = Object.entries(providerActive)
    .filter(([, v]) => v.coveredMs > MS_MIN)
    .sort((a, b) => b[1].coveredMs - a[1].coveredMs || PROVIDER_ORDER.indexOf(a[0]) - PROVIDER_ORDER.indexOf(b[0]))[0]?.[0] || null;

  // Resting: prefer the active-provider's resting records; else best-covered resting source.
  const providerResting = {};
  for (const [p, recs] of Object.entries(byProvider)) {
    providerResting[p] = dedupedKcal(recs.filter(r => r.restingKcal != null), 'restingKcal', dayStart.getTime(), dayEnd.getTime());
  }
  const restingProvider = activeProvider && providerResting[activeProvider]?.coveredMs > MS_MIN ? activeProvider
    : Object.entries(providerResting).filter(([, v]) => v.coveredMs > MS_MIN)
      .sort((a, b) => b[1].coveredMs - a[1].coveredMs)[0]?.[0] || null;

  const prof = profileFor(user);
  const estRestFull = prof.bmr ?? null;                       // BMR (estimate, full day)
  const estActiveFull = prof.tdee != null ? Math.max(prof.tdee - prof.bmr, 0) : null;

  // ---- resting ----
  let restingSoFar = null, restingFull = null, restingSource = null;
  if (restingProvider) {
    const r = providerResting[restingProvider];
    restingSoFar = r.kcal;
    // Extrapolate measured resting to a full day only over its covered window.
    restingFull = r.coveredMs > 0 ? r.kcal * (dayMs / r.coveredMs) : null;
    restingSource = `wearable:${restingProvider}`;
  } else if (estRestFull != null) {
    restingSoFar = estRestFull * elapsedFrac;
    restingFull = estRestFull;
    restingSource = 'estimate:mifflin_st_jeor';
  }

  // ---- active ----
  let activeSoFar = null, activeSource = null, activeCoverageMs = 0;
  if (activeProvider) {
    const a = providerActive[activeProvider];
    activeSoFar = a.kcal;
    activeCoverageMs = a.coveredMs;
    activeSource = `wearable:${activeProvider}`;
  } else if (estActiveFull != null) {
    activeSoFar = estActiveFull * elapsedFrac;
    activeSource = 'estimate:activity_factor';
  }

  // ---- totals ----
  const soFarParts = [restingSoFar, activeSoFar].filter(v => v != null);
  const expendedSoFar = soFarParts.length ? soFarParts.reduce((a, b) => a + b, 0) : null;
  // Projection = actual so far + the baseline estimate for the un-elapsed remainder.
  // For completed days the projection equals what was actually observed.
  const baselineRemaining = estRestFull != null && estActiveFull != null
    ? (estRestFull + estActiveFull) * (1 - elapsedFrac)
    : null;
  const projectedDay = expendedSoFar != null
    ? (isToday && baselineRemaining != null ? expendedSoFar + baselineRemaining : expendedSoFar)
    : null;

  // ---- intake ----
  const loggedKcal = foodLogs.reduce((s, l) => s + (Number.isFinite(l.calories) ? l.calories : 0), 0);
  const mealCount = foodLogs.length;
  const intake = {
    loggedKcal: mealCount ? Math.round(loggedKcal) : (loggedKcal > 0 ? Math.round(loggedKcal) : null),
    mealCount,
    lastLoggedAt: foodLogs[0]?.loggedAt ?? null,
    // 'partial' is the best we can ever claim from logs — completeness is unknowable.
    completeness: mealCount === 0 ? 'none' : 'partial',
  };

  // ---- target ----
  let targetKcal = null, targetSource = null;
  if (macroGoal?.caloriesTarget > 0 && ['custom', 'trainer', 'nutritionist'].includes(macroGoal.source)) {
    targetKcal = macroGoal.caloriesTarget;
    targetSource = macroGoal.source;
  } else if (prof.tdee != null) {
    const { normalizeGoal, GOAL_ADJUSTMENT } = require('./calorieEngine');
    targetKcal = prof.tdee + (GOAL_ADJUSTMENT[normalizeGoal(user.goalType)] ?? 0);
    targetSource = 'estimate:tdee_goal';
  } else if (macroGoal?.caloriesTarget > 0) {
    targetKcal = macroGoal.caloriesTarget;
    targetSource = 'default';
  }

  // ---- gaps ----
  const dataGaps = [];
  if (!activeProvider) dataGaps.push('no_active_energy_data');
  if (!restingProvider) dataGaps.push('no_resting_energy_data');
  if (prof.missing.length) dataGaps.push(`profile_incomplete:${prof.missing.join('+')}`);
  if (syncStale) dataGaps.push('stale_wearable_sync');
  if (isToday && activeProvider && activeCoverageMs < (now - dayStart) * 0.5) dataGaps.push('partial_wearable_coverage');
  if (mealCount === 0) dataGaps.push('intake_untracked');

  const round = v => v == null ? null : Math.round(v);
  return {
    version: ALGORITHM_VERSION,
    date: dateStr,
    timeZone: tz,
    generatedAt: now.toISOString(),
    day: {
      startAt: dayStart.toISOString(),
      endAt: dayEnd.toISOString(),
      elapsedFraction: Math.round(elapsedFrac * 1000) / 1000,
      isToday,
      isComplete: !isToday && now >= dayEnd,
    },
    resting: { soFarKcal: round(restingSoFar), fullDayKcal: round(restingFull), source: restingSource, coverageMin: restingProvider ? Math.round(providerResting[restingProvider].coveredMs / MS_MIN) : null },
    active: { soFarKcal: round(activeSoFar), source: activeSource, provider: activeProvider, coverageMin: activeProvider ? Math.round(activeCoverageMs / MS_MIN) : null },
    expenditure: {
      soFarKcal: round(expendedSoFar),
      projectedDayKcal: round(projectedDay),
      tdeeEstimateKcal: round(prof.tdee),
      basis: [
        restingSource ? `resting=${restingSource}` : null,
        activeSource ? `active=${activeSource}` : null,
        isToday ? 'projection=actual_so_far+baseline_remainder' : 'day_complete',
      ].filter(Boolean),
    },
    intake,
    target: { intakeKcal: round(targetKcal), source: targetSource },
    balance: {
      provisionalKcal: mealCount > 0 && expendedSoFar != null ? Math.round(loggedKcal - expendedSoFar) : null,
      provisionalNote: mealCount > 0
        ? 'Provisional — logged intake only; not a confirmed energy balance.'
        : null,
      completedDayKcal: null, // never claimed — intake completeness is unverifiable
    },
    sync: { lastSyncAt: lastSyncAt?.toISOString() ?? null, stale: syncStale },
    dataGaps,
    explanation: 'Resting energy is either wearable-reported for covered intervals or estimated with the Mifflin-St Jeor equation from your profile. Active energy uses the wearable provider covering most of the day, or is estimated inside the TDEE activity factor — never added twice. Logged food is only what you recorded; a low logged total is not a confirmed deficit.',
  };
}

module.exports = { getUserEnergySummary, localDayBounds, dedupedKcal, ALGORITHM_VERSION };
