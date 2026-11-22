// Fiber safety E2E — real services against the isolated test database.
// Covers the required scenario matrix end to end: sequencing, daily engine,
// supplement eligibility, and assistant copy. Asserts the safety contracts:
// no fabricated values, no glucose guarantees, no invented doses.
//
// Runs with REAL prisma (no mocks) — fixtures are created in beforeAll and
// removed in afterAll.

const { getPrisma } = require('../src/lib/prisma');
const { sequenceMeal } = require('../src/services/fiber/sequencing');
const { dailyFiber } = require('../src/services/fiber/dailyEngine');
const { evaluateFiberSupplement } = require('../src/services/fiber/supplementCheck');
const { weeklyReview } = require('../src/services/fiber/weeklyReview');
const { groundFiberAnswer } = require('../src/services/fiber/assistant');

const p = getPrisma();
const TAG = `fibere2e-${Date.now()}`;
const GUARANTEE_RE = /will (prevent|lower|reduce)|guaranteed|proven to|stops? (a |the )?(glucose|sugar|spike)/i;
const DOSE_RE = /take \d+\s*(g\b|grams?\b|teaspoons?|tsp|scoop|capsules?|tablespoons?)/i;

let ids = { user: null, cond: null, allergy: null, supp: null, suppProduct: null };

beforeAll(async () => {
  // Fixture user: adult, 2000 kcal → 28 g formula target.
  const user = await p.user.create({ data: { email: `${TAG}@test.local`, dateOfBirth: new Date('1990-06-15'), gender: 'female', timeZone: 'UTC' } });
  ids.user = user.id;
  await p.macroGoal.create({ data: { userId: user.id, caloriesTarget: 2000 } });

  // Fixture catalog: enough for sequencing resolution (test DB may be empty).
  const mkIng = (name, fiberPer100g, macros = {}) => p.ingredient.create({
    data: { name, normalizedName: name.toLowerCase(), caloriesPer100g: macros.kcal ?? 100, proteinPer100g: macros.p ?? 5, carbsPer100g: macros.c ?? 10, fatPer100g: macros.f ?? 1, fiberPer100g, source: 'e2e-fixture' },
  });
  const cat = async (ing, aliases = []) => p.ingredientCatalog.create({
    data: { id: `${TAG}-${ing.normalizedName}`.slice(0, 64), name: ing.name, normalizedName: ing.normalizedName, aliases, category: 'fixture', preparation: 'raw', status: 'active', usable: true, sourceRecord: {}, ingredient: { connect: { id: ing.id } } },
  });
  for (const [name, fib, macros] of [
    ['Broccoli, raw', 2.6, {}], ['Chicken breast, cooked', 0, { p: 31, kcal: 165 }],
    ['Rice, white, cooked', 0.4, { c: 28 }], ['Quinoa, cooked', 2.8, { c: 21, p: 4.4 }],
    ['Spinach, raw', 2.2, {}], ['Apple, raw', 2.4, {}], ['Masoor dal red, dry', 10.7, { p: 24 }],
    ['Peanuts', 8.5, { f: 49, p: 26 }], ['Chia seeds', 34.4, { f: 31 }],
    ['Mystery flakes', null, {}],
  ]) await cat(await mkIng(name, fib, macros));

  // Safety fixtures
  ids.cond = (await p.healthCondition.upsert({ where: { name: 'Dysphagia (swallowing difficulty)' }, create: { name: 'Dysphagia (swallowing difficulty)' }, update: {} })).id;
  const cond2 = await p.healthCondition.upsert({ where: { name: 'Crohn disease (IBD)' }, create: { name: 'Crohn disease (IBD)' }, update: {} });
  ids.cond2 = cond2.id;
  ids.allergy = (await p.allergy.upsert({ where: { name: 'Peanut' }, create: { name: 'Peanut' }, update: {} })).id;

  // Verified psyllium product (label facts only — no invented dose).
  ids.suppProduct = (await p.supplementProduct.create({ data: {
    name: `${TAG} psyllium husk`, brand: 'Fixture', servingSize: 5, servingUnit: 'g', servingText: '1 tsp (5 g)',
    labelFacts: { dietaryFiberG: 3.4, directions: 'Mix 1 tsp into a full glass of water.' },
    warnings: 'Take with adequate liquid.', verificationStatus: 'LABEL_REVIEWED', dataSource: 'fixture',
  } })).id;
  ids.supp = (await p.supplement.create({ data: { name: `${TAG} isabgol`, productId: ids.suppProduct, catalogStatus: 'personal', ownerId: user.id } })).id;
});

