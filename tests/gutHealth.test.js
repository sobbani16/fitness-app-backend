jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const { getGutHealthSummary, logSymptom, setTolerance, classifyPlantCategory, plantKeyFor } = require('../src/services/gutHealth');

const day = (n, h = 12) => new Date(Date.now() - n * 86400000 + (h - 12) * 3600000);

function fakeDb({ user = {}, macroGoal = null, conditions = [], logs = [], ingredients = [], attributes = [], symptoms = [], tolerances = [], logError = null } = {}) {
  getPrisma.mockReturnValue({
    user: { findUnique: jest.fn(async () => ({ id: 'u1', dateOfBirth: new Date('1990-01-01'), gender: 'female', timeZone: 'UTC', ...user })) },
    macroGoal: { findUnique: jest.fn(async () => macroGoal) },
    userHealthCondition: { findMany: jest.fn(async () => conditions) },
    foodLog: { findMany: jest.fn(async () => { if (logError) throw logError; return logs; }) },
    ingredient: { findMany: jest.fn(async () => ingredients) },
    ingredientAttribute: { findMany: jest.fn(async () => attributes) },
    gutSymptom: { findMany: jest.fn(async () => symptoms), create: jest.fn(async d => ({ id: 's1', ...d.data })) },
    foodTolerance: { findMany: jest.fn(async () => tolerances), create: jest.fn(async d => ({ id: 't1', ...d.data })) },
  });
}

const log = (over = {}) => ({ id: Math.random().toString(36), foodName: 'food', mealType: 'lunch', quantityG: 100, fiberG: 5, ingredientId: null, nutritionSnapshot: null, loggedAt: day(1), ...over });
const ing = (id, category, name) => ({ id, normalizedName: name || id, catalog: { id: `cat-${id}`, identityKey: `key-${id}`, normalizedName: name || id, category } });

