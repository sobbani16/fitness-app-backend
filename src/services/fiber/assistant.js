// Deterministic fiber grounding for AI chat and Hey Leo voice.
//
// Fiber questions never reach the LLM: every answer here is assembled from
// the daily engine, sequencing engine, verified ingredient data, or the
// supplement-check verdicts. Both surfaces share this module so a question
// asked by voice and by chat returns the same numbers.
//
// Contract:
//   - Never fabricate nutrient values — unknown stays unknown.
//   - Never emit a supplement dose — supplement answers point to the
//     label-verified check flow only.
//   - Food-first ordering everywhere; supplement mentions carry education.

const { getPrisma } = require('../../lib/prisma');
const { dailyFiber } = require('./dailyEngine');
const { sequenceMeal } = require('./sequencing');
const { FIBER_SUPPLEMENT_RE, EDUCATION } = require('./supplementCheck');

const FIBER_WORD_RE = /fiber|fibre|isabgol|psyllium|roughage/i;

function isFiberQuestion(message) {
  return FIBER_WORD_RE.test(message) || /eat\s+first|meal\s+order|food\s+order/i.test(message);
}

const fmt = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);

// "Does dal contain enough fiber?" / "how much fiber is in oats" — resolve
// the food phrase to an Ingredient and report per-100 g data verbatim.
// Explicit patterns; the food phrase never captures verb words.
const FOOD_PATTERNS = [
  /(?:does|do)\s+([a-z][a-z \-']+?)\s+(?:contain|have|has)\s+/i,
  /is\s+([a-z][a-z \-']+?)\s+(?:high|rich|good|enough|low)\s+(?:in|of|for|on)?\s*fiber/i,
  /how much fiber\s+(?:is|does|do)?\s*(?:there\s+)?in\s+([a-z][a-z \-']+?)(?:\s*\?|\s*$)/i,
  /fiber\s+(?:content\s+)?(?:of|in)\s+([a-z][a-z \-']+?)(?:\s*\?|\s*$)/i,
];

function foodPhrase(message) {
  for (const re of FOOD_PATTERNS) {
    const m = re.exec(message);
    if (!m) continue;
    const phrase = m[1].replace(/[?.!]/g, '').trim();
    if (phrase && phrase.length >= 3 && phrase.length <= 60) return phrase;
  }
  return null;
}

const DRY_BASIS_RE = /dry|uncooked/i;

async function ingredientAnswer(prisma, message) {
  const phrase = foodPhrase(message);
  if (!phrase) return null;
  let matches = await prisma.ingredient.findMany({
    where: { name: { contains: phrase, mode: 'insensitive' } },
    select: { name: true, fiberPer100g: true },
    orderBy: { name: 'asc' },
    take: 4,
  }).catch(() => []);
  if (!matches.length) {
    // Try a looser match on the last word ("dal fry" -> "dal").
    const last = phrase.split(/\s+/).pop();
    if (!last || last === phrase || last.length < 3) return null;
    matches = await prisma.ingredient.findMany({
      where: { name: { contains: last, mode: 'insensitive' } },
      select: { name: true, fiberPer100g: true },
      orderBy: { name: 'asc' },
      take: 4,
    }).catch(() => []);
    if (!matches.length) return null;
  }
  return fiberFor(matches);
}

function fiberFor(matches) {
  // Duplicate catalog rows (same name, different sources) collapse — a range
  // like "2.6–2.6" would read as nonsense.
  const seen = new Set();
  const distinct = matches.filter((m) => { const k = m.name.toLowerCase(); return seen.has(k) ? false : seen.add(k); });
  const ing = distinct[0];
  if (ing.fiberPer100g == null) {
    return `I found “${ing.name}” in the catalog, but its fiber content isn’t recorded — I’d rather say unknown than guess. A label or a similar food entry can fill the gap.`;
  }
  // Several catalog rows for one phrase (e.g. "dal" matches five dry-split
  // legume entries) means no single number is honest — report the range and
  // be explicit that these are dry-weight values. A cooked portion of dal
  // runs roughly a third of the dry figure.
  const known = distinct.filter((m) => m.fiberPer100g != null);
  const lo = Math.min(...known.map((m) => m.fiberPer100g));
  const hi = Math.max(...known.map((m) => m.fiberPer100g));
  if (known.length > 1 && lo !== hi && known.every((m) => DRY_BASIS_RE.test(m.name))) {
    return `Our catalog has ${known.length} entries matching that — all dry-weight values: ${fmt(lo)}–${fmt(hi)} g fiber per 100 g dry (e.g. ${known.slice(0, 3).map((m) => `${m.name.split(',')[0]} ~${fmt(m.fiberPer100g)} g`).join(', ')}). Cooked portions have far less per 100 g; a logged recipe’s per-serving value is the number that counts.`;
  }
  const basis = DRY_BASIS_RE.test(ing.name) ? ' (dry weight — cooked portions will be lower per 100 g)' : '';
  return `${ing.name} has about ${fmt(ing.fiberPer100g)} g of fiber per 100 g${basis}. Whether that’s “enough” depends on your portion and your daily target — your Fiber card shows today’s confirmed total.`;
}

function dailyAnswer(engine) {
  const s = engine.status;
  const t = engine.target.targetG;
  const base = s.mealsLogged === 0
    ? 'No meals are logged yet today, so nothing counts toward your fiber total yet'
    : s.confirmedG === 0 && s.unknownMeals > 0
      ? 'None of today’s logged items have measured fiber yet — confirmed fiber is 0 g, but actual intake is unknown'
      : `You’ve confirmed ${fmt(s.confirmedG)} g of fiber so far`;
  const target = t != null ? ` Today’s target is ${t} g.` : '';
  const estimated = s.estimatedG ? ` Another ~${fmt(s.estimatedG)} g is estimated (unverified).` : '';
  const unknown = s.unknownMeals ? ` ${s.unknownMeals} logged item${s.unknownMeals > 1 ? 's have' : ' has'} no fiber data — actual intake may be higher.` : '';
  const remaining = s.remainingG != null && s.remainingG > 0 ? ` ${fmt(s.remainingG)} g to go.` : s.remainingG === 0 ? ' Target reached.' : '';
  return `${base}.${target}${estimated}${unknown}${remaining}`.replace(/\.\./g, '.');
}

function suggestionAnswer(engine) {
  const picks = (engine.suggestions || []).slice(0, 3);
  if (!picks.length) return 'You’re on track — no fiber gap right now. Keep vegetables, legumes, and whole grains in the rotation.';
  const t = engine.target.targetG;
  const gap = engine.status.remainingG;
  return `You have ${gap != null ? `~${fmt(gap)} g` : 'some'} fiber left${t != null ? ` toward your ${t} g goal` : ''}. Food options: ${picks.map((p) => `${p.food} (${p.serving}, ~${p.approxFiberG} g)`).join('; ')}.`;
}

async function sequenceAnswer(prisma, userId) {
  const log = await prisma.foodLog.findFirst({
    where: { userId, nutritionSnapshot: { not: null } },
    orderBy: { loggedAt: 'desc' },
    select: { foodName: true, nutritionSnapshot: true },
  });
  const comps = log?.nutritionSnapshot?.components;
  if (!Array.isArray(comps) || !comps.length) {
    return 'Scan or log a meal with separate components first, and I can suggest an eating order. Mixed dishes like biryani don’t get a forced sequence.';
  }
  const items = comps.flatMap((c) => (Array.isArray(c.ingredients) && c.ingredients.length ? c.ingredients : [{ name: c.foodName, amountG: null }]).map((i) => ({ name: i.name || c.foodName, amountG: i.amountG ?? null })));
  const seq = await sequenceMeal(items, {});
  if (!seq.separable) return seq.explanation[0] || 'That meal’s components can’t realistically be eaten in a set order.';
  const order = seq.order.map((s) => `${s.rank}. ${s.component}`).join(' → ');
  const extra = seq.suggestedAddition ? ` Optionally start with ${seq.suggestedAddition.food} for fiber.` : '';
  return `For “${log.foodName}”: ${order}.${extra} It’s an optional suggestion, not a rule.`;
}

function supplementQuestionAnswer(message) {
  if (/how much fiber|fiber.*(in|per).*(product|serving|scoop|teaspoon|spoon)|teaspoon|tablespoon/i.test(message)) {
    return 'That depends on your exact product’s verified label — fiber per serving varies and I never guess teaspoon-to-gram conversions. In the app: Fiber card → Learn about psyllium → pick your product, and the label’s fiber per serving is shown.';
  }
  if (/can i (take|use|have)|should i (take|use)|is .*ok(ay)? to|safe/i.test(message)) {
    return `Psyllium can be an option for some people, but whether it fits you depends on your health profile and the exact product’s verified label. A few rules always apply: ${EDUCATION.points[1]} ${EDUCATION.points[2]} In the app, open Fiber → Learn about psyllium to check a specific product — food sources stay the first approach.`;
  }
  return `Psyllium (isabgol) is a soluble fiber supplement — food remains the first approach. ${EDUCATION.points[1]} If you’re considering it, the app can check your specific product’s verified label under Fiber → Learn about psyllium.`;
}

/**
 * Answer a fiber question deterministically, or decline.
 * @param {string} userId
 * @param {string} message
 * @returns {{ handled: true, topic: string, answer: string, source: string } | { handled: false }}
 */
async function groundFiberAnswer(userId, message) {
  if (typeof message !== 'string' || !isFiberQuestion(message)) return { handled: false };
  const prisma = getPrisma();
  const text = message.toLowerCase();

  try {
    // Supplement questions first — "can I take isabgol" must never be
    // interpreted as "add fiber to my meal".
    if (FIBER_SUPPLEMENT_RE.test(text) || /fiber supplement/i.test(text)) {
      return { handled: true, topic: 'fiber_supplement', answer: supplementQuestionAnswer(text), source: 'fiber-supplement-education' };
    }
    if (/eat\s+first|first.*eat|meal\s+order|food\s+order|sequenc/i.test(text)) {
      return { handled: true, topic: 'meal_sequence', answer: await sequenceAnswer(prisma, userId), source: 'fiber-sequence' };
    }
    // Food-specific questions ("does dal…", "how much fiber is in oats") must
    // resolve before the daily-total branch — "how much fiber" alone would
    // otherwise swallow them.
    const phrase = foodPhrase(text);
    if (phrase) {
      const ans = await ingredientAnswer(prisma, text);
      if (ans) return { handled: true, topic: 'ingredient_fiber', answer: ans, source: 'ingredient-catalog' };
      return { handled: true, topic: 'ingredient_fiber', answer: 'I couldn’t match that to a catalog ingredient with fiber data — try the food name from your log, or check its label.', source: 'ingredient-catalog' };
    }
    if (/add|increase|boost|more|short|low on|get more|what can i eat|tomorrow|plan|change.*meal/i.test(text)) {
      const engine = await dailyFiber(userId, { persist: false });
      return { handled: true, topic: 'fiber_suggestions', answer: suggestionAnswer(engine), source: 'fiber-daily-engine' };
    }
    if (/how much fiber|fiber.*(today|so far|have i|left|remaining)|fiber (intake|progress|total|goal)/i.test(text)) {
      const engine = await dailyFiber(userId, { persist: false });
      return { handled: true, topic: 'daily_fiber', answer: dailyAnswer(engine), source: 'fiber-daily-engine' };
    }
    // Generic fiber question → daily status is the safest useful answer.
    const engine = await dailyFiber(userId, { persist: false });
    return { handled: true, topic: 'daily_fiber', answer: dailyAnswer(engine), source: 'fiber-daily-engine' };
  } catch {
    return { handled: false }; // fall through to the generic assistant
  }
}

module.exports = { groundFiberAnswer, isFiberQuestion };
