// Sleep & recovery intelligence v1 — reads only what exists (SleepLog from
// wearable/app sync, CheckIn.energyLevel). No sleep-stage claims, no diagnosis,
// missing data is reported as unknown.
const { getPrisma } = require('../lib/prisma');

const LOOKBACK_DAYS = 7;
const ENOUGH_NIGHTS = 3;

function hoursBetween(a, b) { return (b - a) / 3600000; }
function stddev(xs) {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}
// Distance between clock times on a circular 24h day, in hours.
function clockSpread(times) {
  const mins = times.map(d => d.getUTCHours() * 60 + d.getUTCMinutes());
  return stddev(mins) / 60;
}

async function getSleepRecoverySummary(userId) {
  const prisma = getPrisma();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000);
  const [logs, checkIn, user] = await Promise.all([
    prisma.sleepLog.findMany({
      where: { userId, sleepEnd: { gte: since } },
      orderBy: { sleepEnd: 'desc' },
      select: { sleepStart: true, sleepEnd: true, hoursSlept: true, source: true },
    }).catch(() => []),
    prisma.checkIn.findFirst({
      where: { clientId: userId, energyLevel: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { energyLevel: true, createdAt: true },
    }).catch(() => null),
    prisma.user.findUnique({ where: { id: userId }, select: { sleepGoalHours: true } }).catch(() => null),
  ]);

  const durations = logs
    .map(l => l.hoursSlept ?? hoursBetween(new Date(l.sleepStart), new Date(l.sleepEnd)))
    .filter(h => Number.isFinite(h) && h > 0 && h < 18);
  const nights = durations.length;
  const avgHours = nights ? durations.reduce((s, h) => s + h, 0) / nights : null;
  const goal = user?.sleepGoalHours || 8;
  const wakeSpread = nights >= 2 ? clockSpread(logs.map(l => new Date(l.sleepEnd))) : null;

  const signals = [];
  if (avgHours != null && avgHours < 6 && nights >= ENOUGH_NIGHTS) {
    signals.push({ key: 'short_sleep', detail: `Avg ${avgHours.toFixed(1)}h/night over ${nights} nights (goal ${goal}h)` });
  }
  if (wakeSpread != null && wakeSpread > 1.5 && nights >= 5) {
    signals.push({ key: 'irregular_wake', detail: `Wake times vary ~${Math.round(wakeSpread * 60)}min across ${nights} nights` });
  }
  if (checkIn?.energyLevel != null && checkIn.energyLevel <= 2) {
    signals.push({ key: 'low_energy', detail: `Last check-in energy ${checkIn.energyLevel}/5` });
  }

  const completeness = nights >= 5 ? 'good' : nights > 0 ? 'partial' : 'none';
  const suggestion = signals.some(s => s.key === 'short_sleep' || s.key === 'low_energy')
    ? 'lighter_intensity' : signals.length ? 'steady_schedule' : null;

  return {
    version: 'sleep-recovery-v1',
    lookbackDays: LOOKBACK_DAYS,
    nights,
    avgHours: avgHours == null ? null : Number(avgHours.toFixed(1)),
    goalHours: goal,
    wakeSpreadHours: wakeSpread == null ? null : Number(wakeSpread.toFixed(1)),
    lastEnergyCheckIn: checkIn?.energyLevel ?? null,
    signals,
    suggestion,
    completeness,
    note: 'Device sleep estimates are not clinical measurements. Missing data is unknown, not a failure.',
  };
}

module.exports = { getSleepRecoverySummary };