describe('gut health v2 — fiber', () => {
  test('no logs → completeness none, honest fiber nulls, personalized target still resolved', async () => {
    fakeDb({});
    const r = await getGutHealthSummary('u1');
    expect(r.completeness).toBe('none');
    expect(r.fiber.avgConfirmedPerLoggedDayG).toBeNull();
    expect(r.fiber.unknownMeals).toBe(0);
    expect(r.signals).toEqual([]);
  });

  test('personalized target: custom MacroGoal target replaces the old hardcoded 30 g', async () => {
    fakeDb({ macroGoal: { fiberTarget: 22, fiberTargetBasis: 'custom' } });
    const r = await getGutHealthSummary('u1');
    expect(r.fiber.target.targetG).toBe(22);
    expect(r.fiber.target.basis).toBe('custom');
  });

  test('personalized target: 14 g/1,000 kcal on calorie target (2000 kcal → 28 g, not 30 g)', async () => {
    fakeDb({ macroGoal: { caloriesTarget: 2000 } });
    const r = await getGutHealthSummary('u1');
    expect(r.fiber.target.targetG).toBe(28);
    expect(r.fiber.target.basis).toBe('formula_adult');
  });

  test('unknown fiber is not zero: null fiberG counts as unknownMeals, not confirmed 0', async () => {
    fakeDb({ logs: [log({ fiberG: null }), log({ fiberG: 10 }), log({ fiberG: null })] });
    const r = await getGutHealthSummary('u1');
    expect(r.fiber.confirmedG).toBe(10);
    expect(r.fiber.unknownMeals).toBe(2);
    expect(r.completeness).toBe('low');
  });

  test('snapshot-declared unknowns keep stored 0 out of the confirmed total', async () => {
    fakeDb({ logs: [log({ fiberG: 0, nutritionSnapshot: { nutrientUnknowns: ['fiberG'] } })] });
    const r = await getGutHealthSummary('u1');
    expect(r.fiber.confirmedG).toBe(0);
    expect(r.fiber.unknownMeals).toBe(1);
  });

  test('low fiber on trustworthy data → low_fiber signal cites the personalized target', async () => {
    fakeDb({
      macroGoal: { caloriesTarget: 2000 }, // target 28 g
      logs: Array.from({ length: 6 }, (_, i) => log({ fiberG: 5, loggedAt: day(i % 5) })),
    });
    const r = await getGutHealthSummary('u1');
    const s = r.signals.find((x) => x.key === 'low_fiber');
    expect(s).toBeTruthy();
    expect(s.kind).toBe('intake_opportunity');
    expect(s.detail).toContain('28 g');
  });

  // §2.1 mandatory: confirmed 8 g + estimated 24 g vs 30 g target — never a
  // definitive low-fiber conclusion from the confirmed subtotal alone.
  test('confirmed 8 g + estimated 24 g vs 30 g target → NO low_fiber signal', async () => {
    fakeDb({
      macroGoal: { fiberTarget: 30, fiberTargetBasis: 'custom' },
      logs: Array.from({ length: 4 }, (_, i) => [
        log({ fiberG: 8, loggedAt: day(i) }),
        log({ fiberG: 24, loggedAt: day(i), nutritionSnapshot: { loggedSource: 'external estimate' } }),
      ]).flat(),
    });
    const r = await getGutHealthSummary('u1');
    expect(r.fiber.confirmedG).toBe(32);
    expect(r.fiber.estimatedG).toBe(96);
    expect(r.fiber.knownAndEstimatedG).toBe(128);
    expect(r.signals.find((s) => s.key === 'low_fiber')).toBeFalsy();
  });

  test('low confirmed AND low combined → low_fiber cites combined basis', async () => {
    fakeDb({
      macroGoal: { fiberTarget: 30, fiberTargetBasis: 'custom' },
      logs: Array.from({ length: 4 }, (_, i) => [
        log({ fiberG: 5, loggedAt: day(i) }),
        log({ fiberG: 4, loggedAt: day(i), nutritionSnapshot: { loggedSource: 'ai-estimate' } }),
      ]).flat(),
    });
    const r = await getGutHealthSummary('u1');
    const s = r.signals.find((x) => x.key === 'low_fiber');
    expect(s).toBeTruthy();
    expect(s.basis).toBe('confirmed_plus_estimated');
  });

  test('all-estimated values still prevent a low-intake conclusion', async () => {
    fakeDb({
      macroGoal: { fiberTarget: 30, fiberTargetBasis: 'custom' },
      logs: Array.from({ length: 4 }, (_, i) => log({ fiberG: 25, loggedAt: day(i), nutritionSnapshot: { loggedSource: 'external estimate' } })),
    });
    const r = await getGutHealthSummary('u1');
    expect(r.fiber.confirmedG).toBe(0);
    expect(r.fiber.knownAndEstimatedG).toBe(100);
    expect(r.signals.find((s) => s.key === 'low_fiber')).toBeFalsy();
  });

  test('measured zero counts as confirmed, never unknown', async () => {
    fakeDb({ logs: [log({ fiberG: 0, nutritionSnapshot: { calculated: { fiberG: 0 } } })] });
    const r = await getGutHealthSummary('u1');
    expect(r.fiber.unknownMeals).toBe(0);
  });

  test('thin logging coverage is a data-quality signal, not an intake verdict', async () => {
    fakeDb({ logs: [log({ fiberG: 2, loggedAt: day(1) })] });
    const r = await getGutHealthSummary('u1');
    expect(r.signals.find((s) => s.key === 'low_fiber')).toBeFalsy();
    expect(r.signals.find((s) => s.key === 'thin_log_coverage')).toBeTruthy();
  });

  test('mostly-unknown fiber produces thin_fiber_data, not low_fiber', async () => {
    fakeDb({ logs: Array.from({ length: 5 }, (_, i) => log({ fiberG: null, loggedAt: day(i) })) });
    const r = await getGutHealthSummary('u1');
    expect(r.signals.find((s) => s.key === 'low_fiber')).toBeFalsy();
    expect(r.signals.find((s) => s.key === 'thin_fiber_data')).toBeTruthy();
  });

  test('restricted-condition target reaches the summary via resolveFiberTarget', async () => {
    fakeDb({ conditions: [{ condition: { name: 'Crohn disease' } }] });
    const r = await getGutHealthSummary('u1');
    expect(r.fiber.target.basis).toBe('restricted_reference');
    expect(r.fiber.target.reviewRequired).toBe(true);
  });

  test('database failure propagates as documented 503, never a fabricated empty summary', async () => {
    fakeDb({ logError: new Error('connection refused') });
    await expect(getGutHealthSummary('u1')).rejects.toMatchObject({ status: 503, publicCode: 'SERVICE_UNAVAILABLE' });
  });
});

