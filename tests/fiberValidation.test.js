// Retained deterministic fiber validation — pc-HUM-3.
// Exercises the PRODUCTION calculation paths (ingredientNutrition.calculate,
// fiber/dailyEngine, fiber/targets, macroScoreService) against the disposable
// test database with explicit expected values. All fixtures are n3v3-scoped
// and removed in afterAll. No suite-order dependencies.
//
// Two categories, kept distinct:
//   • correctness checks — expected behavior, must pass.
//   • CHARACTERIZATION checks (describe 'known defects') — reproduce F-1/F-4
//     exactly as observed; they assert the defective current output so a fix
//     flips them red. A green characterization check is NOT a product pass.
const { getPrisma } = require('../src/lib/prisma');
const { calculate } = require('../src/services/ingredientNutrition');
const { scale } = require('../src/services/nutrition');
const { computeUnknowns } = require('../src/services/nutrientCompleteness');
const { resolveFiberTarget } = require('../src/services/fiber/targets');
const { dailyFiber } = require('../src/services/fiber/dailyEngine');
const { getGoals, calculateScore } = require('../src/services/macroScoreService');

const prisma = getPrisma();
const U = 'n3v3-fiber-u1';
const DAY = '2026-11-24';
const AT = new Date(`${DAY}T10:00:00Z`);
// Real catalog rows (USDA copies) in the disposable test DB.
const BREAD = '8f6a20bd-b110-4c2b-a3a2-f4cba823f235'; // fiberPer100g 4.3
const CRACK = '9238a58a-a96c-4a3d-9634-c80ffe53fac8'; // fiberPer100g 0 (measured zero)
const GLUC = 'd890cf34-4cf2-4db6-a708-53b4ef981599'; // fiberPer100g null (unknown)
// DOB exactly `years` old at run time — fixes the prior age-50/51 off-by-one.
const dob = (years) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - years); return d; };

let servingId;
beforeAll(async () => {
  await prisma.user.upsert({
    where: { id: U }, update: {},
    create: { id: U, email: `${U}@test.dev`, dateOfBirth: dob(36), gender: 'female', timeZone: 'UTC' },
  });
  await prisma.macroGoal.upsert({
    where: { userId: U }, update: { caloriesTarget: 2200, fiberTarget: 30, fiberTargetBasis: null },
    create: { userId: U, caloriesTarget: 2200, fiberTarget: 30 },
  });
  const sv = await prisma.ingredientServing.create({
    data: { id: `n3v3-sv`, ingredientId: BREAD, label: 'n3v3 slice', grams: 30, estimated: true, sourceRecord: { fixture: 'n3v3' } },
  });
  servingId = sv.id;
  const mk = (id, foodName, fiberG, extras = {}) => prisma.foodLog.create({
    data: {
      id, userId: U, foodName, mealType: 'meal', quantityG: 100,
      calories: 100, proteinG: 1, carbsG: 1, fatG: 1, fiberG, loggedAt: AT,
      nutritionSnapshot: {
        loggedSource: extras.source || 'catalog calculation',
        calculated: { fiberG },
        nutrientUnknowns: fiberG == null ? ['fiberG'] : [],
      },
    },
  });
  await mk('n3v3-bread', 'Bread, rice', 6.45);
  await mk('n3v3-crack', 'Rice crackers', 0);
  await mk('n3v3-gluc', 'GLUCOSE', null);
  await mk('n3v3-est', 'Estimate soup', 5, { source: 'AI estimate' });
});

afterAll(async () => {
  const step = fn => fn().catch(() => null);
  await step(() => prisma.foodLog.deleteMany({ where: { id: { startsWith: 'n3v3-' } } }));
  await step(() => prisma.ingredientServing.deleteMany({ where: { id: 'n3v3-sv' } }));
  await step(() => prisma.fiberDailyRecommendation.deleteMany({ where: { userId: U } }));
  await step(() => prisma.macroGoal.deleteMany({ where: { userId: U } }));
  await step(() => prisma.user.delete({ where: { id: U } }));
});

describe('pc-HUM-3 fiber validation — calculation path', () => {
  test('per-100g fiber at a non-100g portion: 4.3 × 150/100 = 6.45', async () => {
    const c = await calculate(BREAD, { grams: 150 });
    expect(c.nutrition.fiberG).toBe(6.45);
  });
  test('serving conversion: 2 × 30 g serving → 60 g → 2.58 g fiber', async () => {
    const c = await calculate(BREAD, { servingId, count: 2 });
    expect(c.grams).toBe(60);
    expect(c.nutrition.fiberG).toBe(2.58);
  });
  test('measured zero stays a confirmed 0', async () => {
    expect((await calculate(CRACK, { grams: 100 })).nutrition.fiberG).toBe(0);
  });
  test('missing fiber stays null and is marked unknown', async () => {
    const c = await calculate(GLUC, { grams: 50 });
    expect(c.nutrition.fiberG).toBeNull();
    expect(computeUnknowns(c.nutrition, {})).toEqual(['fiberG']);
  });
  test('rejects negative / non-finite nutrient and negative grams', () => {
    const base = { calories: 1, proteinG: 1, carbsG: 1, fatG: 1 };
    expect(() => scale({ ...base, fiberG: -1 }, 100)).toThrow(/Invalid nutrient/);
    expect(() => scale({ ...base, fiberG: NaN }, 100)).toThrow(/Invalid nutrient/);
    expect(() => scale(base, -5)).toThrow(/Invalid quantity/);
  });
});

