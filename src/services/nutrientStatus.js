// Unified daily/weekly nutrition status.
// Aggregates FoodLog columns plus whitelisted numeric nutrients carried in
// FoodLog.nutritionSnapshot. Unknown is never treated as zero: when any
// contributing log lacks a nutrient the coverage is reported as 'partial'.
const { NUTRIENTS, BY_KEY, FOODLOG_NATIVE, SNAPSHOT_NUTRIENTS } = require('./nutrientCatalog');

function dayStart(d) { const t = new Date(d); t.setHours(0, 0, 0, 0); return t; }

function snapshotNutrients(snap) {
  if (!snap || typeof snap !== 'object') return {};
  const src = snap.nutrients && typeof snap.nutrients === 'object' ? snap.nutrients : snap;
  const out = {};
  for (const key of SNAPSHOT_NUTRIENTS) {
    const v = src[key] ?? src[key.replace(/(Mg|Mcg|G)$/, m => m.toLowerCase())];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

async function nutrientStatus(prisma, userId, { days = 1, now = new Date(), targets = {} } = {}) {
  const span = Math.min(Math.max(1, Math.floor(days)), 30);
  const from = dayStart(now); from.setDate(from.getDate() - (span - 1));
  const logs = await prisma.foodLog.findMany({
    where: { userId, loggedAt: { gte: from, lte: now } },
    select: { calories: true, proteinG: true, carbsG: true, fatG: true, fiberG: true, nutritionSnapshot: true, micronutrients: true, loggedAt: true },
  });
  const daysWithData = new Set(logs.map(l => dayStart(l.loggedAt).toISOString())).size;
  const nutrients = {};
  for (const n of NUTRIENTS) {
    let total = 0, present = 0, missing = 0;
    for (const log of logs) {
      let v;
      if (FOODLOG_NATIVE.includes(n.key)) v = log[n.key];
      else {
        const micros = log.micronutrients && typeof log.micronutrients === 'object' ? log.micronutrients : {};
        const m = micros[n.key];
        v = typeof m === 'number' && Number.isFinite(m) ? m : snapshotNutrients(log.nutritionSnapshot)[n.key];
      }
      if (typeof v === 'number' && Number.isFinite(v)) { total += v; present++; }
      else missing++;
    }
    if (!logs.length || (!present && !FOODLOG_NATIVE.includes(n.key))) {
      nutrients[n.key] = { value: null, unit: n.unit, coverage: logs.length ? 'none' : 'no-data' };
      continue;
    }
    const completeness = missing > 0 ? 'partial' : 'complete';
    const reference = targets[n.key] ?? n.referenceIntake ?? null;
    nutrients[n.key] = {
      value: Math.round(total * 10) / 10, unit: n.unit, label: n.label,
      reference, basis: n.basis, coverage: completeness,
      logsContributing: present, logsMissingValue: missing,
      upperLimit: n.upperLimit ?? null,
      overReference: reference != null && n.direction === 'limit' ? total > reference : null,
    };
  }
  // Supplements stay separate: we only surface count context, never merge
  // into food totals (composition/dose comparability is not guaranteed).
  let supplementsLogged = null;
  try {
    supplementsLogged = await prisma.supplementDoseOccurrence.count({
      where: { userId, date: { gte: from }, status: 'taken' },
    });
  } catch { supplementsLogged = null; }
  return {
    windowDays: span, daysWithData,
    completeness: daysWithData < span ? 'partial-window' : 'full-window',
    nutrients, supplementsTrackedSeparately: true, supplementsLogged,
    disclaimer: 'Logged intake only. Missing nutrients are unknown, not zero. This is not a deficiency assessment.',
  };
}
module.exports = { nutrientStatus, snapshotNutrients };
