// Gut health intelligence v1 — fiber vs target, plant variety, symptom trends.
// No microbiome score, no causal claims (correlation ≠ trigger), restrictive
// diets are never auto-initiated.
const { getPrisma } = require('../lib/prisma');

const FIBER_TARGET_G = 30;
const LOOKBACK_DAYS = 14;
const SYMPTOMS = ['bloating', 'gas', 'constipation', 'diarrhea', 'reflux', 'abdominal', 'stool_frequency'];
const TOLERANCE_KINDS = ['suspected', 'intolerance', 'dislike', 'exclusion']; // 'allergy' lives in Allergy — never here

async function getGutHealthSummary(userId) {
  const prisma = getPrisma();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000);
  const [logs, symptoms, tolerances] = await Promise.all([
    prisma.foodLog.findMany({
      where: { userId, loggedAt: { gte: since } },
      select: { fiberG: true, ingredientId: true, loggedAt: true },
    }).catch(() => []),
    prisma.gutSymptom.findMany({
      where: { userId, loggedAt: { gte: since } },
      select: { symptom: true, severity: true, loggedAt: true },
      orderBy: { loggedAt: 'desc' },
    }).catch(() => []),
    prisma.foodTolerance.findMany({
      where: { userId }, select: { foodName: true, kind: true, note: true },
      orderBy: { createdAt: 'desc' }, take: 100,
    }).catch(() => []),
  ]);

  const days = new Set(logs.map(l => l.loggedAt.toISOString().slice(0, 10)));
  const dayCount = days.size || 1;
  const fiberTotal = logs.reduce((s, l) => s + (l.fiberG ?? 0), 0);
  const fiberAvg = fiberTotal / dayCount;
  const plants = new Set(logs.map(l => l.ingredientId).filter(Boolean));

  const symptomCounts = {};
  for (const s of symptoms) symptomCounts[s.symptom] = (symptomCounts[s.symptom] || 0) + 1;
  const topSymptoms = Object.entries(symptomCounts).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([symptom, count]) => ({ symptom, count }));

  const signals = [];
  if (logs.length >= 5 && fiberAvg < FIBER_TARGET_G * 0.6) {
    signals.push({ key: 'low_fiber', detail: `Avg ${fiberAvg.toFixed(0)}g fiber/day vs ${FIBER_TARGET_G}g guide` });
  }
  if (plants.size > 0 && plants.size < 10 && dayCount >= 5) {
    signals.push({ key: 'narrow_variety', detail: `${plants.size} distinct plant foods logged in ${LOOKBACK_DAYS} days` });
  }

  return {
    version: 'gut-health-v1',
    lookbackDays: LOOKBACK_DAYS,
    fiber: { avgPerDayG: logs.length ? Number(fiberAvg.toFixed(1)) : null, targetG: FIBER_TARGET_G, daysLogged: dayCount },
    plantVariety: { distinctIngredients: plants.size, guide: '30+ plants/week is associated with gut diversity in research' },
    symptoms: { total: symptoms.length, top: topSymptoms },
    tolerances: tolerances.map(t => ({ foodName: t.foodName, kind: t.kind, note: t.note })),
    signals,
    completeness: logs.length >= 10 ? 'good' : logs.length > 0 ? 'partial' : 'none',
    note: 'Symptoms near a meal do not prove the meal caused them. Allergies are managed separately and always enforced.',
  };
}

async function logSymptom(userId, { symptom, severity, bristol, note, loggedAt }) {
  if (!SYMPTOMS.includes(symptom)) { const e = new Error(`symptom must be one of ${SYMPTOMS.join(', ')}`); e.status = 400; throw e; }
  if (bristol != null && (bristol < 1 || bristol > 7)) { const e = new Error('bristol must be 1–7'); e.status = 400; throw e; }
  return getPrisma().gutSymptom.create({
    data: { userId, symptom, severity: Math.min(5, Math.max(1, severity ?? 3)), bristol, note, ...(loggedAt ? { loggedAt: new Date(loggedAt) } : {}) },
  });
}

async function setTolerance(userId, { foodName, kind, note }) {
  if (!foodName?.trim() || !TOLERANCE_KINDS.includes(kind)) {
    const e = new Error(`foodName required; kind must be one of ${TOLERANCE_KINDS.join(', ')}`); e.status = 400; throw e;
  }
  return getPrisma().foodTolerance.create({ data: { userId, foodName: foodName.trim(), kind, note } });
}

module.exports = { getGutHealthSummary, logSymptom, setTolerance, SYMPTOMS, TOLERANCE_KINDS };
