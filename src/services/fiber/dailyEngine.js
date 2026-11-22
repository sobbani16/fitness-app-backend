// DailyFiberRecommendationEngine — deterministic per-day fiber intelligence.
//
// Contract (Phase 5):
//   Inputs:  personalized target, confirmed food logs, estimated/missing data,
//            meal timing, planned meals, dietary restrictions, health
//            conditions, supplement history, safety-gate inputs.
//   Outputs: target, confirmed/estimated/unknown/planned split, remaining gap,
//            data completeness, food-first suggestions, supplement eligibility
//            flag, explanation, evidence references, safety verdict, version.
//
// Invariants:
//   - Only CONFIRMED fiber counts toward the confirmed total.
//   - Unknown fiber is never treated as zero — it lowers completeness instead.
//   - fiberRemaining = max(0, target − confirmed).
//   - Food-first: supplement eligibility is an *eligibility verdict* only —
//     the engine never emits a dose or an auto-suggestion.
//   - Recompute-on-read; FiberDailyRecommendation rows are persisted with an
//     inputsHash so stale outputs are detectable, never silently served.

const crypto = require('crypto');
const { getPrisma } = require('../../lib/prisma');
const { resolveFiberTarget, TARGET_RULE_VERSION } = require('./targets');
const { suggestFoods } = require('./suggestions');
const { unknownsFor } = require('../nutrientCompleteness');
const { dayRangeUtc, dayKey, resolveZone } = require('../localDay');

const ENGINE_VERSION = 'fiber-daily-v1';
const GAP_SUGGESTION_THRESHOLD_G = 4; // don't nudge for trivial gaps

// Provenance classes for the confirmed/estimated split. A FoodLog's fiber
// counts as CONFIRMED only when the value was actually measured/declared —
// catalog calculation, user-reviewed label, or user-entered value. Entries
// whose snapshot marks the source as an estimate land in `estimated` and do
// not count toward the confirmed total.
const ESTIMATED_SOURCE_RE = /estimate|ai[- ]?(estimate|generated)|external/i;

function fiberStateOf(log) {
  if (log.fiberG == null) return 'unknown';
  const unknowns = unknownsFor(log);
  if (unknowns.includes('fiberG')) return 'unknown';
  const src = log.nutritionSnapshot?.loggedSource || '';
  return ESTIMATED_SOURCE_RE.test(src) ? 'estimated' : 'confirmed';
}

function round1(v) { return v == null ? null : Math.round(v * 10) / 10; }