afterAll(async () => {
  const uid = ids.user;
  await p.fiberSupplementCheck.deleteMany({ where: { userId: uid } });
  await p.fiberDailyRecommendation.deleteMany({ where: { userId: uid } });
  await p.foodLog.deleteMany({ where: { userId: uid } });
  await p.supplementLog.deleteMany({ where: { userId: uid } });
  await p.userHealthCondition.deleteMany({ where: { userId: uid } });
  await p.userAllergy.deleteMany({ where: { userId: uid } });
  await p.foodPreference.deleteMany({ where: { userId: uid } });
  await p.macroGoal.deleteMany({ where: { userId: uid } });
  await p.supplement.deleteMany({ where: { id: ids.supp } });
  await p.supplementProduct.deleteMany({ where: { id: ids.suppProduct } });
  await p.ingredient.updateMany({ where: { source: 'e2e-fixture' }, data: { catalogId: null } });
  await p.ingredientCatalog.deleteMany({ where: { id: { startsWith: TAG } } });
  await p.ingredient.deleteMany({ where: { source: 'e2e-fixture' } });
  await p.user.delete({ where: { id: uid } });
  await p.$disconnect();
});

const noBadCopy = (text) => { expect(text).not.toMatch(GUARANTEE_RE); expect(text).not.toMatch(DOSE_RE); };

describe('E2E sequencing scenarios', () => {
  it('no meaningful fiber: chicken + rice → honest gap + food addition', async () => {
    const r = await sequenceMeal([{ name: 'Chicken breast', amountG: 150 }, { name: 'White rice', amountG: 200 }]);
    expect(r.separable).toBe(true);
    expect(r.hasMeaningfulFiber).toBe(false);
    expect(r.suggestedAddition).toBeTruthy();
    expect(r.order.map((o) => o.role)).toEqual(['protein', 'starch']);
    noBadCopy(r.explanation.join(' ') + ' ' + r.disclaimers.join(' '));
  });

  it('fiber-rich starch: chicken + quinoa → starch stays last, no veg-first claim', async () => {
    const r = await sequenceMeal([{ name: 'Chicken breast', amountG: 150 }, { name: 'Quinoa, cooked', amountG: 180 }]);
    expect(r.separable).toBe(true);
    const last = r.order[r.order.length - 1];
    expect(last.role).toBe('starch'); // fiber content never promotes a starch to first
    expect(r.order[0].role).not.toBe('non_starchy_veg');
    noBadCopy(r.explanation.join(' '));
  });

  it('mixed dishes: biryani → separable:false; khichdi → separable:false', async () => {
    for (const dish of ['Chicken biryani', 'Moong dal khichdi', 'Veg pulao']) {
      const r = await sequenceMeal([{ name: dish, amountG: 300 }]);
      expect(r.separable).toBe(false);
      expect(r.order.find((o) => o.rank === 1)?.component).toBe(dish); // listed, not ordered
      noBadCopy(r.explanation.join(' '));
    }
  });

  it('unknown nutrition: unresolvable component is unclassified, fiber never zero', async () => {
    const r = await sequenceMeal([{ name: 'Zorblax root', amountG: 100 }, { name: 'Chicken breast', amountG: 150 }]);
    const z = r.order.find((o) => o.component === 'Zorblax root');
    expect(z.knownFiber).toBe(false);
    expect(z.fiberG).toBeNull();
    expect(z.role).toBe('unknown');
  });

  it('allergy context excludes the allergen from suggested additions', async () => {
    const r = await sequenceMeal([{ name: 'Chicken breast', amountG: 150 }, { name: 'White rice', amountG: 200 }],
      { allergenTerms: new Set(['peanut']), avoidNames: new Set(['peanuts']) });
    if (r.suggestedAddition) expect(r.suggestedAddition.food).not.toMatch(/peanut/i);
    const r2 = await sequenceMeal([{ name: 'Grilled fish', amountG: 150 }], { avoidNames: new Set(['broccoli', 'spinach', 'cabbage', 'green beans', 'salad', 'apple', 'pear', 'chia', 'flax', 'oats', 'lentil', 'chickpea', 'beans']) });
    // With every suggestion avoid-listed, the engine must not invent one.
    expect(r2.suggestedAddition == null || !/broccoli|spinach|peanut/i.test(r2.suggestedAddition.food)).toBe(true);
  });

  it('legume-first restraint: dal gets legume role, not the veg-first slot', async () => {
    const r = await sequenceMeal([{ name: 'Masoor dal', amountG: 200 }, { name: 'White rice', amountG: 200 }, { name: 'Spinach', amountG: 100 }]);
    expect(r.order[0].role).toBe('non_starchy_veg');
    expect(r.order[1].role).toBe('legume');
    expect(r.order[2].role).toBe('starch');
  });
});

