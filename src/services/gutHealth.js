// Gut health intelligence v2 — personalized fiber vs target, weekly plant
// diversity, symptom trends. Reuses the canonical fiber engine
// (fiber/targets + fiber/dailyEngine.fiberStateOf) and the shared local-day
// infrastructure so this summary can never disagree with /fiber endpoints.
//
// Invariants:
//   - Unknown fiber is never treated as zero — it lowers completeness.
//   - Plant diversity counts VERIFIED plant categories only; animal-derived
//     categories never count, and unclassified logs are reported honestly.
//   - The window is the last 7 user-local calendar days (weekly diversity
//     guidance is weekly — a 14-day window misleads).
//   - Database failures propagate — an empty summary must mean "no data",
//     never "the database was unreachable".
//   - No microbiome score, no causal claims (correlation ≠ trigger),
//     restrictive diets are never auto-initiated.
const { getPrisma } = require('../lib/prisma');
const { resolveFiberTarget } = require('./fiber/targets');
const { fiberStateOf } = require('./fiber/dailyEngine');
const { dayKey, dayRangeUtc, resolveZone } = require('./localDay');
const { classifyGutFood, gutFacetsOf } = require('./gut/taxonomy');

const SUMMARY_VERSION = 'gut-health-v2';
const WINDOW_DAYS = 7;
const SYMPTOMS = ['bloating', 'gas', 'constipation', 'diarrhea', 'reflux', 'abdominal', 'stool_frequency'];
const TOLERANCE_KINDS = ['suspected', 'intolerance', 'dislike', 'exclusion']; // 'allergy' lives in Allergy — never here

// --- Plant-diversity policy ---------------------------------------------------
// A log counts toward weekly plant diversity only when ALL of these hold:
//   1. The log is linked to a catalog ingredient whose category classifies
//      as plant (animal-derived categories never count, mixed or unknown
//      categories are reported as unclassified — never assumed plant).
//   2. The logged quantity is >= PLANT_MIN_SERVING_G.
//      >>> PLANT_MIN_SERVING_G is an application counting policy — a
//      "meaningful serving" filter so seasoning dustings do not inflate the
//      count. It is NOT a scientifically established minimum intake and is
//      never presented as a clinical recommendation. <<<
//   3. The canonical plant key (preparation tokens stripped, aliases resolved
//      to the same catalog row, Unicode-preserving normalization) is new —
//      raw vs cooked spinach is ONE plant, not two.
// Recipe ingredients cannot be resolved: FoodLog links at the ingredient
// level only. That limitation is reported in coverage.notes.
const PLANT_MIN_SERVING_G = 5;

// Category vocabulary comes from the Humai ingredient catalog
// (IngredientCatalog.category). Deterministic matching only — a mixed
// category such as "Legumes proteins dairy seafood" resolves to 'unknown'
// rather than guessing plant or animal. "Alternative" products (dairy
// alternative etc.) resolve to 'unknown': the category name cannot
// establish botanical origin.
const ANIMAL_CATEGORY_RE = /\b(dairy|milk|cheese|eggs?|poultry|chicken|meat|seafood|fish|shellfish|prawn|whey|beef|pork|mutton|animal)\b/i;
const PLANT_CATEGORY_RE = /fruit|vegetable|leafy|greens?|herbs?|pulses?|legumes?|lentils?|grains?|millets?|cereals?|flours?|atta|rice|oats?|nuts?|seeds?|tubers?|mushrooms?|fungus|fungi|algae|spices?|aromatics?|produce|bread|baker|pasta/i;
const AMBIGUOUS_CATEGORY_RE = /alternatives?|substitutes?|analogs?/i;

function classifyPlantCategory(category) {
  const c = String(category || '');
  if (!c) return 'unknown';
  if (AMBIGUOUS_CATEGORY_RE.test(c)) return 'unknown';
  const plant = PLANT_CATEGORY_RE.test(c), animal = ANIMAL_CATEGORY_RE.test(c);
  if (plant && animal) return 'unknown'; // mixed bucket — honest, not guessed
  if (animal) return 'animal';
  return plant ? 'plant' : 'unknown';
}