describe('gut health v2 — plant diversity', () => {
  const mk = () => fakeDb({
    logs: [
      log({ ingredientId: 'i-spin', quantityG: 80, foodName: 'spinach curry' }),
      log({ ingredientId: 'i-chkn', quantityG: 120, foodName: 'chicken curry' }),
      log({ ingredientId: 'i-egg', quantityG: 60, foodName: 'boiled eggs' }),
      log({ ingredientId: 'i-milk', quantityG: 200, foodName: 'milk' }),
      log({ ingredientId: 'i-mystery', quantityG: 50, foodName: 'unknown item' }),
      log({ ingredientId: null, quantityG: 50, foodName: 'free-text meal' }),
    ],
    ingredients: [
      ing('i-spin', 'Leafy greens', 'spinach'),
      ing('i-chkn', 'Poultry', 'chicken'),
      ing('i-egg', 'Eggs', 'egg'),
      ing('i-milk', 'Dairy', 'milk'),
      ing('i-mystery', 'Sauces condiments cooking liquids', 'mystery sauce'),
    ],
  });

  test('meat, eggs and dairy never count as plant foods', async () => {
    mk();
    const r = await getGutHealthSummary('u1');
    expect(r.plantVariety.distinctPlants).toBe(1);
    expect(r.plantVariety.plants).toEqual(['spinach']);
    expect(r.plantVariety.excludedAnimalLogs).toBe(3);
  });

  test('unclassified ingredients are reported, not assumed plant or animal', async () => {
    mk();
    const r = await getGutHealthSummary('u1');
    expect(r.plantVariety.unclassifiedLogs).toBe(2); // mystery sauce + free-text log
    expect(r.coverage.unlinkedLogs).toBe(1);
  });

  test('raw vs cooked variants of the same plant deduplicate to one', async () => {
    fakeDb({
      logs: [
        log({ ingredientId: 'i-spin-raw', quantityG: 50, foodName: 'spinach salad' }),
        log({ ingredientId: 'i-spin-cooked', quantityG: 80, foodName: 'palak curry' }),
        log({ ingredientId: 'i-spin-raw', quantityG: 50, foodName: 'spinach salad again' }),
      ],
      ingredients: [
        ing('i-spin-raw', 'Leafy greens', 'spinach raw'),
        ing('i-spin-cooked', 'Leafy greens', 'spinach cooked'),
      ],
    });
    const r = await getGutHealthSummary('u1');
    expect(r.plantVariety.distinctPlants).toBe(1);
    expect(r.plantVariety.countedLogs).toBe(3);
  });

  test('seasoning amounts below the serving threshold do not inflate diversity', async () => {
    fakeDb({
      logs: [log({ ingredientId: 'i-turmeric', quantityG: 1, foodName: 'dal tadka' })],
      ingredients: [ing('i-turmeric', 'Spices, herbs & aromatics', 'turmeric')],
    });
    const r = await getGutHealthSummary('u1');
    expect(r.plantVariety.distinctPlants).toBe(0);
    expect(r.plantVariety.belowServingLogs).toBe(1);
  });

  test('window is 7 local days — logs older than the week do not count', async () => {
    fakeDb({
      logs: [
        log({ ingredientId: 'i-apple', quantityG: 100, foodName: 'apple', loggedAt: day(2) }),
        log({ ingredientId: 'i-banana', quantityG: 100, foodName: 'banana', loggedAt: day(9) }), // outside window
      ],
      ingredients: [ing('i-apple', 'Fruits', 'apple'), ing('i-banana', 'Fruits', 'banana')],
    });
    const r = await getGutHealthSummary('u1');
    expect(r.window.days).toBe(7);
    expect(r.plantVariety.distinctPlants).toBe(1);
    expect(r.plantVariety.plants).toEqual(['apple']);
  });

  test('user timezone drives the local window', async () => {
    fakeDb({ user: { timeZone: 'Asia/Kolkata' }, logs: [] });
    const r = await getGutHealthSummary('u1');
    expect(r.window.timezone).toBe('Asia/Kolkata');
  });
});