describe('synthetic day — engine aggregation', () => {
  test('confirmed 6.5 + estimated 5 + 1 unknown → partial, remaining 24.6', async () => {
    const d = await dailyFiber(U, { date: DAY, tz: 'UTC', persist: false });
    expect(d.status.confirmedG).toBe(6.5);
    expect(d.status.estimatedG).toBe(5);
    expect(d.status.unknownMeals).toBe(1);
    expect(d.status.remainingG).toBe(24.6);
    expect(d.status.completeness).toBe('partial');
    expect(d.perLog.map(l => l.state)).toEqual(['confirmed', 'confirmed', 'unknown', 'estimated']);
    expect(d.target.targetG).toBe(31);
    expect(d.target.basis).toBe('formula_adult');
  });
  test.each([
    ['below', 10, false],    // gap 10 − 6.45 = 3.55 < 4 → none
    // Nominal gap = exactly 4.00, but 10.45−6.45 = 3.9999999999999996 in
    // floating point — the nominal-at case behaves as "below". Documented
    // boundary quirk, not a product defect (measure-zero edge).
    ['at-nominal', 10.45, false],
    ['above', 10.46, true],  // gap 4.01 > 4 → suggestions
    ['above', 11, true],     // gap 4.55 > 4 → suggestions
  ])('suggestion threshold %s 4 g (target %s)', async (_label, targetG, expectSuggestions) => {
    await prisma.macroGoal.update({ where: { userId: U }, data: { fiberTarget: targetG, fiberTargetBasis: 'custom' } });
    const d = await dailyFiber(U, { date: DAY, tz: 'UTC', persist: false });
    if (expectSuggestions) expect(d.suggestions.length).toBeGreaterThan(0);
    else expect(d.suggestions).toHaveLength(0);
  });
  afterAll(async () => {
    await prisma.macroGoal.update({ where: { userId: U }, data: { fiberTarget: 30, fiberTargetBasis: null } }).catch(() => null);
  });
});

describe('target resolution boundaries (heuristics — clinical decision #57 pending)', () => {
  const basis = (input) => { const r = resolveFiberTarget(input); return { g: r.targetG, b: r.basis }; };
  test('adult 2200 kcal → 31 g formula', () =>
    expect(basis({ dateOfBirth: dob(36), gender: 'female', macroGoal: { caloriesTarget: 2200, fiberTarget: 30 } })).toEqual({ g: 31, b: 'formula_adult' }));
  test('custom override honored', () =>
    expect(basis({ dateOfBirth: dob(36), gender: 'female', macroGoal: { fiberTarget: 28, fiberTargetBasis: 'custom' } })).toEqual({ g: 28, b: 'custom' }));
  test('clinician basis honored', () =>
    expect(basis({ dateOfBirth: dob(36), gender: 'female', macroGoal: { fiberTarget: 15, fiberTargetBasis: 'clinician' } })).toEqual({ g: 15, b: 'clinician' }));
  test('age 18 female → 26 g minor AI', () =>
    expect(basis({ dateOfBirth: dob(18), gender: 'female' })).toEqual({ g: 26, b: 'reference_minor' }));
  test('age 19 → adult formula (boundary)', () =>
    expect(basis({ dateOfBirth: dob(19), gender: 'female', macroGoal: { caloriesTarget: 2000 } })).toEqual({ g: 28, b: 'formula_adult' }));
  test('age 50 female no-kcal → 25 g; age 51 → 21 g (>50 cutoff both sides)', () => {
    expect(basis({ dateOfBirth: dob(50), gender: 'female', macroGoal: { fiberTarget: 30 } })).toEqual({ g: 25, b: 'reference_adult_ai' });
    expect(basis({ dateOfBirth: dob(51), gender: 'female', macroGoal: { fiberTarget: 30 } })).toEqual({ g: 21, b: 'reference_adult_ai' });
  });
  test('pregnancy condition → 28 g life-stage', () =>
    expect(basis({ dateOfBirth: dob(30), gender: 'female', conditionNames: ['Pregnancy'] })).toEqual({ g: 28, b: 'reference_life_stage' }));
  test('restricting condition name → 14 g restricted_reference + review', () => {
    const r = resolveFiberTarget({ dateOfBirth: dob(36), gender: 'female', macroGoal: { caloriesTarget: 2200 }, conditionNames: ['IBD'] });
    expect({ g: r.targetG, b: r.basis, review: r.reviewRequired }).toEqual({ g: 14, b: 'restricted_reference', review: true });
  });
  test('heuristic boundary: misspelled condition name is NOT caught', () => {
    const r = resolveFiberTarget({ dateOfBirth: dob(36), gender: 'female', macroGoal: { caloriesTarget: 2200 }, conditionNames: ['n3v3 gastroparisis misspelled'] });
    expect(r.basis).toBe('formula_adult'); // name-match heuristic — F-3, needs clinical review
  });
});

describe('fixed defects — regression guards', () => {
  test('F-1 FIXED: /macro-score/goals resolves the same target as the fiber engine', async () => {
    const goals = await getGoals(U); // production read path behind GET /macro-score/goals
    expect(goals.fiberTarget).toBe(31); // formula_adult on 2200 kcal — was raw stored 30
    expect(goals.fiberTargetBasis).toBe('formula_adult');
  });
  test('F-4 (still open): macro score conflates unknown (null→0) and estimated into intake, now scored vs resolved target', async () => {
    const score = await calculateScore(U, DAY);
    // Logs sum 6.45 + 0 + null→0 + 5(estimated) = 11.45 → displayed as complete intake.
    expect(score.breakdown.fiber.actual).toBe(11.5);
    expect(score.breakdown.fiber.target).toBe(31); // resolved target — the remaining defect is the conflation
    // Engine on the same day: confirmed 6.5, estimated 5 separately, unknown 1, partial coverage, target 31.
  });
});
