// Symptom & context intelligence (Sprint B) — observational associations
// between user-reported symptoms (UserSymptomReport) and logged meals/activity
// in the preceding window. Association ≠ causation: outputs use observational
// language only and carry co-occurrence counts + coverage. Never a diagnosis,
// never "X caused Y", never an elimination recommendation. Persistent or
// urgent codes route to the existing escalation vocabulary, not advice.
const { getPrisma } = require('../lib/prisma');
const DAY_MS = 86400000;

// Window (hours) in which a logged meal is considered temporally adjacent to
// a reported symptom. Observational co-occurrence only.
const LOOKBACK_HOURS = 6;

const round1 = (x) => Math.round(x * 10) / 10;

async function getSymptomContext(userId, { days = 14 } = {}) {
  const prisma = getPrisma();
  const since = new Date(Date.now() - days * DAY_MS);
  const q = async (p) => { try { return await p; } catch { return null; } };
  const [reports, meals, workouts, sleeps] = await Promise.all([
    q(prisma.userSymptomReport.findMany({ where: { userId, reportedAt: { gte: since } }, orderBy: { reportedAt: 'asc' }, select: { id: true, symptoms: true, severity: true, context: true, persistence: true, status: true, reportedAt: true } })),
    q(prisma.foodLog.findMany({ where: { userId, loggedAt: { gte: new Date(since.getTime() - LOOKBACK_HOURS * 3600000) } }, select: { foodName: true, loggedAt: true, ingredientId: true } })),
    q(prisma.workoutSession.findMany({ where: { userId, startedAt: { gte: since } }, select: { startedAt: true, finishedAt: true, workoutType: true } })),
    q(prisma.sleepLog.findMany({ where: { userId, sleepStart: { gte: since } }, select: { sleepStart: true, hoursSlept: true } })),
  ]);
  const reportsN = (reports || []);
  const coverage = { windowDays: days, symptomReports: reportsN.length, mealEntries: (meals || []).length, workoutSessions: (workouts || []).length, sleepNights: (sleeps || []).length };
  if (!reportsN.length) return { version: 'symctx-v1', state: 'insufficient', reason: 'No symptom reports in window.', coverage, reports: [], associations: [] };

  // Per-report adjacent meals (0–6h before the report, local-order timestamps).
  const enriched = reportsN.map((r) => {
    const window = { lo: new Date(r.reportedAt).getTime() - LOOKBACK_HOURS * 3600000, hi: new Date(r.reportedAt).getTime() };
    const prior = (meals || []).filter((m) => { const t = new Date(m.loggedAt).getTime(); return t >= window.lo && t <= window.hi; });
    const nearWorkout = (workouts || []).some((w) => w.finishedAt && new Date(w.finishedAt).getTime() >= window.lo && new Date(w.startedAt).getTime() <= window.hi);
    return {
      id: r.id, symptoms: r.symptoms || [], severity: r.severity || null, context: r.context || 'unspecified',
      persistence: r.persistence || null, status: r.status, reportedAt: r.reportedAt,
      priorMeals: prior.map((m) => ({ foodName: m.foodName, loggedAt: m.loggedAt })),
      priorMealCount: prior.length, workoutAdjacent: nearWorkout,
    };
  });

  // Recurring co-occurrence: count days a symptom co-occurred with a food token
  // vs total days the food appeared and days the symptom appeared. This is a
  // descriptive co-occurrence table, not an inference engine.
  const tokenize = (name) => String(name || '').toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 3 && !['with', 'and', 'the', 'bowl', 'meal'].includes(t));
  const co = {}; // token -> {withSymptom, total}
  const foodDays = new Map(); // token -> Set(day)
  for (const m of meals || []) {
    const d = new Date(m.loggedAt).toISOString().slice(0, 10);
    for (const t of tokenize(m.foodName)) { if (!foodDays.has(t)) foodDays.set(t, new Set()); foodDays.get(t).add(d); }
  }
  for (const r of enriched) {
    const d = new Date(r.reportedAt).toISOString().slice(0, 10);
    const toks = new Set(r.priorMeals.flatMap((m) => tokenize(m.foodName)));
    for (const t of toks) { co[t] = co[t] || { coOccurrenceDays: 0 }; co[t].coOccurrenceDays += 1; }
  }
  const symptomDays = new Set(enriched.map((r) => new Date(r.reportedAt).toISOString().slice(0, 10)));
  const associations = Object.entries(co)
    .filter(([, v]) => v.coOccurrenceDays >= 2)
    .map(([token, v]) => ({
      foodToken: token, coOccurrenceDays: v.coOccurrenceDays,
      foodLoggedDays: foodDays.get(token)?.size || 0,
      symptomReportDays: symptomDays.size,
      basis: 'temporal_cooccurrence_within_6h',
      // Observational phrasing — explicitly non-causal.
      note: `${token} was logged on ${v.coOccurrenceDays} day(s) when symptoms were also reported. Co-occurrence does not establish that ${token} caused the symptoms.`,
    }))
    .sort((a, b) => b.coOccurrenceDays - a.coOccurrenceDays).slice(0, 10);

  const persistent = enriched.filter((r) => r.persistence === 'persistent' || r.persistence === 'worsening').length;
  const escalation = persistent >= 2 ? { kind: 'persistent_symptoms', outcome: 'professional_review_suggested', note: `${persistent} reports marked persistent/worsening in this window — consider professional evaluation.` } : null;

  return {
    version: 'symctx-v1', state: 'ok', coverage,
    reports: enriched,
    associations,
    escalation,
    provenance: { symptoms: 'UserSymptomReport', meals: 'FoodLog(±6h)', workouts: 'WorkoutSession', sleep: 'SleepLog' },
    disclaimer: 'Observational co-occurrence from your own records — associations are not diagnoses and do not prove a food caused a symptom.',
  };
}

module.exports = { getSymptomContext, LOOKBACK_HOURS };
