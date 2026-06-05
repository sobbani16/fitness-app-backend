const request = require('supertest');

// Mock the Prisma client so the route/service can be exercised without a DB.
// Each test sets the resolved values to drive a specific cache tier.
const mockPrisma = {
  userIngredient: { findMany: jest.fn(), upsert: jest.fn() },
  ingredient: { findMany: jest.fn(), upsert: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const app = require('../src/app');
const usda = require('../src/services/usdaService');

const HEADER = { 'x-user-id': 'user-1' };

function ingredientRow(over = {}) {
  return {
    id: 'ing-1',
    fdcId: '123',
    name: 'Chicken breast',
    normalizedName: 'chicken breast',
    caloriesPer100g: 165,
    proteinPer100g: 31,
    carbsPer100g: 0,
    fatPer100g: 3.6,
    source: 'usda',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.userIngredient.findMany.mockResolvedValue([]);
  mockPrisma.ingredient.findMany.mockResolvedValue([]);
  mockPrisma.userIngredient.upsert.mockResolvedValue({});
  mockPrisma.ingredient.upsert.mockImplementation(async ({ create }) => ingredientRow(create));
});

afterEach(() => usda.setFetch(globalThis.fetch));

describe('GET /ingredients/search', () => {
  it('requires x-user-id', async () => {
    const res = await request(app).get('/ingredients/search').query({ q: 'chicken' });
    expect(res.status).toBe(400);
  });

  it('requires a query', async () => {
    const res = await request(app).get('/ingredients/search').set(HEADER);
    expect(res.status).toBe(400);
  });

  it('Tier 1: serves from the user table without hitting USDA', async () => {
    const fetchSpy = jest.fn();
    usda.setFetch(fetchSpy);
    mockPrisma.userIngredient.findMany.mockResolvedValue([{ ingredient: ingredientRow() }]);

    const res = await request(app).get('/ingredients/search').query({ q: 'chicken' }).set(HEADER);

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].source).toBe('user-cache');
    expect(res.body.results[0].macrosPer100g).toEqual({ protein_g: 31, carbs_g: 0, fat_g: 3.6 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockPrisma.ingredient.findMany).not.toHaveBeenCalled();
  });

  it('Tier 2: central hit links to the user table and skips USDA', async () => {
    const fetchSpy = jest.fn();
    usda.setFetch(fetchSpy);
    mockPrisma.ingredient.findMany.mockResolvedValue([ingredientRow()]);

    const res = await request(app).get('/ingredients/search').query({ q: 'chicken' }).set(HEADER);

    expect(res.status).toBe(200);
    expect(res.body.results[0].source).toBe('central-cache');
    // Linked into the user's table.
    expect(mockPrisma.userIngredient.upsert).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Tier 3: USDA miss stores into BOTH central and user tables', async () => {
    usda.setFetch(async () => ({
      ok: true,
      json: async () => ({
        foods: [
          {
            fdcId: 999,
            description: 'Chickpeas, raw',
            foodNutrients: [
              { nutrientName: 'Energy', unitName: 'KCAL', value: 364 },
              { nutrientName: 'Protein', value: 19 },
              { nutrientName: 'Carbohydrate, by difference', value: 61 },
              { nutrientName: 'Total lipid (fat)', value: 6 },
            ],
          },
        ],
      }),
    }));
    mockPrisma.ingredient.upsert.mockImplementation(async ({ create }) =>
      ingredientRow({ ...create, id: 'ing-new' }),
    );

    const res = await request(app).get('/ingredients/search').query({ q: 'chickpeas' }).set(HEADER);

    expect(res.status).toBe(200);
    expect(res.body.results[0].source).toBe('usda');
    expect(res.body.results[0].name).toBe('Chickpeas, raw');
    expect(res.body.results[0].caloriesPer100g).toBe(364);
    expect(res.body.results[0].macrosPer100g).toEqual({ protein_g: 19, carbs_g: 61, fat_g: 6 });
    // Stored centrally and linked to the user.
    expect(mockPrisma.ingredient.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.userIngredient.upsert).toHaveBeenCalledTimes(1);
  });
});
