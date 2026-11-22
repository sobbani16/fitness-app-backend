const request = require('supertest');

// AUD-N2 Class-C regression: five orphan `seed` rows share a normalizedName
// with canonical `humai-catalog` rows. Search must always resolve to the
// catalog row (servings + provenance) and never surface the orphan.
const mockPrisma = {
  ingredientCatalog: { findMany: jest.fn() },
  userIngredient: { findMany: jest.fn(), upsert: jest.fn() },
  ingredient: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const app = require('../src/app');
const usda = require('../src/services/usdaService');

const HEADER = { 'x-user-id': 'user-1' };

function catalogRow(over = {}) {
  return {
    id: 'cat-1',
    name: 'Broccoli, raw',
    normalizedName: 'broccoli, raw',
    aliases: [],
    brand: null,
    restaurantChain: null,
    preparation: 'raw',
    verificationLevel: 'SOURCE_BACKED_FULL',
    usable: true,
    importBatch: 'humai-catalog-2026-11',
    status: 'published',
    sourceRecord: { source: 'usda', fdcId: '169967' },
    ingredient: {
      id: 'ing-canonical',
      fdcId: '169967',
      name: 'Broccoli, raw',
      normalizedName: 'broccoli, raw',
      caloriesPer100g: 34,
      proteinPer100g: 2.8,
      carbsPer100g: 7,
      fatPer100g: 0.4,
      fiberPer100g: 2.6,
      catalogId: 'cat-1',
      source: 'usda',
      servings: [{ id: 'sv-1', label: '1 cup', grams: 91 }],
    },
    ...over,
  };
}

// The orphan: same normalizedName, catalogId null, source 'seed', no servings.
function orphanSeedRow(over = {}) {
  return {
    id: 'ing-orphan',
    fdcId: null,
    name: 'Broccoli, raw',
    normalizedName: 'broccoli, raw',
    caloriesPer100g: 34,
    proteinPer100g: 2.8,
    carbsPer100g: 7,
    fatPer100g: 0.4,
    fiberPer100g: 2.6,
    catalogId: null,
    source: 'seed',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.ingredientCatalog.findMany.mockResolvedValue([]);
  mockPrisma.ingredient.findUnique.mockResolvedValue(null);
  mockPrisma.userIngredient.findMany.mockResolvedValue([]);
  mockPrisma.ingredient.findMany.mockResolvedValue([]);
  mockPrisma.userIngredient.upsert.mockResolvedValue({});
});

afterEach(() => usda.setFetch(globalThis.fetch));

describe('canonical ingredient selection (AUD-N2 regression)', () => {
  it('returns the humai-catalog row, not the same-named orphan seed row', async () => {
    const cat = catalogRow();
    mockPrisma.ingredientCatalog.findMany
      .mockResolvedValueOnce([cat]) // first call: ranking pass (light select)
      .mockResolvedValueOnce([cat]); // second call: detail pass (with servings)
    mockPrisma.ingredient.findMany.mockResolvedValue([orphanSeedRow()]);

    const res = await request(app).get('/ingredients/search').query({ q: 'broccoli, raw' }).set(HEADER);

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].id).toBe('ing-canonical');
    expect(res.body.results[0].source).toBe('humai-catalog');
    expect(res.body.results[0].servings).toHaveLength(1);
  });

  it('catalog hit short-circuits before the central tier — orphan is never queried', async () => {
    const cat = catalogRow();
    mockPrisma.ingredientCatalog.findMany
      .mockResolvedValueOnce([cat])
      .mockResolvedValueOnce([cat]);

    const res = await request(app).get('/ingredients/search').query({ q: 'broccoli' }).set(HEADER);

    expect(res.status).toBe(200);
    expect(res.body.results[0].source).toBe('humai-catalog');
    // Early return on catalog hits: the tier-2 central findMany (where the
    // orphan lives) must not run at all.
    expect(mockPrisma.ingredient.findMany).not.toHaveBeenCalled();
  });

  it('does not leak the orphan via the user-cache tier when a catalog row exists', async () => {
    const cat = catalogRow();
    mockPrisma.ingredientCatalog.findMany
      .mockResolvedValueOnce([cat])
      .mockResolvedValueOnce([cat]);
    mockPrisma.userIngredient.findMany.mockResolvedValue([{ ingredient: orphanSeedRow() }]);

    const res = await request(app).get('/ingredients/search').query({ q: 'broccoli, raw' }).set(HEADER);

    expect(res.status).toBe(200);
    expect(res.body.results.map(r => r.id)).not.toContain('ing-orphan');
    expect(res.body.results[0].id).toBe('ing-canonical');
  });
});