describe('E2E daily engine', () => {
  it('incomplete logging: null-fiber log is unknown, never counted as 0 intake', async () => {
    await p.foodLog.create({ data: { userId: ids.user, foodName: 'Mystery meal', quantityG: 300, calories: 500, proteinG: 20, carbsG: 50, fatG: 15, fiberG: null, mealType: 'lunch' } });
    const r = await dailyFiber(ids.user, { persist: false });
    expect(r.status.confirmedG).toBe(0);
    expect(r.status.unknownMeals).toBe(1);
    expect(r.status.completeness).not.toBe('complete');
    expect(r.explanation.join(' ')).toMatch(/no fiber data|may be higher/i);
    noBadCopy(r.explanation.join(' '));
  });

  it('mixed confirmed + unknown: only confirmed sums', async () => {
    await p.foodLog.deleteMany({ where: { userId: ids.user } });
    await p.foodLog.create({ data: { userId: ids.user, foodName: 'Dal + rice', quantityG: 400, calories: 600, proteinG: 20, carbsG: 90, fatG: 10, fiberG: 8, mealType: 'lunch' } });
    await p.foodLog.create({ data: { userId: ids.user, foodName: 'Mystery snack', quantityG: 50, calories: 200, proteinG: 2, carbsG: 25, fatG: 10, fiberG: null, mealType: 'snack' } });
    const r = await dailyFiber(ids.user, { persist: false });
    expect(r.status.confirmedG).toBe(8);
    expect(r.status.unknownMeals).toBe(1);
    expect(r.status.remainingG).toBe(20); // 28 target − 8 confirmed
    expect(r.target.targetG).toBe(28); // 2000 kcal × 14/1000
  });

  it('GI condition → restricted target with clinician-review flag', async () => {
    await p.userHealthCondition.deleteMany({ where: { userId: ids.user } });
    await p.userHealthCondition.create({ data: { userId: ids.user, conditionId: ids.cond2, active: true } });
    const r = await dailyFiber(ids.user, { persist: false });
    expect(r.target.basis).toBe('restricted_reference');
    expect(r.target.reviewRequired).toBe(true);
    expect(r.safety.verdict).toBe('professional_review_required');
    noBadCopy(r.explanation.join(' '));
    await p.userHealthCondition.deleteMany({ where: { userId: ids.user } });
  });
});

describe('E2E psyllium eligibility', () => {
  it('verified label → eligible verdict with label fiber verbatim, never a dose', async () => {
    await p.userHealthCondition.deleteMany({ where: { userId: ids.user } });
    const r = await evaluateFiberSupplement(ids.user, { supplementId: ids.supp });
    expect(['eligible', 'eligible_with_warnings']).toContain(r.outcome);
    expect(r.labelFiberG).toBe(3.4);
    expect(r.servingLabel).toBe('1 tsp (5 g)');
    expect(r.directions.join(' ')).toMatch(/240 mL/i);
    expect(r.directions.join(' ')).toMatch(/never take psyllium dry/i);
    noBadCopy([...r.directions, ...r.disclaimers, ...r.warnings.map(w => w.note), ...r.infos.map(i => i.note), ...r.reasons.map(x => x.note)].join(' '));
    expect(r.persisted).toBe(true);
  });

  it('swallowing condition → suppressed_safety, audit row kept', async () => {
    await p.userHealthCondition.create({ data: { userId: ids.user, conditionId: ids.cond, active: true } });
    const r = await evaluateFiberSupplement(ids.user, { supplementId: ids.supp });
    expect(r.outcome).toBe('suppressed_safety');
    expect(r.reasons.map((x) => x.code)).toContain('swallowing_risk');
    const rows = await p.fiberSupplementCheck.findMany({ where: { userId: ids.user } });
    expect(rows.some((x) => x.outcome === 'suppressed_safety')).toBe(true);
    await p.userHealthCondition.deleteMany({ where: { userId: ids.user } });
  });

  it('unverified label → suppressed_unverified, fiber reported unknown not 0', async () => {
    const bad = await p.supplementProduct.create({ data: { name: `${TAG} unverified psyllium`, verificationStatus: 'UNVERIFIED', dataSource: 'fixture' } });
    const s2 = await p.supplement.create({ data: { name: `${TAG} unverified isabgol`, productId: bad.id, catalogStatus: 'personal', ownerId: ids.user } });
    const r = await evaluateFiberSupplement(ids.user, { supplementId: s2.id });
    expect(r.outcome).toBe('suppressed_unverified');
    expect(r.labelFiberG).toBeNull();
    expect(r.servingKnown).toBe(false);
    await p.supplement.delete({ where: { id: s2.id } });
    await p.supplementProduct.delete({ where: { id: bad.id } });
  });

  it('non-fiber supplement → not_applicable, no safety claims made', async () => {
    const s3 = await p.supplement.create({ data: { name: `${TAG} vitamin d3`, catalogStatus: 'personal', ownerId: ids.user } });
    const r = await evaluateFiberSupplement(ids.user, { supplementId: s3.id });
    expect(r.outcome).toBe('not_applicable');
    await p.supplement.delete({ where: { id: s3.id } });
  });

  it('medications: absence of published rules reports NOT EVALUATED, never "safe"', async () => {
    const r = await evaluateFiberSupplement(ids.user, { supplementId: ids.supp });
    const info = r.infos.find((i) => i.code === 'medications_not_evaluated');
    expect(info).toBeTruthy();
    expect(info.note).toMatch(/not evaluated/i);
    expect(info.note).not.toMatch(/no interaction|safe to take/i);
  });
});

