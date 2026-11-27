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

// Safety capture — voice-reported injuries and symptoms feed the shared
// activity-safety context, so they must never be parsed as log commands.
const BODY_PARTS = {
  'lower back': 'lower_back', 'low back': 'lower_back',
  ankle: 'ankle', knee: 'knee', hip: 'hip', shoulder: 'shoulder', wrist: 'wrist',
  elbow: 'elbow', neck: 'neck', back: 'lower_back', hand: 'hand', foot: 'foot',
  leg: 'leg', arm: 'arm', thigh: 'thigh', calf: 'calf', achilles: 'achilles',
  hamstring: 'hamstring', groin: 'groin', pelvis: 'pelvis', shin: 'shin',
};
const INJURY_TYPES = {
  sprain: 'sprain', sprained: 'sprain', strain: 'strain', strained: 'strain',
  pull: 'strain', pulled: 'strain', fracture: 'fracture', broke: 'fracture', broken: 'fracture',
  dislocat: 'dislocation', tore: 'tear', torn: 'tear', twist: 'sprain', twisted: 'sprain',
  hurt: 'unspecified', injured: 'unspecified',
};
const SYMPTOM_PATTERNS = [
  [/chest (?:pain|pressure|tightness)/, 'chest_pain'],
  [/faint|passed out|pass out|blacked out|syncope/, 'syncope'],
  [/(?:unusual|severe)\s*(?:shortness of )?breath|short of breath|can't breathe|cant breathe|can'?t catch (?:my )?breath/, 'dyspnea_unusual'],
  [/shortness of breath|breathless/, 'shortness_breath_exertion'],
  [/dizz|light.?headed/, 'dizziness'],
  [/palpitation|heart (?:is )?(?:racing|flutter)/, 'palpitations'],
  [/severe (?:head )?ache|worst headache/, 'severe_headache_sudden'],
  [/severe pain|pain .*(?:8|9|10)(?:\s*\/\s*10)?|can't bear weight|cant bear weight/, 'severe_pain'],
  [/(?:joint|knee|ankle) .*(?:gives? (?:way|out)|unstable|buckles)/, 'joint_instability'],
  [/fever|feeling (?:really )?(?:sick|unwell|ill)|flu/, 'fever'],
  [/vision (?:changes|blur)/, 'vision_changes'],
  [/numb(?:ness)?|tingling (?:in my )?(?:arm|hand|face|leg)/, 'numbness_neuro'],
  [/bleeding/, 'pregnancy_bleeding'], // pregnancy context verified downstream; still routes to review
  [/low (?:blood )?sugar|hypoglyc/, 'hypoglycemia'],
  [/weak(?:ness)? (?:in my|on (?:my )?(?:left|right))/, 'abnormal_weakness'],
];

// Strip trailing temporal/qualifier words and resolve to a catalog part.
function extractPart(raw) {
  let s = String(raw || '').trim();
  for (let words = s.split(' '); words.length; words.pop()) {
    const cand = words.join(' ');
    if (BODY_PARTS[cand]) return { part: BODY_PARTS[cand], raw: cand };
    if (BODY_PARTS[cand.replace(/s$/, '')]) return { part: BODY_PARTS[cand.replace(/s$/, '')], raw: cand };
  }
  return { part: null, raw: s };
}

function safetySegment(seg, t) {
  // Injury: "I injured/hurt/sprained my [left|right|both] <body part> [yesterday|today|...]"
  let m = t.match(/\b(?:i\s+)?(?:just\s+)?(injur\w+|hurt|sprain\w+|strain\w+|pull(?:ed)?|fractur\w+|brok\w+|tore|torn|twist\w+|dislocat\w+)\s+(?:my\s+)?((?:left|right|both)\s+)?([a-z ]+?)(?:\s+(?:yesterday|today|this morning|last night|earlier|last week|on\s+\w+day|ago|at|during|while|badly|really))?[.\s!]*$/);
  if (m && /\binjur|hurt|sprain|strain|pull|fractur|brok|tore|torn|twist|dislocat/.test(m[1])) {
    const { part, raw } = extractPart(m[3]);
    const laterality = /both/.test(m[2] || '') ? 'bilateral' : /(left|right)/.test(m[2] || '') ? m[2].trim() : 'na';
    const typeWord = Object.keys(INJURY_TYPES).find(k => m[1].startsWith(k)) || 'unspecified';
    if (part) {
      return { intent: 'REPORT_INJURY', entities: { bodyPart: part, laterality, type: INJURY_TYPES[typeWord] || 'unspecified' }, missing: [], segment: seg, status: 'ready' };
    }
    // Unresolvable body part — capture via needs_review so nothing is lost.
    return { intent: 'REPORT_INJURY', entities: { bodyPart: raw || null, laterality, type: INJURY_TYPES[typeWord] || 'unspecified' }, missing: ['bodyPart'], segment: seg, status: 'needs_review' };
  }
  // "my knee really hurts" / "my ankle hurts when I walk"
  m = t.match(/\bmy\s+((?:left|right|both)\s+)?([a-z ]+?)\s+(?:really\s+)?(?:hurts?|is (?:really )?sore|is killing me|aches?)\b/);
  if (m) {
    const { part } = extractPart(m[2]);
    if (part) {
      return { intent: 'REPORT_INJURY', entities: { bodyPart: part, laterality: /both/.test(m[1] || '') ? 'bilateral' : /(left|right)/.test(m[1] || '') ? m[1].trim() : 'na', type: 'unspecified' }, missing: [], segment: seg, status: 'ready' };
    }
  }
  // Symptoms — coded reports that drive escalation
  const codes = [];
  for (const [re, code] of SYMPTOM_PATTERNS) if (re.test(t)) codes.push(code);
  if (codes.length) {
    return { intent: 'REPORT_SYMPTOM', entities: { symptoms: [...new Set(codes)] }, missing: [], segment: seg, status: 'ready' };
  }
  return null;
}

function parseSegment(seg, ctx = {}) {
  const t = seg.toLowerCase().trim();

  // SAFETY — injuries and symptoms are captured before any logging intent.
  const safety = safetySegment(seg, t);
  if (safety) return safety;

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

  // GROCERY — "add milk and eggs to my grocery list". Must precede FOOD/exercise
  // branches: 'add' is a shared trigger word. Mass units become amountG;
  // countable phrasing keeps a count unitLabel and never fabricates grams.
  if (/\b(?:grocery|shopping)\s*list\b/.test(t) && /add|put|need|buy|get|pick/.test(t)) {
    const before = seg.slice(0, seg.toLowerCase().search(/\b(?:grocery|shopping)\s*list\b/));
    const cleaned = before.replace(/\b(?:to|on)\s+(?:my\s+|the\s+)?$/i, '')
      .replace(/^(please\s+)?(add|put|need|buy|get|pick\s+up)\s*/i, '').trim();
    const items = cleaned.split(/,\s*(?:and\s+)?|\s+and\s+/).map(raw => {
      const s = raw.replace(/^(a|an|some|the)\s+/i, '').trim(); if (!s) return null;
      const kg = s.match(/(\d+(?:\.\d+)?)\s*(?:kgs?|kilos?|kilograms?)\s+(?:of\s+)?(.+)/i);
      if (kg) return { name: kg[2].trim(), amountG: Math.round(+kg[1] * 1000), unitLabel: null };
      const g = s.match(/(\d+(?:\.\d+)?)\s*(?:g|grams?)\s+(?:of\s+)?(.+)/i);
      if (g) return { name: g[2].trim(), amountG: +g[1], unitLabel: null };
      const c = s.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(packs?|boxes?|bottles?|cans?|bags?|cartons?|dozen)\s+(?:of\s+)?)?(.+)/i);
      if (c) return { name: c[3].trim(), amountG: null, unitLabel: `${num(c[1]) ?? c[1]} ${c[2] ? c[2].toLowerCase().replace(/s$/, '') : 'pcs'}` };
      return { name: s, amountG: null, unitLabel: null };
    }).filter(Boolean);
    if (items.length) return { intent: 'ADD_GROCERY', entities: { items }, missing: [], segment: seg, status: 'ready' };
    return { intent: 'ADD_GROCERY', entities: { items: [] }, missing: ['items'], segment: seg, status: 'needs_review' };
  }

  // RECIPE — "log the palak paneer recipe for dinner". Requires the word
  // 'recipe' so ordinary food phrasing stays on LOG_FOOD.
  if (/\brecipe\b/.test(t) && /log|add|record|ate|had|eat/.test(t)) {
    const mealType = (t.match(/breakfast|lunch|dinner|snack/) || [])[0] || 'meal';
    const servingsM = t.match(/(\d+|one|two|three|four|five|six)\s+servings?\s+(?:of\s+)?/);
    const name = seg.replace(/^(please\s+)?(log|add|record|i\s+ate|i\s+had|i\s+eat)\s*/i, '')
      .replace(/\b(for|as)\s+(breakfast|lunch|dinner|snack)\b.*$/i, '')
      .replace(/\b\d+\s+servings?\s+(?:of\s+)?/i, '')
      .replace(/\b(one|two|three|four|five|six)\s+servings?\s+(?:of\s+)?/i, '')
      .replace(/\brecipes?\b/ig, '').replace(/^(a|an|some|the)\s+/i, '').trim();
    return {
      intent: 'LOG_RECIPE',
      entities: { recipeName: name || null, servings: servingsM ? num(servingsM[1]) : 1, mealType },
      // Always needs_review until interpret resolves a catalog/own recipe match.
      missing: name ? [] : ['recipeName'], segment: seg, status: 'needs_review',
    };
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
  // Count-led phrasing ("log 2 boiled eggs", "log 2 dosas") is the dominant
  // spoken FOOD shape — it only stays exercise when it carries explicit reps
  // structure (m[4]); otherwise it falls through to the FOOD branch, where
  // unresolved servings are asked about rather than mislogged as exercise.
  const countLed = /^(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+/i.test(m ? m[1] : '');
  const unitLed = /^(?:a|an)?\s*(?:tsp|tbsp|teaspoons?|tablespoons?|slices?|pieces?|cups?|bowls?|scoops?|handfuls?)\s+/i.test(m ? m[1] : '');
  const foodShaped = (countLed || unitLed) && !m[4];
  if (m && !foodShaped && !/food|eat|ate|meal|water|supplement|workout|weight|breakfast|lunch|dinner|snack|yesterday|\d+\s*(?:g|grams?|milliliters?|ml|oz|ounces?|cups?|glasses?|liters?|litres?)\b/.test(m[1])) {
    const name = m[1].trim();
    return { intent: 'LOG_EXERCISE_SET', entities: { exerciseName: name, sets: 1, reps: m[4] ? +m[4] : null, weight: m[2] ? +m[2] : null, weightUnit: m[3] ? (KG.test(m[3]) ? 'kg' : 'lbs') : (ctx.weightUnit || 'lbs') },
      missing: [m[4] ? null : 'reps'].filter(Boolean), segment: seg, status: 'needs_review' };
  }

  // COPY_MEAL — "same breakfast as yesterday" / "copy yesterday's lunch".
  // Precedence over generic food logging: no food items are named.
  let cm = t.match(/^(?:the\s+)?same\s+(breakfast|lunch|dinner|snack|meal)\s+as\s+(yesterday|last\s+\w+day)/) ||
           t.match(/^copy\s+yesterday(?:'s)?\s+(breakfast|lunch|dinner|snack|meal)/);
  if (cm) {
    const mealType = (cm[1] && /^(breakfast|lunch|dinner|snack|meal)$/.test(cm[1])) ? cm[1] : cm[2];
    return { intent: 'COPY_MEAL', entities: { mealType, dayOffset: -1 }, missing: [], segment: seg, status: 'ready' };
  }

  // UPDATE_MEAL — "change lunch rice to 200g". Exercise-set updates matched
  // earlier keep precedence (their pattern is reps-based, not grams).
  let um = t.match(/^(?:change|update|adjust)\s+(?:(breakfast|lunch|dinner|snack)\s+)?(.+?)\s+to\s+(\d+(?:\.\d+)?)\s*(?:g|grams?)\s*$/) ||
           t.match(/^(?:change|update|adjust)\s+(?:(breakfast|lunch|dinner|snack)\s+)?(.+?)\s+to\s+(\d+(?:\.\d+)?)\s*(?:g|grams?)\b/);
  if (um && !/set|rep\b|weight|workout|exercise/.test(um[2])) {
    return { intent: 'UPDATE_MEAL', entities: { mealType: um[1] || null, foodName: um[2].trim(), grams: +um[3] }, missing: [], segment: seg, status: 'ready' };
  }

  // FOOD — items split on commas / "and"
  if (/log|add|ate|had|eat|meal|breakfast|lunch|dinner|snack|^\d+(?:\.\d+)?\s*(?:g|grams?)\s/.test(t)) {
    const mealType = (t.match(/breakfast|lunch|dinner|snack/) || [])[0] || 'meal';
    const cleaned = seg.replace(/^(please\s+)?(log|add|record|i\s+ate|i\s+had|i\s+eat)\s*/i, '')
      .replace(/\b(for|as)\s+(breakfast|lunch|dinner|snack)\b.*$/i, '').trim();
    const items = cleaned.split(/,\s*(?:and\s+)?|\s+and\s+|\s+with\s+|\s*\+\s*/).map(raw => {
      const s = raw.replace(/^(a|an|some|the)\s+/, '').trim(); if (!s) return null;
      const g = s.match(/(\d+(?:\.\d+)?)\s*(?:g|grams?)\s+(?:of\s+)?(.+)/);
      if (g) return { name: g[2].trim(), grams: +g[1], unit: 'g' };
      const c = s.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(tsp|tbsp|teaspoons?|tablespoons?|slices?|pieces?|cups?|bowls?|scoops?|handfuls?)\s+(?:of\s+)?)?(.+)/);
      if (c) return { name: c[3].trim(), quantity: num(c[1]), unit: c[2] ? c[2].replace(/s$/, '') : 'servings', grams: null };
      const u = s.match(/^(?:a|an)?\s*(tsp|tbsp|teaspoons?|tablespoons?|slice|pieces?|cups?|bowls?|scoops?|handfuls?)\s+(?:of\s+)?(.+)/i);
      if (u) return { name: u[2].trim(), quantity: 1, unit: u[1].toLowerCase().replace(/s$/, ''), grams: null };
      return { name: s, grams: null, unit: 'unknown' };
    }).filter(Boolean);
    if (items.length) {
      const dayOffset = /\byesterday\b/.test(t) ? -1 : 0;
      for (const it of items) it.name = it.name.replace(/\s+yesterday\s*$/, '').trim();
      return { intent: 'LOG_FOOD', entities: { items, mealType, ...(dayOffset ? { dayOffset } : {}) }, missing: items.some(i => i.grams == null) ? ['grams'] : [], segment: seg, status: items.every(i => i.grams != null) ? 'ready' : 'needs_review' };
    }
  }

  return { intent: 'UNKNOWN_INTENT', entities: {}, missing: ['intent'], segment: seg, status: 'needs_review' };
}

const parseTranscript = (text, ctx = {}) => ({
  transcript: String(text).slice(0, 1000),
  actions: splitSegments(text).map(s => parseSegment(s, ctx)),
});

module.exports = { parseTranscript };
