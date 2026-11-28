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

const SUMMARY_VERSION = 'gut-health-v2';
const WINDOW_DAYS = 7;
const SYMPTOMS = ['bloating', 'gas', 'constipation', 'diarrhea', 'reflux', 'abdominal', 'stool_frequency'];
const TOLERANCE_KINDS = ['suspected', 'intolerance', 'dislike', 'exclusion']; // 'allergy' lives in Allergy — never here

// --- Plant-diversity policy ---------------------------------------------------
// A log counts toward weekly plant diversity only when ALL of these hold:
//   1. The log is linked to a catalog ingredient whose category classifies
//      as plant (animal-derived categories never count, mixed or unknown
//      categories are reported as unclassified — never assumed plant).
//   2. The logged quantity is >= PLANT_MIN_SERVING_G — seasoning dustings
//      and sub-gram spice additions do not inflate the count.
//   3. The canonical plant key (preparation tokens stripped, spelling/
//      barcode variants resolved to the same catalog row) is new — raw vs
//      cooked spinach is ONE plant, not two.
// Recipe ingredients cannot be resolved: FoodLog links at the ingredient
// level only. That limitation is reported in coverage.notes.
const PLANT_MIN_SERVING_G = 5;

// Category vocabulary comes from the Humai ingredient catalog
// (IngredientCatalog.category). Deterministic matching only — a mixed
// category such as "Legumes proteins dairy seafood" resolves to 'unknown'
// rather than guessing plant or animal.
const ANIMAL_CATEGORY_RE = /\b(dairy|milk|cheese|eggs?|poultry|chicken|meat|seafood|fish|shellfish|prawn|whey|beef|pork|mutton)\b/i;
const PLANT_CATEGORY_RE = /fruit|vegetable|leafy|greens?|herbs?|pulses?|legumes?|lentils?|grains?|millets?|cereals?|flours?|atta|rice|oats?|nuts?|seeds?|tubers?|mushrooms?|spices?|aromatics?|produce/i;

function classifyPlantCategory(category) {
  const c = String(category || '');
  if (!c) return 'unknown';
  const plant = PLANT_CATEGORY_RE.test(c), animal = ANIMAL_CATEGORY_RE.test(c);
  if (plant && animal) return 'unknown'; // mixed bucket — honest, not guessed
  if (animal) return 'animal';
  return plant ? 'plant' : 'unknown';
}

// Preparation and processing tokens stripped so "spinach raw" and "spinach
// cooked" deduplicate to one plant identity.
const PREP_TOKEN_RE = /\b(raw|cooked|boiled|steamed|fried|roasted|dried|fresh|frozen|canned|baked|grilled|unsalted|salted|plain|instant|powdered?)\b/g;

function plantKeyFor(catalog, ingredient) {
  const base = String(catalog?.normalizedName || ingredient?.normalizedName || '')
    .replace(PREP_TOKEN_RE, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base || catalog?.identityKey || catalog?.id || ingredient?.id || null;
}

// Fermented-food *occasion* detection is a name match only — fermentation
// during preparation does not verify live cultures at consumption, and the
// count is never presented as probiotic intake.
const FERMENTED_NAME_RE = /\b(dahi|perugu|curd|yogh?urt|kefir|idli|dosa|dhokla|handvo|appam|kanji|kimchi|sauerkraut|natto|tempeh|miso|kombucha|chaas|chach|majjiga|buttermilk|lassi|sourdough|gundruk|kinema|axone|hawaijar|tungrymbai|bekang|sinki|pakhala|pazhaya\s+sadam|bore\s+baasi|poita\s+bhat)\b/i;

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/**
 * Weekly gut-health summary.
 * @param {string} userId
 * @param {object} [opts]
 * @param {string} [opts.tz] - IANA zone override (default: user.timeZone)
 */
async function getGutHealthSummary(userId, { tz } = {}) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, dateOfBirth: true, gender: true, timeZone: true },
  });
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

  // No silent catch on the data-bearing queries — a DB failure must surface
  // as an error (503) rather than a fabricated "you logged nothing" summary.
  const [macroGoal, conditions, logs, symptoms, tolerances] = await Promise.all([
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

  // --- Weekly plant diversity -------------------------------------------------
  const ingredientIds = [...new Set(windowLogs.map((l) => l.ingredientId).filter(Boolean))];
  const ingredients = ingredientIds.length
    ? await prisma.ingredient.findMany({
        where: { id: { in: ingredientIds } },
        select: { id: true, normalizedName: true, catalog: { select: { id: true, identityKey: true, normalizedName: true, category: true } } },
      })
    : [];
  const ingById = new Map(ingredients.map((i) => [i.id, i]));

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

  // --- Fermented-food occasions (name match — see note) -----------------------
  const fermentedFoods = new Set();
  let fermentedOccasions = 0;
  for (const log of windowLogs) {
    if (!FERMENTED_NAME_RE.test(log.foodName || '')) continue;
    fermentedOccasions += 1;
    fermentedFoods.add(String(log.foodName).toLowerCase().trim());
  }

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
  // low_fiber fires only on data worth trusting: enough logged days AND a
  // majority-known fiber record. Incomplete data is a data signal, not an
  // intake signal.
  const signals = [];
  if (daysLogged >= 3 && unknownShare <= 0.5 && target.targetG != null && avgConfirmed < target.targetG * 0.6) {
    signals.push({ key: 'low_fiber', detail: `Confirmed fiber averaged ~${round1(avgConfirmed)} g/day on logged days vs your ${target.targetG} g target.` });
  }
  if (plants.size > 0 && plants.size < 10 && daysLogged >= 3) {
    signals.push({ key: 'narrow_variety', detail: `${plants.size} distinct plant foods logged across the last 7 days.` });
  }
  if (windowLogs.length > 0 && unknownShare > 0.5) {
    signals.push({ key: 'thin_fiber_data', detail: `${unknownMeals} of ${windowLogs.length} logged items have no fiber data — actual intake may be higher than confirmed.` });
  }

  return {
    version: SUMMARY_VERSION,
    window: { start: days[0], end: today, days: WINDOW_DAYS, timezone: zone },
    fiber: {
      target: { targetG: target.targetG, basis: target.basis, reference: target.reference, reviewRequired: target.reviewRequired, restrictions: target.restrictions },
      confirmedG: round1(confirmedG),
      estimatedG: round1(estimatedG),
      unknownMeals,
      avgConfirmedPerLoggedDayG: round1(avgConfirmed),
      daysLogged,
    },
    plantVariety: {
      windowDays: WINDOW_DAYS,
      distinctPlants: plants.size,
      plants: [...plants.values()].sort(),
      countedLogs: countedPlantLogs,
      excludedAnimalLogs: animalLogs,
      unclassifiedLogs,
      belowServingLogs,
      policy: `Plant foods count at logged servings of ${PLANT_MIN_SERVING_G} g or more, deduplicated across preparation and alias variants. Animal-derived and unclassified items never inflate the count.`,
      guide: 'Observational research associates ~30 different plant foods per week with greater gut-microbiome diversity — an association, not a clinical minimum.',
    },
    fermented: {
      occasions: fermentedOccasions,
      foods: [...fermentedFoods].sort(),
      basis: 'food-name match — fermentation during preparation does not verify live cultures or probiotic benefit at consumption',
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
  classifyPlantCategory, plantKeyFor,
  SYMPTOMS, TOLERANCE_KINDS, SUMMARY_VERSION, WINDOW_DAYS, PLANT_MIN_SERVING_G,
};
