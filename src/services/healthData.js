// Unified normalized health-data layer. Today the only real provider is the
// app itself ('app' source = device sensors + manual logs). Provider-ready:
// records carry source/externalId; dedup prefers the most authoritative source
// per metric+day. Missing data is flagged, never zero.

// Priority when two sources report the same metric on the same day: a real
// wearable/provider outranks manual app entry. Higher wins.
const SOURCE_PRIORITY = { fitbit: 3, 'apple-health': 3, 'health-connect': 3, app: 1 };
const FRESHNESS_HOURS = { steps: 24, water: 24, sleep: 36, workouts: 48 };

function priority(source) { return SOURCE_PRIORITY[source] ?? 0; }

function freshStatus(latestAt, hours, now) {
  if (!latestAt) return 'no_data';
  return now - new Date(latestAt).getTime() <= hours * 3600000 ? 'fresh' : 'stale';
}

function dateKey(d) { return new Date(d).toISOString().slice(0, 10); }

// Dedup per (metric, day): keep the highest-priority source's row.
function dedupe(rows, dayOf, sourceOf, rank = r => r.sort ?? 0) {
  const best = new Map();
  for (const row of rows) {
    const k = dayOf(row);
    const cur = best.get(k);
    if (!cur || priority(sourceOf(row)) > priority(sourceOf(cur)) ||
        (priority(sourceOf(row)) === priority(sourceOf(cur)) && rank(row) > rank(cur))) {
      best.set(k, row);
    }
  }
  return [...best.values()];
}

async function summary(prisma, userId, { days = 7, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * 86400000);
  const [steps, water, sleep, workouts] = await Promise.all([
    prisma.dailySteps.findMany({ where: { userId, date: { gte: since } }, orderBy: { date: 'asc' } }),
    prisma.waterLog.findMany({ where: { userId, loggedAt: { gte: since } }, orderBy: { loggedAt: 'asc' } }),
    prisma.sleepLog.findMany({ where: { userId, sleepStart: { gte: since } }, orderBy: { sleepStart: 'asc' } }),
    prisma.workoutSession.findMany({ where: { userId, startedAt: { gte: since } }, orderBy: { startedAt: 'asc' } }),
  ]);

  const stepDays = dedupe(steps, s => dateKey(s.date), s => s.source);
  const waterDays = [...water.reduce((m, w) => {
    const k = dateKey(w.loggedAt);
    const cur = m.get(k) || { totalMl: 0, lastAt: w.loggedAt, source: w.source };
    cur.totalMl += w.amountMl;
    if (w.loggedAt > cur.lastAt) { cur.lastAt = w.loggedAt; cur.source = w.source; }
    return m.set(k, cur), m;
  }, new Map()).values()];
  const sleepDays = dedupe(sleep, s => dateKey(s.sleepEnd || s.sleepStart), s => s.source);
  const latest = arr => arr.length ? arr[arr.length - 1] : null;
  const latestStep = latest(stepDays), latestSleep = latest(sleepDays), latestWorkout = latest(workouts);

  return {
    syncedAt: now.toISOString(),
    windowDays: days,
    steps: {
      status: freshStatus(latestStep?.date, FRESHNESS_HOURS.steps, now),
      latest: latestStep ? { value: latestStep.steps, unit: 'steps', date: dateKey(latestStep.date), source: latestStep.source, distanceKm: latestStep.distanceKm } : null,
      series: stepDays.map(s => ({ date: dateKey(s.date), value: s.steps, source: s.source })),
    },
    water: {
      status: freshStatus(latest(water)?.loggedAt, FRESHNESS_HOURS.water, now),
      latest: latest(water) ? { totalMlToday: waterDays.at(-1)?.totalMl ?? null, unit: 'ml', source: latest(water).source, loggedAt: latest(water).loggedAt } : null,
      series: waterDays,
    },
    sleep: {
      status: freshStatus(latestSleep?.sleepEnd, FRESHNESS_HOURS.sleep, now),
      latest: latestSleep ? { hours: latestSleep.hoursSlept ?? (latestSleep.sleepEnd - latestSleep.sleepStart) / 3600000, unit: 'hours', source: latestSleep.source, sleepStart: latestSleep.sleepStart, sleepEnd: latestSleep.sleepEnd, sleepScore: latestSleep.sleepScore } : null,
      series: sleepDays.map(s => ({ date: dateKey(s.sleepEnd || s.sleepStart), hours: s.hoursSlept ?? (s.sleepEnd - s.sleepStart) / 3600000, source: s.source })),
    },
    workouts: {
      status: freshStatus(latestWorkout?.startedAt, FRESHNESS_HOURS.workouts, now),
      latest: latestWorkout ? { type: latestWorkout.workoutType, durationMinutes: latestWorkout.durationMinutes, source: latestWorkout.source, startedAt: latestWorkout.startedAt } : null,
      count: workouts.length,
      series: workouts.map(w => ({ date: dateKey(w.startedAt), type: w.workoutType, durationMinutes: w.durationMinutes, source: w.source })),
    },
    sources: [...new Set([...steps, ...water, ...sleep, ...workouts].map(r => r.source))],
  };
}

module.exports = { summary, dedupe, freshStatus, SOURCE_PRIORITY };