function inputsHash(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

/**
 * Compute the user's daily fiber recommendation.
 * @param {string} userId
 * @param {object} [opts]
 * @param {string} [opts.date]  - YYYY-MM-DD local day (default: today in tz)
 * @param {string} [opts.tz]    - IANA zone override (default: user.timeZone)
 * @param {boolean}[opts.persist] - write FiberDailyRecommendation (default true)
 */
async function dailyFiber(userId, { date, tz, persist = true } = {}) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, dateOfBirth: true, gender: true, goalType: true, timeZone: true },
  });
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }
  const zone = resolveZone(tz, user.timeZone);
  const day = date || dayKey(new Date(), zone);
  const { startUtc, endUtc } = dayRangeUtc(day, zone);

  const [macroGoal, conditions, allergies, foodPrefs, logs, suppLogs, plan] = await Promise.all([
    prisma.macroGoal.findUnique({ where: { userId } }),
    prisma.userHealthCondition.findMany({ where: { userId, active: true }, include: { condition: { select: { name: true } } } }).catch(() => []),
    prisma.userAllergy.findMany({ where: { userId }, include: { allergy: { select: { name: true } } } }).catch(() => []),
    prisma.foodPreference.findMany({ where: { userId, preference: { in: ['DISLIKE', 'NEVER_RECOMMEND'] } }, select: { foodName: true, preference: true } }).catch(() => []),
    prisma.foodLog.findMany({
      where: { userId, loggedAt: { gte: startUtc, lt: endUtc } },
      select: { id: true, foodName: true, mealType: true, fiberG: true, nutritionSnapshot: true, loggedAt: true },
    }),
    prisma.supplementLog.findMany({
      where: { userId, loggedAt: { gte: startUtc, lt: endUtc } },
      select: { id: true, supplementName: true, fiberG: true, quantity: true },
    }),
    // Planned meals for this local day-of-week (any active plan).
    prisma.weeklyNutritionPlan.findFirst({
      where: { userId, status: 'active' },
      include: { meals: { select: { dayOfWeek: true, mealType: true, foodName: true, fiberG: true } } },
    }).catch(() => null),
  ]);

  const conditionNames = (conditions || []).map((c) => c.condition?.name).filter(Boolean);
  const allergenTerms = new Set((allergies || []).map((a) => String(a.allergy?.name || '').toLowerCase()).filter(Boolean));
  const avoidNames = new Set((foodPrefs || []).map((p) => p.foodName.toLowerCase()));

  const target = resolveFiberTarget({ dateOfBirth: user.dateOfBirth, gender: user.gender, macroGoal, conditionNames });

  // --- Fiber status taxonomy ----------------------------------------------
  let confirmed = 0, estimated = 0, unknownMeals = 0;
  const perLog = [];
  for (const log of logs) {
    const state = fiberStateOf(log);
    if (state === 'confirmed') confirmed += log.fiberG;
    else if (state === 'estimated') estimated += log.fiberG;
    else unknownMeals += 1;
    perLog.push({ id: log.id, foodName: log.foodName, mealType: log.mealType, fiberG: log.fiberG, state });
  }
  // Supplement fiber is reported separately — food-first means a supplement
  // never inflates the food-based confirmed total.
  const supplementG = (suppLogs || []).reduce((s, l) => s + (l.fiberG || 0), 0);

  // Planned fiber: today's meals in the active plan not yet logged. Day-of-week
  // uses the *local* day; matching to logged meals is by mealType so a logged
  // lunch doesn't double-count the planned lunch.
  const localDow = new Date(Date.parse(`${day}T12:00:00Z`)).getUTCDay();
  const loggedTypes = new Set(logs.map((l) => (l.mealType || '').toLowerCase()));
  const planned = (plan?.meals || []).filter((m) => m.dayOfWeek === localDow && !loggedTypes.has((m.mealType || '').toLowerCase()));
  const plannedG = planned.reduce((s, m) => s + (m.fiberG || 0), 0);

  const remaining = target.targetG != null ? Math.max(0, target.targetG - confirmed) : null;
  const completeness = logs.length === 0 ? 'none'
    : unknownMeals === 0 ? 'complete'
    : unknownMeals / logs.length <= 0.5 ? 'partial' : 'low';

  // --- Food-first suggestions ---------------------------------------------
  const nextMeal = ['breakfast', 'lunch', 'dinner', 'snack'].find((t) => !loggedTypes.has(t));
  const suggestions = remaining != null && remaining >= GAP_SUGGESTION_THRESHOLD_G
    ? suggestFoods({ gapG: remaining, mealType: nextMeal, allergenTerms, avoidNames })
    : [];

  // --- Safety verdict -------------------------------------------------------
  const safety = target.reviewRequired
    ? { verdict: 'professional_review_required', reasons: target.restrictions.map((r) => r.note) }
    : { verdict: 'ok', reasons: [] };

  const explanation = [];
  if (target.targetG != null) explanation.push(`Your fiber target is ${target.targetG} g/day (${describeBasis(target)}).`);
  if (logs.length === 0) explanation.push('No meals logged yet today — the gap below reflects nothing eaten being recorded, not a deficit.');
  else explanation.push(`Confirmed fiber so far: ${round1(confirmed)} g${estimated ? ` (+ ~${round1(estimated)} g estimated)` : ''}${supplementG ? `, plus ${round1(supplementG)} g from supplements` : ''}.`);
  if (unknownMeals) explanation.push(`${unknownMeals} of ${logs.length} logged item${unknownMeals > 1 ? 's have' : ' has'} no fiber data — actual intake may be higher than confirmed.`);
  if (plannedG) explanation.push(`Your plan has ~${round1(plannedG)} g fiber in today's remaining meals.`);
  if (remaining != null && remaining > 0 && logs.length) explanation.push(`Remaining gap: ${round1(remaining)} g — food-first options below.`);

  const payload = {
    date: day, timezone: zone,
    target: { targetG: target.targetG, basis: target.basis, reference: target.reference, notes: target.notes },
    status: {
      confirmedG: round1(confirmed),
      estimatedG: round1(estimated),
      unknownMeals,
      plannedG: round1(plannedG) || 0,
      supplementG: round1(supplementG) || 0,
      remainingG: round1(remaining),
      completeness,
      mealsLogged: logs.length,
    },
    perLog,
    plannedMeals: planned.map((m) => ({ mealType: m.mealType, foodName: m.foodName, fiberG: m.fiberG })),
    suggestions,
    supplementEligibility: { evaluated: false, reason: 'use POST /fiber/supplement-check for the gated evaluation' },
    explanation,
    evidence: [
      { key: 'IOM_14G_PER_1000KCAL', note: '~14 g dietary fiber per 1,000 kcal — IOM/DGA adult reference basis.' },
      { key: 'IOM_AI_LIFESTAGE', note: 'Fixed AI values for minors, pregnancy (28 g) and lactation (29 g); the adult formula is never applied to children.' },
    ],
    safety,
    versions: { engine: ENGINE_VERSION, targetRules: TARGET_RULE_VERSION },
  };

  const hash = inputsHash({
    day, zone, target: target.targetG, basis: target.basis,
    logs: perLog, supp: supplementG, planned: plannedG, cond: conditionNames,
    // Suggestion filters are inputs too: adding an allergy or a "never
    // recommend" must change the hash or a stale suggestion could resurface.
    avoid: [...avoidNames].sort(), allerg: [...allergenTerms].sort(),
  });

  if (persist) {
    await prisma.fiberDailyRecommendation.upsert({
      where: { userId_date: { userId, date: day } },
      update: { inputsHash: hash, ruleVersion: ENGINE_VERSION, targetG: target.targetG, confirmedG: round1(confirmed) ?? 0, estimatedG: round1(estimated), unknownMeals, timezone: zone, payload },
      create: { userId, date: day, timezone: zone, inputsHash: hash, ruleVersion: ENGINE_VERSION, targetG: target.targetG, confirmedG: round1(confirmed) ?? 0, estimatedG: round1(estimated), unknownMeals, payload },
    }).catch(() => {}); // persistence is best-effort — never blocks a read
  }

  return { ...payload, inputsHash: hash };
}

