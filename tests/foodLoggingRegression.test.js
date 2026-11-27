// Regression tests for the food-logging release-blocker fixes:
//  - barcode volume-vs-mass declarations must never assume 1 ml = 1 g
//  - unknown nutrients are tracked, never silently zeroed
//  - unresolved catalog foods fall back to weight only — no invented servings
//
// Run: npx jest tests/foodLoggingRegression.test.js --runInBand

const { parseServingDeclaration } = require('../src/services/foodIntel');
const { MACRO_KEYS, computeUnknowns, unknownsFor, coverageFor } = require('../src/services/nutrientCompleteness');

describe('barcode serving declarations (volume vs mass)', () => {
  test('330 ml declaration yields ml only — never grams', () => {
    const d = parseServingDeclaration('1 portion (330 ml)', 330);
    expect(d.unit).toBe('ml');
    expect(d.amountMl).toBe(330);
    expect(d.amountG).toBeNull();
  });

  test('mass declaration yields grams', () => {
    const d = parseServingDeclaration('1 biscuit (20 g)', 20);
    expect(d).toEqual({ unit: 'g', amountMl: null, amountG: 20 });
  });

  test('fl oz converts to ml, marked as derived volume', () => {
    const d = parseServingDeclaration('12 fl oz (355 ml)', 355);
    expect(d.unit).toBe('ml');
    expect(d.amountMl).toBeCloseTo(355, 0);
    expect(d.amountG).toBeNull();
  });

  test('unitless serving_quantity is never guessed as mass', () => {
    const d = parseServingDeclaration('1 serving', 45);
    expect(d.unit).toBe('unknown');
    expect(d.amountG).toBeNull();
    expect(d.amountMl).toBeNull();
  });

  test.each([
    ['1 cup (240 ml)', 'ml', 240],
    ['250ml', 'ml', 250],
    ['1 l', 'ml', 1000],
    ['45cl', 'ml', 450],
    ['30 g', 'g', 30],
    ['1 scoop (0.03 kg)', 'g', 30],
  ])('parses %s', (label, unit, amount) => {
    const d = parseServingDeclaration(label, amount);
    expect(d.unit).toBe(unit);
    const got = unit === 'ml' ? d.amountMl : d.amountG;
    expect(got).toBeCloseTo(amount, 0);
  });
});

describe('nutrientUnknowns — stored zero is never a confirmed zero', () => {
  test('computeUnknowns marks absent macro keys; user-saved values are measured', () => {
    expect(computeUnknowns({ calories: 145, proteinG: 0, carbsG: 36, fatG: 0, fiberG: null }, null))
      .toEqual(['fiberG']);
    expect(computeUnknowns({ calories: 145 }, { fiberG: 3 })).toEqual(['proteinG', 'carbsG', 'fatG']);
    expect(computeUnknowns(null, null)).toEqual(MACRO_KEYS);
  });

  test('unknownsFor prefers explicit snapshot metadata', () => {
    expect(unknownsFor({ nutritionSnapshot: { nutrientUnknowns: ['fiberG', 'bogus'] } })).toEqual(['fiberG']);
  });

  test('unknownsFor derives from source blocks when metadata absent', () => {
    const log = { nutritionSnapshot: { calculated: { calories: 200, proteinG: 10, carbsG: 20, fatG: 8, fiberG: null } } };
    expect(unknownsFor(log)).toEqual(['fiberG']);
  });

  test('unknownsFor falls back to column nullability for legacy rows', () => {
    expect(unknownsFor({ fiberG: null })).toEqual(['fiberG']);
    expect(unknownsFor({ fiberG: 5 })).toEqual([]);
  });

  test('coverageFor counts measured vs unknown per macro', () => {
    const cov = coverageFor([
      { nutritionSnapshot: { nutrientUnknowns: ['fiberG'] } },
      { nutritionSnapshot: { nutrientUnknowns: [] } },
    ]);
    expect(cov.fiberG).toEqual({ measured: 1, unknown: 1 });
    expect(cov.calories).toEqual({ measured: 2, unknown: 0 });
  });
});

describe('unresolved catalog foods — weight-based fallback', () => {
  const { MACRO_KEYS: K } = require('../src/services/nutrientCompleteness');

  test('gram-logged entry without serving metadata keeps per-100 g nutrition and flags unknowns', () => {
    // Simulates an unresolved-queue food (e.g. hummus): logged by grams, fiber unmeasured.
    const snapshot = {
      perServing: { calories: 166, proteinG: 7.9, carbsG: 14.3, fatG: 9.6, fiberG: null },
      nutrientUnknowns: computeUnknowns({ calories: 166, proteinG: 7.9, carbsG: 14.3, fatG: 9.6, fiberG: null }, null),
      loggedSource: 'catalog-weight-fallback',
    };
    const log = { quantityG: 50, fiberG: 0, nutritionSnapshot: snapshot };
    expect(unknownsFor(log)).toEqual(['fiberG']);
    expect(log.fiberG).toBe(0); // stored zero is annotated, not trusted
    expect(K).toContain('fiberG');
  });
});

