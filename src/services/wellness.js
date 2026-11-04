// Stress & mental well-being v1 — self-reported check-ins only.
// No inference from HRV/HR, no diagnosis, private to the member by default.
const { getPrisma } = require('../lib/prisma');

const clamp5 = (v, k) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) { const e = new Error(`${k} must be 1–5`); e.status = 400; throw e; }
  return n;
};

async function logCheckIn(userId, { stress, mood, fatigue, note, loggedAt }) {
  return getPrisma().wellnessCheckIn.create({
    data: {
      userId, stress: clamp5(stress, 'stress'), mood: clamp5(mood, 'mood'), fatigue: clamp5(fatigue, 'fatigue'),
      note: note?.slice(0, 500) ?? null, ...(loggedAt ? { loggedAt: new Date(loggedAt) } : {}),
    },
  });
}

async function getWellnessSummary(userId) {
  const since = new Date(Date.now() - 14 * 86400000);
  const rows = await getPrisma().wellnessCheckIn.findMany({
    where: { userId, loggedAt: { gte: since } },
    orderBy: { loggedAt: 'desc' },
    select: { stress: true, mood: true, fatigue: true, loggedAt: true },
  }).catch(() => []);
  const avg = k => rows.length ? Number((rows.reduce((s, r) => s + r[k], 0) / rows.length).toFixed(1)) : null;
  const signals = [];
  if (avg('stress') != null && avg('stress') >= 4 && rows.length >= 3) signals.push({ key: 'high_stress', detail: `Avg stress ${avg('stress')}/5 across ${rows.length} check-ins` });
  if (avg('fatigue') != null && avg('fatigue') >= 4 && rows.length >= 3) signals.push({ key: 'high_fatigue', detail: `Avg fatigue ${avg('fatigue')}/5 across ${rows.length} check-ins` });
  if (avg('mood') != null && avg('mood') <= 2 && rows.length >= 3) signals.push({ key: 'low_mood', detail: `Avg mood ${avg('mood')}/5 across ${rows.length} check-ins` });
  return {
    version: 'wellness-v1', lookbackDays: 14, checkIns: rows.length,
    avgStress: avg('stress'), avgMood: avg('mood'), avgFatigue: avg('fatigue'), signals,
    note: 'Self-reported wellness — not a clinical assessment. Persistent distress deserves professional support.',
  };
}

module.exports = { logCheckIn, getWellnessSummary };