// Reminder copy is computed at SEND time so it reflects the latest logs.
// Food-first only — reminders never mention supplements, per the product
// principle that psyllium is opt-in education, not a push notification.
// Returns null when there is nothing useful to say (no target resolved).
function fiberReminderBody(engine) {
  const t = engine?.target?.targetG;
  if (t == null) return null;
  const s = engine.status || {};
  const top = (engine.suggestions || [])[0];
  const suggestion = top ? ` ${top.food} (${top.serving}, ~${top.approxFiberG} g) is one option.` : '';
  if (!s.mealsLogged) {
    return `Today's fiber goal is ${t} g. Planning a fiber-rich side at your next meal is an easy start.${suggestion}`;
  }
  if (s.remainingG != null && s.remainingG > 0) {
    return `You've logged ${s.confirmedG} g of your ${t} g fiber goal.${suggestion}`;
  }
  return `Nice — you've reached today's ${t} g fiber goal.`;
}

function describeBasis(target) {
  switch (target.basis) {
    case 'clinician': return 'set by your clinician';
    case 'custom': return 'your own target';
    case 'formula_adult': return `~14 g per 1,000 kcal × ${target.reference.calorieBasis} kcal target`;
    case 'reference_minor': return 'age-appropriate reference value';
    case 'reference_life_stage': return 'life-stage reference value';
    case 'reference_adult_ai': return 'adult reference value';
    case 'restricted_reference': return 'conservative reference — clinician review advised';
    default: return 'default reference';
  }
}

module.exports = { dailyFiber, fiberStateOf, fiberReminderBody, ENGINE_VERSION, GAP_SUGGESTION_THRESHOLD_G };