describe('gut health v2 — gut-taxonomy occasions + symptoms', () => {
  test('fermented catalog identity → verified; name-only match → suspected (never verified live cultures)', async () => {
    fakeDb({
      ingredients: [ing(31, 'fermented', 'kimchi'), ing(32, 'Dairy', 'yogurt')],
      logs: [
        log({ foodName: 'Kimchi side', ingredientId: 31 }),
        log({ foodName: 'idli with sambar', ingredientId: 32 }),
        log({ foodName: 'rice' }),
      ],
    });
    const r = await getGutHealthSummary('u1');
    expect(r.gutOccasions.facets.fermented).toBe(2);
    expect(r.gutOccasions.entries.find((e) => /kimchi/i.test(e.food)).fermentation).toBe('verified');
    expect(r.gutOccasions.entries.find((e) => /idli/i.test(e.food)).fermentation).toBe('suspected');
    expect(r.gutOccasions.suspectedFermented).toBe(1);
    expect(r.gutOccasions.facets.live_culture).toBe(0); // never verified by name alone
  });

  test('non-fermented dosa variant is not classified fermented', async () => {
    fakeDb({ logs: [log({ foodName: 'Instant dosa mix' })] });
    const r = await getGutHealthSummary('u1');
    expect(r.gutOccasions.facets.fermented).toBe(0);
  });

  test('duplicate logs of the same food on one day count as a single occasion', async () => {
    fakeDb({
      ingredients: [ing(31, 'fermented', 'kimchi')],
      logs: [log({ foodName: 'Kimchi', ingredientId: 31 }), log({ foodName: 'Kimchi', ingredientId: 31, quantityG: 50 })],
    });
    const r = await getGutHealthSummary('u1');
    expect(r.gutOccasions.facets.fermented).toBe(1);
    expect(r.gutOccasions.total).toBe(1);
  });

  test('live_culture attribute surfaces verified live cultures; Unicode names preserved', async () => {
    fakeDb({
      ingredients: [ing(33, 'Dairy', 'పెరుగు')],
      attributes: [{ ingredientId: 33, attribute: 'FERMENTED_LIVE_CULTURES' }],
      logs: [log({ foodName: 'పెరుగు', ingredientId: 33 })],
    });
    const r = await getGutHealthSummary('u1');
    const e = r.gutOccasions.entries[0];
    expect(e.liveCultures).toBe('verified');
    expect(e.food).toBe('పెరుగు');
    expect(r.gutOccasions.facets.live_culture).toBe(1);
  });

  test('unresolved identity coverage is a data-quality signal, not a variety verdict', async () => {
    fakeDb({ logs: Array.from({ length: 6 }, (_, i) => log({ foodName: `mystery ${i}`, loggedAt: day(i % 4), fiberG: null })) });
    const r = await getGutHealthSummary('u1');
    expect(r.signals.find((s) => s.key === 'narrow_variety')).toBeFalsy();
    expect(r.signals.find((s) => s.key === 'thin_identity_coverage')).toBeTruthy();
  });

  test('no logged symptoms is reported as unrecorded, not as asymptomatic', async () => {
    fakeDb({});
    const r = await getGutHealthSummary('u1');
    expect(r.symptoms.loggedCount).toBe(0);
    expect(r.symptoms.note).toMatch(/does not prove absence/);
  });

  test('category classifier: mixed buckets are unknown, animal wins over plant', () => {
    expect(classifyPlantCategory('Legumes proteins dairy seafood')).toBe('unknown');
    expect(classifyPlantCategory('Fish')).toBe('animal');
    expect(classifyPlantCategory('Leafy greens')).toBe('plant');
    expect(classifyPlantCategory('')).toBe('unknown');
    expect(plantKeyFor({ normalizedName: 'spinach cooked' }, null)).toBe('spinach');
  });

  test('symptom journal validates + stores; rejects unknown symptom', async () => {
    fakeDb({});
    await expect(logSymptom('u1', { symptom: 'nonsense' })).rejects.toMatchObject({ status: 400 });
    const s = await logSymptom('u1', { symptom: 'bloating', severity: 9 });
    expect(s.severity).toBe(5); // clamped
    await expect(logSymptom('u1', { symptom: 'gas', bristol: 9 })).rejects.toMatchObject({ status: 400 });
  });

  test('tolerance kinds exclude allergy (managed separately)', async () => {
    fakeDb({});
    await expect(setTolerance('u1', { foodName: 'milk', kind: 'allergy' })).rejects.toMatchObject({ status: 400 });
    const t = await setTolerance('u1', { foodName: 'onion', kind: 'suspected' });
    expect(t.kind).toBe('suspected');
  });
});