// Preparation and processing tokens stripped so "spinach raw" and "spinach
// cooked" deduplicate to one plant identity. Unicode-aware: letters and
// numbers in ANY script survive — a Telugu or Hindi food name keeps its
// canonical identity instead of collapsing to an empty key.
const PREP_TOKEN_RE = /\b(raw|cooked|boiled|steamed|fried|roasted|dried|fresh|frozen|canned|baked|grilled|unsalted|salted|plain|instant|powdered?)\b/g;

function normalizeFoodName(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(PREP_TOKEN_RE, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function plantKeyFor(catalog, ingredient) {
  const base = normalizeFoodName(catalog?.normalizedName || ingredient?.normalizedName || '');
  return base || catalog?.identityKey || catalog?.id || ingredient?.id || null;
}

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/**
 * Weekly gut-health summary.
 * @param {string} userId
 * @param {object} [opts]
 * @param {string} [opts.tz] - IANA zone override (default: user.timeZone)
 */
// Infrastructure failures surface as a documented 503 — never as an empty
// summary that reads as "you logged nothing".
function serviceUnavailable(cause) {
  const e = new Error('Gut health data is temporarily unavailable.');
  e.status = 503;
  e.publicCode = 'SERVICE_UNAVAILABLE';
  e.cause = cause;
  return e;
}

async function getGutHealthSummary(userId, { tz } = {}) {
  const prisma = getPrisma();
  let user;
  try {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, dateOfBirth: true, gender: true, timeZone: true },
    });
  } catch (e) { throw serviceUnavailable(e); }
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }
  const zone = resolveZone(tz, user.timeZone);

  const today = dayKey(new Date(), zone);
  const days = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.parse(`${today}T12:00:00Z`));
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const rangeStart = dayRangeUtc(days[0], zone).startUtc;
  const rangeEnd = dayRangeUtc(today, zone).endUtc;

  // No silent catch on the data-bearing queries — a DB failure surfaces as a
  // documented 503 rather than a fabricated "you logged nothing" summary.
  let macroGoal, conditions, logs, symptoms, tolerances;
  try {
    [macroGoal, conditions, logs, symptoms, tolerances] = await Promise.all([
    prisma.macroGoal.findUnique({ where: { userId } }),
    prisma.userHealthCondition.findMany({ where: { userId, active: true }, include: { condition: { select: { name: true } } } }),
    prisma.foodLog.findMany({
      where: { userId, loggedAt: { gte: rangeStart, lt: rangeEnd } },
      select: { id: true, foodName: true, mealType: true, quantityG: true, fiberG: true, ingredientId: true, nutritionSnapshot: true, loggedAt: true },
    }),
    prisma.gutSymptom.findMany({
      where: { userId, loggedAt: { gte: rangeStart, lt: rangeEnd } },
      select: { symptom: true, severity: true, loggedAt: true },
      orderBy: { loggedAt: 'desc' },
    }),
      prisma.foodTolerance.findMany({
        where: { userId }, select: { foodName: true, kind: true, note: true },
        orderBy: { createdAt: 'desc' }, take: 100,
      }),
    ]);
  } catch (e) { throw serviceUnavailable(e); }

  const conditionNames = (conditions || []).map((c) => c.condition?.name).filter(Boolean);
  const target = resolveFiberTarget({ dateOfBirth: user.dateOfBirth, gender: user.gender, macroGoal, conditionNames });

  // --- Fiber: confirmed/estimated/unknown over the window -------------------
  // Defensive local-day filter: the window is defined by user-local day keys,
  // so a log outside it is dropped here even if a caller widened the query.
  const daySet = new Set(days);
  const windowLogs = logs.filter((l) => daySet.has(dayKey(new Date(l.loggedAt), zone)));

  const loggedDays = new Set();
  let confirmedG = 0, estimatedG = 0, unknownMeals = 0;
  for (const log of windowLogs) {
    loggedDays.add(dayKey(new Date(log.loggedAt), zone));
    const state = fiberStateOf(log);
    if (state === 'confirmed') confirmedG += log.fiberG;
    else if (state === 'estimated') estimatedG += log.fiberG;
    else unknownMeals += 1;
  }
  const daysLogged = loggedDays.size;
  // Average over days that actually logged food — dividing by the whole
  // window would read skipped logging days as low intake.
  const avgConfirmed = daysLogged ? confirmedG / daysLogged : null;
  // Known-and-estimated subtotal: estimated fiber is real information about
  // intake (a review-marked estimate is not unknown) — it must count toward
  // any "is intake low" judgment, while staying clearly separated from the
  // confirmed figure. Confirmed 8 g + estimated 24 g is NOT a low-fiber week.
  const combinedG = confirmedG + estimatedG;
  const avgCombined = daysLogged ? combinedG / daysLogged : null;

  // --- Weekly plant diversity -------------------------------------------------
  const ingredientIds = [...new Set(windowLogs.map((l) => l.ingredientId).filter(Boolean))];
  let ingredients = [], attributeRows = [];
  try {
    [ingredients, attributeRows] = ingredientIds.length
      ? await Promise.all([
          prisma.ingredient.findMany({
            where: { id: { in: ingredientIds } },
            select: { id: true, normalizedName: true, catalog: { select: { id: true, identityKey: true, normalizedName: true, category: true } } },
          }),
          prisma.ingredientAttribute.findMany({
            where: { ingredientId: { in: ingredientIds } },
            select: { ingredientId: true, attribute: true },
          }),
        ])
      : [[], []];
  } catch (e) { throw serviceUnavailable(e); }
  const ingById = new Map(ingredients.map((i) => [i.id, i]));
  const attrByIngId = new Map();
  for (const a of attributeRows) {
    if (!attrByIngId.has(a.ingredientId)) attrByIngId.set(a.ingredientId, []);
    attrByIngId.get(a.ingredientId).push(a.attribute);
  }

  const plants = new Map(); // plantKey -> display name
  let countedPlantLogs = 0, animalLogs = 0, unclassifiedLogs = 0, belowServingLogs = 0;
  for (const log of windowLogs) {
    const ing = log.ingredientId ? ingById.get(log.ingredientId) : null;
    const cls = ing ? classifyPlantCategory(ing.catalog?.category) : 'unknown';
    if (cls === 'animal') { animalLogs += 1; continue; }
    if (cls !== 'plant') { unclassifiedLogs += 1; continue; }
    if (!Number.isFinite(log.quantityG) || log.quantityG < PLANT_MIN_SERVING_G) { belowServingLogs += 1; continue; }
    countedPlantLogs += 1;
    const key = plantKeyFor(ing.catalog, ing);
    if (key && !plants.has(key)) plants.set(key, ing.catalog?.normalizedName || ing.normalizedName || key);
  }

  // --- Gut-taxonomy occasions --------------------------------------------------
  // Occasions deduplicate per (local day + canonical food identity): repeated
  // logging rows or portion edits of the same food on one day are ONE
  // occasion, not many. Classification comes from the canonical taxonomy —
  // attributes > catalog category > name heuristics ('suspected' ceiling).
  const occasionMap = new Map(); // day|canonicalKey -> occasion
  const facetOccasions = { fermented: 0, live_culture: 0, probiotic: 0, prebiotic: 0, resistant_starch: 0, synbiotic: 0, postbiotic: 0 };
  const facetSet = { fermented: new Set(), live_culture: new Set(), probiotic: new Set(), prebiotic: new Set(), resistant_starch: new Set(), synbiotic: new Set(), postbiotic: new Set() };
  for (const log of windowLogs) {
    const ing = log.ingredientId ? ingById.get(log.ingredientId) : null;
    const cls = classifyGutFood({ foodName: log.foodName, catalog: ing?.catalog, attributes: attrByIngId.get(log.ingredientId) });
    const facets = gutFacetsOf(cls);
    if (!facets.length) continue;
    const canonical = ing?.catalog?.identityKey || ing?.catalog?.id || log.ingredientId || normalizeFoodName(log.foodName) || log.id;
    const day = dayKey(new Date(log.loggedAt), zone);
    const key = `${day}|${canonical}`;
    if (!occasionMap.has(key)) occasionMap.set(key, { day, foodName: log.foodName, classification: cls });
    for (const f of facets) facetSet[f].add(key);
  }
  for (const f of Object.keys(facetOccasions)) facetOccasions[f] = facetSet[f].size;
  const gutOccasions = [...occasionMap.values()].map((o) => ({
    day: o.day,
    food: o.foodName,
    fermentation: o.classification.fermentation,
    liveCultures: o.classification.liveCultures,
    probiotic: o.classification.probiotic,
    prebiotic: o.classification.prebiotic,
    resistantStarch: o.classification.resistantStarch,
    basis: o.classification.basis,
  }));
  const suspectedFermented = gutOccasions.filter((o) => o.fermentation === 'suspected').length;

  // --- Symptoms ---------------------------------------------------------------
  const symptomCounts = {};
  for (const s of symptoms) symptomCounts[s.symptom] = (symptomCounts[s.symptom] || 0) + 1;
  const topSymptoms = Object.entries(symptomCounts).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([symptom, count]) => ({ symptom, count }));

  // --- Completeness: coverage of logged data, never a verdict on the user -----
  const unknownShare = windowLogs.length ? unknownMeals / windowLogs.length : 0;
  const completeness = windowLogs.length === 0 ? 'none'
    : unknownShare > 0.5 ? 'low'
    : daysLogged >= 3 && unknownShare <= 0.25 ? 'good' : 'partial';

  // --- Signals ------------------------------------------------------------------
  // Two distinct kinds: 'intake_opportunity' (the data supports a habit-level
  // nudge) vs 'data_quality' (the record is too thin for a conclusion). An
  // intake signal fires only when coverage is worth trusting — enough logged
  // days, a majority-known fiber record, and enough resolved identities to
  // describe variety. Confirmed-only lows with substantial ESTIMATED fiber
  // are never read as low intake: the combined known+estimated subtotal is
  // the comparison basis, labeled by what fed it.
  const signals = [];
  if (daysLogged >= 3 && unknownShare <= 0.5 && target.targetG != null && avgCombined < target.targetG * 0.6) {
    const basis = estimatedG > 0 ? 'confirmed_plus_estimated' : 'confirmed';
    signals.push({ key: 'low_fiber', kind: 'intake_opportunity', basis, detail: `Known+estimated fiber averaged ~${round1(avgCombined)} g/day on logged days vs your ${target.targetG} g target.` });
  }
  // Identity coverage: how much of the logged week resolved to a plant-or-
  // animal classification. narrow_variety is suppressed when coverage is
  // thin — low observed variety on a thin record is a data-quality fact,
  // not an intake fact. The 10-plant threshold is a product-defined flag
  // (far enough below the ~30/week research association to be a useful
  // nudge), never a clinical cutoff.
  const resolvedLogs = countedPlantLogs + animalLogs;
  const resolvedShare = windowLogs.length ? resolvedLogs / windowLogs.length : 0;
  if (plants.size > 0 && plants.size < 10 && daysLogged >= 3 && resolvedShare >= 0.6) {
    signals.push({ key: 'narrow_variety', kind: 'intake_opportunity', threshold: 10, detail: `${plants.size} distinct plant foods observed in logged items over the last 7 days — a product-defined flag, not a clinical cutoff.` });
  }
  if (windowLogs.length > 0 && resolvedShare < 0.6) {
    signals.push({ key: 'thin_identity_coverage', kind: 'data_quality', detail: `${unclassifiedLogs} of ${windowLogs.length} logged items have unclassified identities — the variety count reflects resolved items only.` });
  }
  if (windowLogs.length > 0 && unknownShare > 0.5) {
    signals.push({ key: 'thin_fiber_data', kind: 'data_quality', detail: `${unknownMeals} of ${windowLogs.length} logged items have no fiber data — actual intake may be higher than confirmed.` });
  }
  if (daysLogged > 0 && daysLogged < 3) {
    signals.push({ key: 'thin_log_coverage', kind: 'data_quality', detail: `${daysLogged} day${daysLogged > 1 ? 's' : ''} logged in the last 7 — too thin for a weekly trend.` });
  }

  return {
    version: SUMMARY_VERSION,
    window: { start: days[0], end: today, days: WINDOW_DAYS, timezone: zone },
    fiber: {
      target: { targetG: target.targetG, basis: target.basis, reference: target.reference, reviewRequired: target.reviewRequired, restrictions: target.restrictions },
      confirmedG: round1(confirmedG),
      estimatedG: round1(estimatedG),
      knownAndEstimatedG: round1(combinedG),
      unknownMeals,
      avgConfirmedPerLoggedDayG: round1(avgConfirmed),
      avgKnownAndEstimatedPerLoggedDayG: round1(avgCombined),
      daysLogged,
      note: 'Confirmed, estimated and unknown contributions stay separate — the combined subtotal is the basis for intake signals, never the confirmed figure alone.',
    },
    plantVariety: {
      windowDays: WINDOW_DAYS,
      distinctPlants: plants.size,
      plants: [...plants.values()].sort(),
      countedLogs: countedPlantLogs,
      excludedAnimalLogs: animalLogs,
      unclassifiedLogs,
      belowServingLogs,
      identityCoverage: { resolvedShare: round1(resolvedShare * 100) / 100 },
      policy: `Plant foods count at logged servings of ${PLANT_MIN_SERVING_G} g or more — an application counting policy for meaningful servings, not a scientifically established minimum and not a clinical recommendation. Identities deduplicate across preparation and alias variants; animal-derived and unclassified items never inflate the count.`,
      conventions: {
        fungi: 'Mushrooms and other fungi count under the dietary-diversity convention used in plant-variety research (the ~30-different-plant-foods/week association counts fungi alongside botanical plants) — a counting convention, not a botanical claim.',
        cultivars: 'Foods resolving to the same canonical identity count once; distinct named foods count separately. Cultivar-level identity follows the source catalog name.',
        threshold: 'The narrow-variety signal uses a product-defined threshold of 10 distinct plants/week — enough below the ~30/week research association to be a useful nudge; it is not a clinical cutoff.',
      },
      guide: 'Observational research associates ~30 different plant foods per week with greater gut-microbiome diversity — an association, not a clinical minimum.',
    },
    gutOccasions: {
      total: gutOccasions.length,
      entries: gutOccasions,
      facets: facetOccasions,
      suspectedFermented,
      dedup: 'Occasions deduplicate per local day and canonical food identity — repeated logs or portion edits of the same food are one occasion.',
      basis: 'Canonical gut taxonomy (ingredient attributes > catalog category > name heuristics). Suspected means preparation-name evidence only; verified live cultures and probiotic status require reviewed metadata — absence of a verified flag is not proof of absence.',
    },
    symptoms: {
      loggedCount: symptoms.length,
      top: topSymptoms,
      note: 'No logged symptoms does not prove absence of symptoms — only that none were recorded.',
    },
    tolerances: tolerances.map((t) => ({ foodName: t.foodName, kind: t.kind, note: t.note })),
    signals,
    completeness,
    coverage: {
      linkedIngredients: ingredients.length,
      unlinkedLogs: windowLogs.filter((l) => !l.ingredientId).length,
      notes: [
        'FoodLog rows link at the ingredient level; recipe component ingredients cannot be resolved into the plant count.',
        'Logs without a verified plant category are reported as unclassified, not assumed plant or animal.',
      ],
    },
    notes: [
      'Symptoms near a meal do not prove the meal caused them. Allergies are managed separately and always enforced.',
      'This summary describes logged data and reference targets — it is not a medical assessment or a microbiome measurement.',
    ],
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

module.exports = {
  getGutHealthSummary, logSymptom, setTolerance,
  classifyPlantCategory, plantKeyFor, normalizeFoodName,
  SYMPTOMS, TOLERANCE_KINDS, SUMMARY_VERSION, WINDOW_DAYS, PLANT_MIN_SERVING_G,
};
