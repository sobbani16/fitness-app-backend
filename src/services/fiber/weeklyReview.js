// Weekly fiber review — a 7-day summary that distinguishes "intake looks
// low" from "logging was incomplete". Deliberately nonjudgmental: the user
// is shown what the data supports, where it is thin, and concrete food-first
// changes to recurring meals — never a deficit score or a catch-up dose.

const { getPrisma } = require('../../lib/prisma');
const { resolveFiberTarget } = require('./targets');
const { suggestFoods } = require('./suggestions');
const { fiberStateOf } = require('./dailyEngine');
const { dayKey, dayRangeUtc } = require('../localDay');

const REVIEW_VERSION = 'fiber-weekly-v1';

const round1 = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);

// Light-touch component hints for pattern suggestions. Recurring meal names
// that look like a starch-only or protein+starch pattern get a concrete
// food-first swap suggestion — referencing the user's own meals, not generic
// advice.
const STARCH_HINT = /\b(rice|chawal|roti|chapati|bread|toast|naan|pasta|noodle|potato|oats|cereal|poha|upma|idli|dosa|paratha|sandwich|wrap|bagel|quinoa)\b/i;
const FIBER_HINT = /\b(dal|lentil|chana|rajma|chole|beans?|broccoli|spinach|palak|cabbage|vegetable|veg|salad|greens?|okra|bhindi|fruit|apple|pear|berries|oats|chia|flax|nuts?)\b/i;

/**
 * Build the 7-day fiber review for a user.
 * @param {string} userId
 * @param {{ zone?: string }} [opts]
 */
