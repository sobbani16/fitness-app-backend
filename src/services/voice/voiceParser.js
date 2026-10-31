// Deterministic voice command parser — no AI. Produces proposed actions with
// extracted entities + missing fields; the execute path re-validates and
// resolves server-side. Never trusts IDs from speech or clients.
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, a: 1, an: 1 };
const num = s => s == null ? null : (NUM[s.toLowerCase()] ?? (Number.isFinite(+s) ? +s : null));
const ML = { ml: 1, milliliter: 1, milliliters: 1, l: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000, oz: 29.5735, ounce: 29.5735, ounces: 29.5735, cup: 240, cups: 240, glass: 250, glasses: 250 };
const KG = /(kgs?|kilos?|kilograms?)/i;

const splitSegments = text =>
  String(text).split(/;|\.\s+|,\s*(?=\s*(?:and\s+)?(?:add|log|record|start|mark|finish|complete|change|remove|undo|update)\b)|\band then\b/i)
    .map(s => s.trim().replace(/^(and|then|also|please)\s+/i, '')).filter(Boolean);

function parseSegment(seg, ctx = {}) {
  const t = seg.toLowerCase().trim();

  // UNDO
  if (/^undo\b|^remove (?:the |my )?(?:last|previous|that)/.test(t))
    return { intent: 'UNDO_ACTION', entities: {}, missing: [], segment: seg, status: 'ready' };
  if (/^cancel\b/.test(t))
    return { intent: 'CANCEL_COMMAND', entities: {}, missing: [], segment: seg, status: 'ready' };

  // START / COMPLETE workout
  let m = t.match(/^(?:please )?(?:start|begin)(?:\s+my)?\s+(.+?)\s*(?:workout)?$/);
  if (m && /workout|day|session/.test(t))
    return { intent: 'START_WORKOUT', entities: { name: m[1].replace(/\s*workout$/, '') || null }, missing: [], segment: seg, status: 'ready' };
  if (/^(finish|complete|end)\b.*workout/.test(t))
    return { intent: 'COMPLETE_WORKOUT', entities: {}, missing: [], segment: seg, status: 'ready' };

  // WATER
  m = t.match(/(\d+(?:\.\d+)?|half|quarter|one|two|a|an)\s*(milliliters?|liters?|litres?|ml|l|oz|ounces?|cups?|glasses?)\s+(?:of\s+)?water/) ||
      t.match(/water\s+(\d+(?:\.\d+)?|half)\s*(milliliters?|liters?|ml|l|oz|ounces?)/);
  if (m) {
    const qty = num(m[1]); const unit = m[2].toLowerCase();
    const amountMl = Math.round(qty * (ML[unit] || 1));
    return { intent: 'LOG_WATER', entities: { amountMl, estimated: ['cup', 'cups', 'glass', 'glasses'].includes(unit) }, missing: qty ? [] : ['amountMl'], segment: seg, status: qty ? 'ready' : 'needs_review' };
  }

  // SUPPLEMENT taken
  m = t.match(/^mark\s+(?:my\s+)?(.+?)\s*(?:supplement|vitamin|pill|capsule)s?\s+(?:as\s+)?taken/) || t.match(/^took\s+(?:my\s+)?(.+?)\s*(?:supplement|vitamin)s?/);
  if (m) return { intent: 'MARK_SUPPLEMENT_TAKEN', entities: { name: m[1]?.trim() || null }, missing: m[1] ? [] : ['name'], segment: seg, status: 'ready' };

  // UPDATE last set
  m = t.match(/change\s+(?:the\s+|my\s+)?(?:last|previous)\s+set\s+to\s+(\d+)\s*reps?/) ||
      t.match(/(?:last|previous)\s+set\s+to\s+(\d+)\s*reps?/);
  if (m) return { intent: 'UPDATE_EXERCISE_SET', entities: { reps: +m[1] }, missing: ctx.lastSetId ? [] : ['set'], segment: seg, status: ctx.lastSetId ? 'ready' : 'needs_review' };

  // EXERCISE SET(S) — explicit
  m = t.match(/(\d+|one|two|three|four|five)\s+sets?\s+of\s+(.+)/);
  if (m) {
    const sets = num(m[1]);
    const rest = m[2];
    const repsM = rest.match(/(\d+)\s*reps?/);
    const weightM = rest.match(/(\d+(?:\.\d+)?)\s*(lbs?|pounds?|kgs?|kilos?|kilograms?)/);
    const name = rest.replace(/,?\s*\d+\s*reps?.*$/, '').replace(/,?\s*(?:at|@)\s*\d+(?:\.\d+)?\s*(?:lbs?|pounds?|kgs?|kilos?|kilograms?).*$/, '').trim();
    return {
      intent: 'LOG_EXERCISE_SET',
      entities: {
        exerciseName: name || null, sets,
        reps: repsM ? +repsM[1] : null,
        weight: weightM ? +weightM[1] : null,
        weightUnit: weightM ? (KG.test(weightM[2]) ? 'kg' : 'lbs') : (ctx.weightUnit || 'lbs'),
      },
      missing: [name ? null : 'exercise', repsM ? null : 'reps', sets ? null : 'sets'].filter(Boolean),
      segment: seg, status: name && repsM ? 'ready' : 'needs_review',
    };
  }

  // Contextual set: "same weight, 10 more reps" / "another set of 8"
  m = t.match(/same weight[,\s]+(\d+)\s*(?:more\s+)?reps?/) || t.match(/(?:another|one more|again)\s*(?:set)?\s*(?:of|for)?\s*(\d+)\s*reps?/);
  if (m) {
    const ex = ctx.lastExercise || null; const w = ctx.lastWeight ?? null;
    return { intent: 'LOG_EXERCISE_SET', entities: { exerciseName: ex, sets: 1, reps: +m[1], weight: w, weightUnit: ctx.weightUnit || 'lbs' },
      missing: [ex ? null : 'exercise', w != null ? null : 'weight'].filter(Boolean), segment: seg, status: ex ? 'ready' : 'needs_review' };
  }

  // Loose exercise add: "add bench press" / "log squats"
  m = t.match(/^(?:add|log|record|do)\s+(.+?)(?:\s+(?:for|at)\s+(\d+)\s*(lbs?|pounds?|kgs?))?(?:\s+(?:for|x)\s+(\d+)\s*reps?)?$/);
  if (m && !/food|eat|ate|meal|water|supplement|workout|weight|breakfast|lunch|dinner|snack|\d+\s*(?:g|grams?|milliliters?|ml|oz|ounces?|cups?|glasses?|liters?|litres?)\b/.test(m[1])) {
    const name = m[1].trim();
    return { intent: 'LOG_EXERCISE_SET', entities: { exerciseName: name, sets: 1, reps: m[4] ? +m[4] : null, weight: m[2] ? +m[2] : null, weightUnit: m[3] ? (KG.test(m[3]) ? 'kg' : 'lbs') : (ctx.weightUnit || 'lbs') },
      missing: [m[4] ? null : 'reps'].filter(Boolean), segment: seg, status: 'needs_review' };
  }

  // FOOD — items split on commas / "and"
  if (/log|add|ate|had|eat|meal|breakfast|lunch|dinner|snack/.test(t)) {
    const mealType = (t.match(/breakfast|lunch|dinner|snack/) || [])[0] || 'meal';
    const cleaned = seg.replace(/^(please\s+)?(log|add|record|i\s+ate|i\s+had|i\s+eat)\s*/i, '')
      .replace(/\b(for|as)\s+(breakfast|lunch|dinner|snack)\b.*$/i, '').trim();
    const items = cleaned.split(/,\s*(?:and\s+)?|\s+and\s+|\s+with\s+/).map(raw => {
      const s = raw.replace(/^(a|an|some|the)\s+/, '').trim(); if (!s) return null;
      const g = s.match(/(\d+(?:\.\d+)?)\s*(?:g|grams?)\s+(?:of\s+)?(.+)/);
      if (g) return { name: g[2].trim(), grams: +g[1], unit: 'g' };
      const c = s.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(tsp|tbsp|teaspoons?|tablespoons?|slices?|pieces?|cups?|bowls?|scoops?|handfuls?)\s+(?:of\s+)?)?(.+)/);
      if (c) return { name: c[3].trim(), quantity: num(c[1]), unit: c[2] ? c[2].replace(/s$/, '') : 'servings', grams: null };
      return { name: s, grams: null, unit: 'unknown' };
    }).filter(Boolean);
    if (items.length) return { intent: 'LOG_FOOD', entities: { items, mealType }, missing: items.some(i => i.grams == null) ? ['grams'] : [], segment: seg, status: items.every(i => i.grams != null) ? 'ready' : 'needs_review' };
  }

  return { intent: 'UNKNOWN_INTENT', entities: {}, missing: ['intent'], segment: seg, status: 'needs_review' };
}

const parseTranscript = (text, ctx = {}) => ({
  transcript: String(text).slice(0, 1000),
  actions: splitSegments(text).map(s => parseSegment(s, ctx)),
});

module.exports = { parseTranscript };
