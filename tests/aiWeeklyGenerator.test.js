jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn(), aiEnabled: () => true }));
const { askJSON } = require('../src/services/aiProvider');
const { generateAiWeeklyMeals, mealViolations, normalizeMeal } = require('../src/services/weekly/aiWeeklyGenerator');

const ctx = (over = {}) => ({
  userId: 'u1', caloriesTarget: 2000, proteinTarget: 120, carbsTarget: 200, fatTarget: 65, fiberTarget: 30,
  restrictions: [], dislikedFoods: [], likedFoods: [], allergies: [], cuisines: ['indian'],
  equipment: ['stovetop'], mealPrepStyle: 'daily_cooking', ...over,
});

const meal = (day, type, over = {}) => ({
  dayOfWeek: day, mealType: type, foodName: `Dish ${day} ${type}`, portionG: 350,
  calories: 500, proteinG: 30, carbsG: 55, fatG: 15, fiberG: 6,
  ingredients: [{ name: 'rice', grams: 180 }, { name: 'beans', grams: 100 }], prepNote: 'Cook and serve.', ...over,
});
const week = (mutate) => {
  const days = [];
  for (let d = 0; d < 7; d++) for (const t of ['breakfast', 'lunch', 'dinner']) days.push(meal(d, t));
  if (mutate) mutate(days);
  return { days };
};