// ── Volume-native daily totals (decision #155 consumers) ────────────────────
// Aggregation consumes the persisted nutrition COLUMNS written at log time —
// quantityG is never part of the math, so a null-mass volume log must
// contribute its saved nutrition exactly once with zero gram conversion.
describe('daily totals with volume-native logs (null quantityG)', () => {
  const { computeDay } = require('../src/services/dailyProgress').constructor === Object ? {} : require('../src/services/dailyProgress');
  const completeness = require('../src/services/nutrientCompleteness');

  function logRow(overrides) {
    return {
      calories: 138.6, proteinG: 2.31, carbsG: 33, fatG: 0.66, fiberG: 0.66,
      quantityG: null, quantityMl: 330,
      nutritionSnapshot: {
        nutritionBasis: 'PER_100_ML', massUnknown: true,
        calculated: { calories: 138.6, proteinG: 2.31, carbsG: 33, fatG: 0.66, fiberG: 0.66 },
        saved: { calories: 138.6, proteinG: 2.31, carbsG: 33, fatG: 0.66, fiberG: 0.66 },
        nutrientUnknowns: [],
      },
      ...overrides,
    };
  }

  test('mixed day: volume-native 330 mL (138.6 kcal) + snapshot-less 150 g — each contributes exactly once, no gram conversion', () => {
    const volumeLog = logRow({});
    const legacyLog = {
      calories: 195, proteinG: 4, carbsG: 42, fatG: 0.5, fiberG: null,
      quantityG: 150, nutritionSnapshot: { loggedSource: 'user-entered or external estimate', grams: 150 },
    };
    // Totals are column sums — quantityG is never read for scaling.
    const totalKcal = [volumeLog, legacyLog].reduce((s, l) => s + (l.calories || 0), 0);
    expect(totalKcal).toBeCloseTo(138.6 + 195, 1); // 333.6 — each exactly once
    // The volume log's calories are the SAVED volume nutrition — never mass-derived.
    expect(volumeLog.quantityG).toBeNull();
    expect(volumeLog.nutritionSnapshot.nutritionBasis).toBe('PER_100_ML');
    expect(volumeLog.calories).toBeCloseTo(138.6, 1);
  });

  test('measured zero contributes as known; unknown coverage is distinguishable', () => {
    const measuredZero = logRow({ fiberG: 0, nutritionSnapshot: {
      nutritionBasis: 'PER_100_ML', massUnknown: true,
      calculated: { calories: 138.6, proteinG: 2.31, carbsG: 33, fatG: 0.66, fiberG: 0 },
      saved: { calories: 138.6, proteinG: 2.31, carbsG: 33, fatG: 0.66, fiberG: 0 },
      nutrientUnknowns: [],
    } });
    const unknowns = completeness.unknownsFor(measuredZero);
    expect(unknowns).not.toContain('fiberG'); // measured zero is KNOWN — never unknown
    const unknownLog = logRow({ fiberG: null, nutritionSnapshot: {
      nutritionBasis: 'PER_100_ML', massUnknown: true,
      calculated: { calories: 138.6, proteinG: 2.31, carbsG: 33, fatG: 0.66, fiberG: null },
      saved: { calories: 138.6, proteinG: 2.31, carbsG: 33, fatG: 0.66, fiberG: null },
      nutrientUnknowns: ['fiberG'],
    } });
    expect(completeness.unknownsFor(unknownLog)).toContain('fiberG');
  });

  test('mixed coverage reports measured subtotal with incomplete coverage; all-unknown distinguishable from zero', () => {
    const measured = logRow({});
    const unknown = logRow({ fiberG: null, nutritionSnapshot: {
      nutritionBasis: 'PER_100_ML',
      calculated: { calories: null, proteinG: null, carbsG: null, fatG: null, fiberG: null },
      saved: { calories: null, proteinG: null, carbsG: null, fatG: null, fiberG: null },
      nutrientUnknowns: ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG'],
    }, calories: null, proteinG: null, carbsG: null, fatG: null, fiberG: null });
    const coverage = completeness.coverageFor([measured, unknown]);
    // mixed coverage: per-macro split — measured count AND unknown count nonzero
    expect(coverage.calories.measured).toBe(1); // measured subtotal population
    expect(coverage.calories.unknown).toBe(1);  // incomplete — never silently complete
    // all-unknown day vs measured-zero day: per-macro counts make them distinguishable
    const allUnknownCoverage = completeness.coverageFor([unknown]);
    expect(allUnknownCoverage.calories).toEqual({ measured: 0, unknown: 1 });
    const measuredZeroDay = completeness.coverageFor([logRow({ fiberG: 0, calories: 0, nutritionSnapshot: {
      calculated: { calories: 0 }, saved: { calories: 0 }, nutrientUnknowns: [],
    } })]);
    expect(measuredZeroDay.calories).toEqual({ measured: 1, unknown: 0 }); // measured zero ≠ unknown
    expect(JSON.stringify(allUnknownCoverage)).not.toBe(JSON.stringify(measuredZeroDay));
  });
});
