const request = require('supertest');
const app = require('../src/app');
const recipeService = require('../src/services/recipeService');

jest.setTimeout(30000);

describe('recipes routes (no API key)', () => {
  const prevKey = process.env.SPOONACULAR_API_KEY;

  beforeAll(() => {
    delete process.env.SPOONACULAR_API_KEY;
  });

  afterAll(() => {
    if (prevKey === undefined) delete process.env.SPOONACULAR_API_KEY;
    else process.env.SPOONACULAR_API_KEY = prevKey;
  });

  it('reports unconfigured search without fabricating results', async () => {
    const res = await request(app).get('/recipes/search').query({q:'chicken'});
    expect(res.status).toBe(503);
    expect(res.body.results).toBeUndefined();
  });
  it('reports unconfigured nutrition', async () => {
    const res=await request(app).get('/recipes/123/nutrition');
    expect(res.status).toBe(503);
  });
});

describe('recipeService with API key (mocked fetch)', () => {
  const prevKey = process.env.SPOONACULAR_API_KEY;

  beforeAll(() => {
    process.env.SPOONACULAR_API_KEY = 'test-key';
  });

  afterAll(() => {
    if (prevKey === undefined) delete process.env.SPOONACULAR_API_KEY;
    else process.env.SPOONACULAR_API_KEY = prevKey;
    recipeService.setFetch(globalThis.fetch);
  });

  it('parses Spoonacular autocomplete results', async () => {
    recipeService.setFetch(async () => ({
      ok: true,
      json: async () => [
        { id: 123, title: 'Grilled Chicken', image: 'chicken.jpg' },
      ],
    }));
    const results = await recipeService.searchRecipes('chicken');
    expect(results[0]).toMatchObject({ id: '123', title: 'Grilled Chicken' });
    expect(results[0].image).toContain('chicken.jpg');
  });

  it('parses Spoonacular nutrition into per-100g macros', async () => {
    recipeService.setFetch(async () => ({
      ok: true,
      json: async () => ({
        title: 'Grilled Chicken',
        servings: 2,
        nutrition: {
          weightPerServing: { amount: 200, unit: 'g' },
          nutrients: [
            { name: 'Calories', amount: 330, unit: 'kcal' },
            { name: 'Protein', amount: 62, unit: 'g' },
            { name: 'Carbohydrates', amount: 0, unit: 'g' },
            { name: 'Fat', amount: 8, unit: 'g' },
          ],
        },
      }),
    }));
    const n = await recipeService.getRecipeNutrition('123');
    expect(n.calories).toBe(330);
    expect(n.servingWeightGrams).toBe(200);
    // 330 kcal / 200g -> 165 kcal / 100g
    expect(n.caloriesPer100g).toBe(165);
    expect(n.macrosPer100g.protein_g).toBe(31);
  });

  it('reports provider failure without fabricated data', async () => {
    recipeService.setFetch(async () => ({ ok: false, status: 402 }));
    await expect(recipeService.searchRecipes('chicken')).rejects.toMatchObject({status:503});
  });
});