describe('aiWeeklyGenerator safety gate', () => {
  beforeEach(() => askJSON.mockReset());

  it('accepts a clean 7-day draft and preserves ingredient grams', async () => {
    askJSON.mockResolvedValue(week());
    const r = await generateAiWeeklyMeals(ctx());
    expect(r.meals).toHaveLength(21);
    expect(r.meals[0].ingredients).toEqual([{ name: 'rice', grams: 180 }, { name: 'beans', grams: 100 }]);
    expect(r.meta.dropped).toHaveLength(0);
  });

  it('drops meals whose declared ingredients violate a dietary restriction', async () => {
    askJSON
      .mockResolvedValueOnce(week(days => { days[4] = meal(1, 'lunch', { foodName: 'chicken curry', ingredients: [{ name: 'chicken', grams: 150 }, { name: 'onion', grams: 60 }] }); }))
      .mockResolvedValueOnce(week());
    const r = await generateAiWeeklyMeals(ctx({ restrictions: ['vegetarian'] }));
    expect(r.meta.dropped[0]).toMatchObject({ foodName: 'chicken curry' });
    expect(r.meta.dropped[0].violations[0]).toMatch(/vegetarian/);
    expect(r.meals.some(m => m.foodName === 'chicken curry')).toBe(false);
  });

  it('drops meals matching a saved allergy even when buried in ingredients', async () => {
    askJSON
      .mockResolvedValueOnce(week(days => { days[0] = meal(0, 'breakfast', { foodName: 'satay oats', ingredients: [{ name: 'oats', grams: 60 }, { name: 'peanut sauce', grams: 20 }] }); }))
      .mockResolvedValueOnce(week());
    const r = await generateAiWeeklyMeals(ctx({ allergies: ['Peanut'] }));
    expect(r.meals.some(m => m.foodName === 'satay oats')).toBe(false);
    expect(r.meta.dropped[0].violations[0]).toMatch(/allergy/i);
  });

  it('honors exclude: entries and disliked foods', async () => {
    askJSON
      .mockResolvedValueOnce(week(days => {
        days[1] = meal(0, 'lunch', { foodName: 'banana smoothie', ingredients: [{ name: 'banana', grams: 120 }, { name: 'milk', grams: 200 }] });
        days[2] = meal(0, 'dinner', { foodName: 'mushroom rice', ingredients: [{ name: 'mushroom', grams: 100 }] });
      }))
      .mockResolvedValueOnce(week());
    const r = await generateAiWeeklyMeals(ctx({ restrictions: ['exclude:banana'], dislikedFoods: ['mushroom'] }));
    expect(r.meals.some(m => ['banana smoothie', 'mushroom rice'].includes(m.foodName))).toBe(false);
    expect(r.meta.dropped).toHaveLength(2);
  });

  it('fails safely when filtered output cannot cover every day', async () => {
    askJSON.mockResolvedValue(week(days => days.splice(3, 1))); // day 1 breakfast missing in every response
    await expect(generateAiWeeklyMeals(ctx())).rejects.toMatchObject({ status: 422 });
    expect(askJSON).toHaveBeenCalledTimes(1); // no retry — nothing was dropped for violations
  });

  it('returns 422 rather than showing a violating meal when retries still violate', async () => {
    askJSON.mockResolvedValue(week(days => { days[4] = meal(1, 'lunch', { foodName: 'chicken curry', ingredients: [{ name: 'chicken', grams: 150 }] }); }));
    await expect(generateAiWeeklyMeals(ctx({ restrictions: ['vegetarian'] }))).rejects.toMatchObject({ status: 422 });
    expect(askJSON).toHaveBeenCalledTimes(2);
  });

  it('drops meals whose resolved ingredients hit a condition block rule', async () => {
    const resolve = async names => new Map(names.map(n => [n, { id: `i-${n}`, attributes: n === 'bacon' ? ['HIGH_SODIUM'] : [] }]));
    askJSON
      .mockResolvedValueOnce(week(days => { days[7] = meal(2, 'lunch', { foodName: 'bacon wrap', ingredients: [{ name: 'bacon', grams: 60 }, { name: 'lettuce', grams: 40 }] }); }))
      .mockResolvedValueOnce(week());
    const r = await generateAiWeeklyMeals(ctx({
      conditionRules: [{ attribute: 'HIGH_SODIUM', action: 'block', reason: 'limit sodium', conditionName: 'Hypertension' }],
      resolveIngredients: resolve,
    }));
    expect(r.meals.some(m => m.foodName === 'bacon wrap')).toBe(false);
    expect(r.meta.dropped[0].violations[0]).toMatch(/Hypertension/);
  });

  it('treats unresolvable ingredients as unverifiable when block rules are active', async () => {
    const resolve = async names => new Map(names.filter(n => n !== 'mystery herb').map(n => [n, { id: `i-${n}`, attributes: [] }]));
    askJSON
      .mockResolvedValueOnce(week(days => { days[0] = meal(0, 'breakfast', { foodName: 'herb bowl', ingredients: [{ name: 'mystery herb', grams: 10 }] }); }))
      .mockResolvedValueOnce(week());
    const r = await generateAiWeeklyMeals(ctx({
      conditionRules: [{ attribute: 'HIGH_SODIUM', action: 'block', conditionName: 'Hypertension' }],
      resolveIngredients: resolve,
    }));
    expect(r.meals.some(m => m.foodName === 'herb bowl')).toBe(false);
    expect(r.meta.dropped[0].violations[0]).toMatch(/unverifiable/);
  });

  it('warns but keeps meals hitting warn rules; enforces per-serving HIGH nutrient limits', async () => {
    const resolve = async names => new Map(names.map(n => [n, { id: `i-${n}`, attributes: n === 'beans' ? ['MODERATE_PURINE'] : [] }]));
    askJSON
      .mockResolvedValueOnce(week(days => { days[3] = meal(1, 'breakfast', { foodName: 'butter toast', carbsG: 80, fatG: 30, calories: 710 }); }))
      .mockResolvedValueOnce(week());
    const r = await generateAiWeeklyMeals(ctx({
      conditionRules: [{ attribute: 'MODERATE_PURINE', action: 'warn', reason: 'watch purines', conditionName: 'Gout' }],
      nutrientRules: [{ action: 'LIMIT', severity: 'HIGH', thresholdValue: 75, thresholdUnit: 'g', thresholdBasis: 'PER_SERVING', conditionName: 'Diabetes', nutrient: { code: 'carbohydrate', name: 'Carbohydrate', unit: 'g' } }],
      resolveIngredients: resolve,
    }));
    expect(r.meals.some(m => m.foodName === 'butter toast')).toBe(false); // 80g carbs > 75g limit → dropped
    expect(r.meta.mealWarnings.length).toBeGreaterThan(0);
    expect(r.meta.mealWarnings[0].warnings[0]).toMatch(/Gout/);
  });

  it('flags daily-basis limits on day totals and unverifiable nutrients without dropping meals', async () => {
    askJSON.mockResolvedValue(week(days => { days[0] = meal(0, 'breakfast', { carbsG: 140, calories: 820 }); days[1] = meal(0, 'lunch', { carbsG: 140, calories: 820 }); days[2] = meal(0, 'dinner', { carbsG: 140, calories: 820 }); }));
    const r = await generateAiWeeklyMeals(ctx({
      nutrientRules: [
        { action: 'LIMIT', severity: 'HIGH', thresholdValue: 300, thresholdUnit: 'g', thresholdBasis: 'DAILY', conditionName: 'Diabetes', nutrient: { code: 'carbohydrate', name: 'Carbohydrate', unit: 'g' } },
        { action: 'LIMIT', severity: 'HIGH', thresholdValue: 2000, thresholdUnit: 'mg', thresholdBasis: 'DAILY', conditionName: 'Hypertension', nutrient: { code: 'sodium', name: 'Sodium', unit: 'mg' } },
      ],
    }));
    expect(r.meals.length).toBeGreaterThan(0); // nothing dropped — daily totals + unverifiable are surfaced, not vetoed
    expect(r.meta.dayAssessment[0].warnings.join(' ')).toMatch(/carbohydrate.*exceeds/i);
    expect(r.meta.notes.join(' ')).toMatch(/sodium.*cannot be verified/i);
  });

  it('rejects malformed or implausible meals instead of trusting AI numbers', async () => {
    expect(normalizeMeal({ mealType: 'brunch', foodName: 'x', calories: 500 }, 0)).toBeNull();
    expect(normalizeMeal(meal(0, 'lunch', { calories: -5 }), 0)).toBeNull();
    expect(normalizeMeal(meal(0, 'lunch', { calories: 500, proteinG: 5, carbsG: 5, fatG: 1 }), 0)).toBeNull(); // 49kcal ≠ 500kcal claim
    expect(normalizeMeal(meal(0, 'lunch', { ingredients: [{ name: 'rice', grams: -3 }] }), 0).ingredients).toHaveLength(0);
    expect(mealViolations(normalizeMeal(meal(0, 'lunch'), 0), ctx({ restrictions: ['gluten-free'] }))).toEqual([]);
  });
});