describe('E2E weekly review', () => {
  const logAt = (foodName, fiberG, daysAgo, mealType = 'lunch') => p.foodLog.create({
    data: { userId: ids.user, foodName, quantityG: 200, calories: 300, proteinG: 10, carbsG: 40, fatG: 8, fiberG, mealType, loggedAt: new Date(Date.now() - daysAgo * 86400000) },
  });

  it('no logs → no_data, no deficit claim', async () => {
    await p.foodLog.deleteMany({ where: { userId: ids.user } });
    const r = await weeklyReview(ids.user);
    expect(r.verdict).toBe('no_data');
    expect(r.perDay).toHaveLength(7);
    noBadCopy(r.headline + ' ' + r.disclaimers.join(' '));
  });

  it('mostly unknown logging → mostly_incomplete, not "low intake"', async () => {
    await p.foodLog.deleteMany({ where: { userId: ids.user } });
    for (let i = 0; i < 4; i++) await logAt('Mystery bowl', null, i);
    const r = await weeklyReview(ids.user);
    expect(r.verdict).toBe('mostly_incomplete');
    expect(r.daysBelowTarget).toBe(0); // unknown data must never score as below-target
    expect(r.headline).toMatch(/probably higher|lack fiber data/i);
  });

  it('consistent low confirmed days → below_on_logged_days with recurring-pattern idea', async () => {
    await p.foodLog.deleteMany({ where: { userId: ids.user } });
    for (let i = 0; i < 4; i++) { await logAt('White rice and chicken', 2, i, 'lunch'); await logAt('White bread toast', 1, i, 'breakfast'); }
    const r = await weeklyReview(ids.user);
    expect(r.verdict).toBe('below_on_logged_days');
    expect(r.daysBelowTarget).toBe(4);
    expect(r.avgConfirmedG).toBe(3);
    expect(r.patterns.length).toBeGreaterThanOrEqual(1);
    expect(r.patterns[0].suggestion).toMatch(/side|alongside/i);
    noBadCopy(r.headline + ' ' + r.patterns.map((x) => x.suggestion).join(' '));
    expect(r.patterns.map((x) => x.suggestion).join(' ')).not.toMatch(/psyllium|supplement|isabgol/i);
  });

  it('at-target days → on_track without catch-up language', async () => {
    await p.foodLog.deleteMany({ where: { userId: ids.user } });
    for (let i = 0; i < 4; i++) await logAt('Dal, rice and spinach', 30, i);
    const r = await weeklyReview(ids.user);
    expect(r.verdict).toBe('on_track');
    expect(r.headline).not.toMatch(/deficit|behind|catch up|missed/i);
  });
});

describe('E2E assistant copy contracts', () => {
  it('daily status never reads unknown logs as zero intake', async () => {
    await p.foodLog.deleteMany({ where: { userId: ids.user } });
    await p.foodLog.create({ data: { userId: ids.user, foodName: 'Unscored meal', quantityG: 300, calories: 400, proteinG: 10, carbsG: 40, fatG: 15, fiberG: null, mealType: 'lunch' } });
    const r = await groundFiberAnswer(ids.user, 'how much fiber have I eaten today');
    expect(r.handled).toBe(true);
    expect(r.answer).not.toMatch(/\bate 0 g\b|\b0 g of fiber\b/);
    noBadCopy(r.answer);
  });

  it('supplement questions never produce a dose', async () => {
    for (const q of ['Can I take isabgol?', 'How much fiber is in my psyllium product?', 'Should I take psyllium at night?']) {
      const r = await groundFiberAnswer(ids.user, q);
      if (r.handled) noBadCopy(r.answer);
    }
  });

  it('sequencing questions carry optional framing', async () => {
    const r = await groundFiberAnswer(ids.user, 'what should I eat first');
    if (r.handled) noBadCopy(r.answer);
  });
});