async function weeklyReview(userId, { zone } = {}) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true, gender: true, timeZone: true } });
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }
  const tz = zone || user.timeZone || 'UTC';

  const today = dayKey(new Date(), tz);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.parse(`${today}T12:00:00Z`));
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const rangeStart = dayRangeUtc(days[0], tz).startUtc;
  const rangeEnd = dayRangeUtc(today, tz).endUtc;

  const [macroGoal, conditions, allergies, foodPrefs, logs] = await Promise.all([
    prisma.macroGoal.findUnique({ where: { userId } }),
    prisma.userHealthCondition.findMany({ where: { userId, active: true }, include: { condition: { select: { name: true } } } }).catch(() => []),
    prisma.userAllergy.findMany({ where: { userId }, include: { allergy: { select: { name: true } } } }).catch(() => []),
    prisma.foodPreference.findMany({ where: { userId, preference: { in: ['DISLIKE', 'NEVER_RECOMMEND'] } }, select: { foodName: true } }).catch(() => []),
    prisma.foodLog.findMany({
      where: { userId, loggedAt: { gte: rangeStart, lte: rangeEnd } },
      select: { id: true, foodName: true, mealType: true, fiberG: true, nutritionSnapshot: true, loggedAt: true },
      orderBy: { loggedAt: 'asc' },
    }),
  ]);

  const conditionNames = (conditions || []).map((c) => c.condition?.name).filter(Boolean);
  const target = resolveFiberTarget({ dateOfBirth: user.dateOfBirth, gender: user.gender, macroGoal, conditionNames });
  const allergenTerms = new Set((allergies || []).map((a) => String(a.allergy?.name || '').toLowerCase()).filter(Boolean));
  const avoidNames = new Set((foodPrefs || []).map((p) => p.foodName.toLowerCase()));

  // --- Per-day rollup -------------------------------------------------------
  const byDay = new Map(days.map((d) => [d, { date: d, mealsLogged: 0, confirmedG: 0, estimatedG: 0, unknownMeals: 0 }]));
  for (const log of logs) {
    const dk = dayKey(new Date(log.loggedAt), tz);
    const row = byDay.get(dk);
    if (!row) continue;
    row.mealsLogged += 1;
    const state = fiberStateOf(log);
    if (state === 'confirmed') row.confirmedG += log.fiberG;
    else if (state === 'estimated') row.estimatedG += log.fiberG;
    else row.unknownMeals += 1;
  }
  const perDay = [...byDay.values()].map((r) => {
    // A day only counts as "below target" when its logging is trustworthy —
    // days with no logs or mostly-unknown fiber are data-quality gaps, not
    // intake gaps. This is the core incomplete-vs-low distinction.
    const completeness = r.mealsLogged === 0 ? 'none' : r.unknownMeals === 0 ? 'complete' : r.unknownMeals / r.mealsLogged <= 0.5 ? 'partial' : 'low';
    const wellLogged = r.mealsLogged > 0 && completeness !== 'low';
    return {
      ...r,
      confirmedG: round1(r.confirmedG),
      estimatedG: round1(r.estimatedG),
      completeness,
      belowTarget: wellLogged && target.targetG != null ? r.confirmedG < target.targetG : null,
      trustworthy: wellLogged,
    };
  });

  const daysLogged = perDay.filter((d) => d.mealsLogged > 0).length;
  const trustworthyDays = perDay.filter((d) => d.trustworthy);
  const belowDays = trustworthyDays.filter((d) => d.belowTarget).length;
  const avgConfirmed = trustworthyDays.length
    ? trustworthyDays.reduce((s, d) => s + d.confirmedG, 0) / trustworthyDays.length : null;
  const unknownShare = logs.length ? perDay.reduce((s, d) => s + d.unknownMeals, 0) / logs.length : 0;

  // --- Verdict ----------------------------------------------------------------
  // Language contract: no judgment, no catch-up framing, honest about data gaps.
  let verdict; let headline;
  if (daysLogged === 0) {
    verdict = 'no_data';
    headline = 'No meals were logged this week — there’s nothing to review yet.';
  } else if (trustworthyDays.length < 3 || unknownShare > 0.5) {
    verdict = 'mostly_incomplete';
    headline = `${daysLogged} day${daysLogged > 1 ? 's' : ''} had logged meals, but most entries lack fiber data — your actual intake is probably higher than the recorded ${round1(avgConfirmed) ?? 0} g average.`;
  } else if (belowDays === 0) {
    verdict = 'on_track';
    headline = `On the ${trustworthyDays.length} well-logged days you hit your fiber target — nicely consistent.`;
  } else {
    verdict = 'below_on_logged_days';
    headline = `Across ${trustworthyDays.length} well-logged days, fiber averaged ~${round1(avgConfirmed)} g against a ${target.targetG} g target — a modest, fixable gap on ${belowDays} of them.`;
  }

  // --- Recurring-pattern suggestions ------------------------------------------
  // Look at what was actually logged: meals matching a starch-only pattern
  // (no fiber-word in the name) get one concrete, nonjudgmental idea each.
  const patterns = [];
  if (verdict === 'below_on_logged_days' || verdict === 'mostly_incomplete') {
    const mealHits = new Map();
    for (const log of logs) {
      const mt = (log.mealType || 'meal').toLowerCase();
      if (FIBER_HINT.test(log.foodName)) continue; // already fiber-bearing
      if (!STARCH_HINT.test(log.foodName)) continue;
      const cur = mealHits.get(mt) || { count: 0, examples: new Set() };
      cur.count += 1; cur.examples.add(log.foodName);
      mealHits.set(mt, cur);
    }
    const suggestions = suggestFoods({ gapG: target.targetG != null && avgConfirmed != null ? target.targetG - avgConfirmed : null, allergenTerms, avoidNames, limit: 4 });
    for (const [mt, hit] of [...mealHits.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 2)) {
      const example = [...hit.examples][0];
      const pick = suggestions.find((s) => !patterns.some((p) => p.addFood === s.food));
      if (!pick) break;
      patterns.push({
        mealType: mt,
        occurrences: hit.count,
        example: `“${example}” appeared ${hit.count}×`,
        addFood: pick.food,
        suggestion: `Your ${mt}s often centered on starch (e.g. ${example}). A side like ${pick.food} (${pick.serving}, ~${pick.approxFiberG} g) alongside it would cover most of a day’s gap.`,
      });
    }
  }

  return {
    version: REVIEW_VERSION,
    window: { start: days[0], end: today, days: 7, timezone: tz },
    target: { targetG: target.targetG, basis: target.basis, reviewRequired: target.reviewRequired },
    daysLogged,
    trustworthyDays: trustworthyDays.length,
    daysBelowTarget: belowDays,
    avgConfirmedG: round1(avgConfirmed),
    dataQuality: { unknownMeals: perDay.reduce((s, d) => s + d.unknownMeals, 0), unknownShare: round1(unknownShare) },
    verdict,
    headline,
    perDay,
    patterns,
    disclaimers: [
      'Averages include only days where logged items carried fiber data — incomplete logging is reported as incomplete, not as low intake.',
      'This review describes trends, not a medical assessment — clinician-directed fiber levels override it.',
    ],
  };
}

module.exports = { weeklyReview, REVIEW_VERSION };
