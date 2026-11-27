// Food Intelligence tests — barcode, evidence, deterministic suitability.
jest.mock('../src/services/featureFlags/service', () => ({ isEnabled: jest.fn(async () => false) }));
const flagSvc = require('../src/services/featureFlags/service');
jest.mock('../src/lib/prisma', () => { const db = {
  barcodeFavorite: { findUnique: jest.fn(), delete: jest.fn(), create: jest.fn(), findMany: jest.fn() },
  productCorrection: { create: jest.fn() },
  barcodeProductUpdateHolder: undefined,
  barcodeProduct: { findUnique: jest.fn(), upsert: jest.fn() },
  ingredientEvidenceProfile: { count: jest.fn(), upsert: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  userAllergy: { findMany: jest.fn() },
  foodPreference: { findMany: jest.fn() },
  userPlanningPreferences: { findUnique: jest.fn() },
  userHealthCondition: { findMany: jest.fn() },
}; return { getPrisma: () => db }; });;
const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();
const svc = require('../src/services/foodIntel');

describe('food intelligence', () => {
  beforeEach(() => jest.clearAllMocks());

  test('barcode: exact match returns product, unknown returns next-step', async () => {
    prisma.barcodeProduct.findUnique.mockResolvedValueOnce({ barcode: '8901234', name: 'Oats', source: 'catalog' });
    const hit = await svc.resolveBarcode('8901234');
    expect(hit.found).toBe(true); expect(hit.verified).toBe(true);
    prisma.barcodeProduct.findUnique.mockResolvedValueOnce(null);
    const miss = await svc.resolveBarcode('9999999');
    expect(miss.found).toBe(false); expect(miss.nextStep).toBe('label_photo_or_manual');
    await expect(svc.resolveBarcode('')).rejects.toMatchObject({ status: 400 });
  });

  test('evidence: cinnamon profile rejects weight-loss claim', async () => {
    prisma.ingredientEvidenceProfile.count.mockResolvedValue(10);
    const prof = svc.EVIDENCE_SEED.find((s) => s.ingredientKey === 'cinnamon');
    prisma.ingredientEvidenceProfile.findFirst.mockResolvedValue({ ...prof, version: 1, status: 'APPROVED' });
    const ev = await svc.getEvidence('cinnamon');
    expect(ev.found).toBe(true);
    const wl = ev.claims.find((c) => /weight/i.test(c.claim));
    expect(wl.verdict).toBe('insufficient'); // never marketed as established
  });

  test('evidence: only APPROVED/ACTIVE surface; unapproved returns not-found', async () => {
    prisma.ingredientEvidenceProfile.count.mockResolvedValue(10);
    prisma.ingredientEvidenceProfile.findFirst.mockResolvedValue(null);
    const ev = await svc.getEvidence('obscure-herb');
    expect(ev.found).toBe(false);
  });

  test('seed profiles avoid supplement→culinary overclaiming', () => {
    const turmeric = svc.EVIDENCE_SEED.find((s) => s.ingredientKey === 'turmeric');
    const treat = turmeric.claims.find((c) => /treats inflammatory/i.test(c.claim));
    expect(treat.verdict).toBe('insufficient');
    expect(treat.applicability).toMatch(/culinary/i);
  });

  test('suitability: allergy is a hard conflict', async () => {
    prisma.userAllergy.findMany.mockResolvedValue([{ allergy: { name: 'peanut' } }]);
    prisma.userPlanningPreferences.findUnique.mockResolvedValue(null);
    prisma.foodPreference.findMany.mockResolvedValue([]);
    prisma.userHealthCondition.findMany.mockResolvedValue([]);
    const r = await svc.checkSuitability('u1', { ingredientText: 'oats, peanut butter, honey' });
    expect(r.verdict).toBe('conflict');
    expect(r.reasons[0].severity).toBe('hard');
  });

  test('suitability: vegetarian exclusion catches gelatin; beef exclusion catches beef', async () => {
    prisma.userAllergy.findMany.mockResolvedValue([]);
    prisma.userPlanningPreferences.findUnique.mockResolvedValue({ dietaryRestrictions: ['vegetarian'] });
    prisma.foodPreference.findMany.mockResolvedValue([]);
    prisma.userHealthCondition.findMany.mockResolvedValue([]);
    const r = await svc.checkSuitability('u1', { ingredientText: 'sugar, gelatin, flavor' });
    expect(r.verdict).toBe('conflict');
  });

  test('suitability: unknown composition does not claim safety', async () => {
    prisma.userAllergy.findMany.mockResolvedValue([]);
    prisma.userPlanningPreferences.findUnique.mockResolvedValue(null);
    prisma.foodPreference.findMany.mockResolvedValue([]);
    prisma.userHealthCondition.findMany.mockResolvedValue([]);
    const r = await svc.checkSuitability('u1', {});
    expect(r.verdict).toBe('unknown');
    expect(r.reasons).toEqual([]);
  });

  test('suitability: dislike is soft caution, not a block', async () => {
    prisma.userAllergy.findMany.mockResolvedValue([]);
    prisma.userPlanningPreferences.findUnique.mockResolvedValue(null);
    prisma.foodPreference.findMany.mockResolvedValue([{ foodName: 'cilantro', preference: 'DISLIKE' }]);
    prisma.userHealthCondition.findMany.mockResolvedValue([]);
    const r = await svc.checkSuitability('u1', { ingredientText: 'rice, cilantro, lime' });
    expect(r.verdict).toBe('caution');
    expect(r.reasons[0].severity).toBe('soft');
  });

  // --- Barcode volume-basis pipeline (HUM-49): provider response → normalized
  // lookup → cached row → FoodLog creation. Provenance must FLOW through the
  // pipeline — nothing is hand-seeded downstream.
  describe('barcode volume nutrition basis pipeline', () => {
    const OFF_BEVERAGE = {
      status: 1,
      product: {
        product_name: 'Matrix Orange Juice', brands: 'MatrixCo',
        serving_size: '330 ml', serving_quantity: 330, product_quantity: 330,
        // per-serving declaration for a volume-quantified serving == the label
        // declaring nutrition per volume (here equivalent to 42 kcal/100 ml).
        nutriments: { 'energy-kcal_serving': 138.6, proteins_serving: 2.3, carbohydrates_serving: 33, fat_serving: 0.7, fiber_serving: 0.7 },
        ingredients_text: 'orange juice', allergens_tags: [],
      },
    };
    const OFF_PER100G_ONLY = {
      status: 1,
      product: {
        product_name: 'Matrix Ambiguous Drink', brands: 'MatrixCo',
        serving_size: '330 ml', serving_quantity: 330,
        // nutrition declared per 100 g ONLY — no per-serving values. With no
        // verified density there is no honest path from volume to nutrition.
        nutriments: { 'energy-kcal_100g': 45, proteins_100g: 0.5 },
        ingredients_text: 'water, sugar', allergens_tags: [],
      },
    };
    let fetchBackup;
    beforeEach(() => {
      fetchBackup = global.fetch;
      flagSvc.isEnabled.mockImplementation(async (k) => k === 'food_external_catalog_enabled');
      prisma.foodLog = { create: jest.fn(async ({ data }) => ({ id: 'log-1', ...data })) };
    });
    afterEach(() => { global.fetch = fetchBackup; flagSvc.isEnabled.mockImplementation(async () => false); delete prisma.foodLog; });

    test('normalization: 330 ml serving label classifies as ml volume, never mass', async () => {
      global.fetch = jest.fn(async () => ({ ok: true, json: async () => OFF_BEVERAGE }));
      prisma.barcodeProduct.findUnique.mockResolvedValue(null);
      const r = await svc.resolveBarcode('4600000000001');
      expect(r.found).toBe(true);
      expect(r.product.servingUnit).toBe('ml');
      expect(r.product.servingSizeMl).toBe(330);
      expect(r.product.servingSizeG).toBeNull(); // volume declaration never becomes grams
      // the cache write carries the unit evidence inside the nutrients payload
      const cached = prisma.barcodeProduct.upsert.mock.calls[0][0].create;
      expect(cached.nutrients.servingUnit).toBe('ml');
      expect(cached.nutrients.servingSizeMl).toBe(330);
    });

    test('volume-declared beverage: 330 mL log persists 138.6 kcal, null mass, PER_100_ML provenance — no hand-seeding', async () => {
      global.fetch = jest.fn(async () => ({ ok: true, json: async () => OFF_BEVERAGE }));
      prisma.barcodeProduct.findUnique.mockResolvedValue(null);
      await svc.resolveBarcode('4600000000001');
      // pipeline fidelity: the row the lookup cached is what logging re-reads.
      const cachedRow = prisma.barcodeProduct.upsert.mock.calls[0][0].create;
      prisma.barcodeProduct.findUnique.mockResolvedValue(cachedRow);
      const saved = await svc.logScannedFood('u1', { productName: 'Matrix Orange Juice', servingVolumeMl: 330, barcode: '4600000000001' });
      const data = prisma.foodLog.create.mock.calls[0][0].data;
      expect(data.quantityG).toBeNull(); // mass honestly unknown — never fabricated
      expect(data.quantityMl).toBe(330);
      expect(data.quantityUnit).toBe('ml');
      expect(data.calories).toBeCloseTo(138.6, 2);
      expect(data.nutritionSnapshot.nutritionBasis).toBe('PER_100_ML');
      expect(data.nutritionSnapshot.basisEvidence).toBe('manufacturer-volume-serving-declaration');
      expect(data.nutritionSnapshot.basisDerivedFrom).toBe('barcode-cache'); // provenance flowed, not asserted
      expect(data.nutritionSnapshot.declaredServingMl).toBe(330);
      expect(data.nutritionSnapshot.massSource).toBeNull();
      expect(saved.id).toBe('log-1');
    });

    test('scaling: consuming half the declared volume yields exactly half the nutrition', async () => {
      global.fetch = jest.fn(async () => ({ ok: true, json: async () => OFF_BEVERAGE }));
      prisma.barcodeProduct.findUnique.mockResolvedValue(null);
      await svc.resolveBarcode('4600000000001');
      prisma.barcodeProduct.findUnique.mockResolvedValue(prisma.barcodeProduct.upsert.mock.calls[0][0].create);
      await svc.logScannedFood('u1', { productName: 'Matrix Orange Juice', servingVolumeMl: 165, barcode: '4600000000001' });
      const data = prisma.foodLog.create.mock.calls[0][0].data;
      expect(data.calories).toBeCloseTo(69.3, 2);
      expect(data.quantityMl).toBe(165);
    });

    test('CONTROL: serving labeled mL but nutrition declared per 100 g only → rejected, ZERO writes', async () => {
      global.fetch = jest.fn(async () => ({ ok: true, json: async () => OFF_PER100G_ONLY }));
      prisma.barcodeProduct.findUnique.mockResolvedValue(null);
      await svc.resolveBarcode('4600000000002');
      prisma.barcodeProduct.findUnique.mockResolvedValue(prisma.barcodeProduct.upsert.mock.calls[0][0].create);
      await expect(svc.logScannedFood('u1', { productName: 'Matrix Ambiguous Drink', servingVolumeMl: 330, barcode: '4600000000002' }))
        .rejects.toMatchObject({ status: 400, message: 'volume_nutrition_basis_required' });
      expect(prisma.foodLog.create).not.toHaveBeenCalled(); // zero writes
    });

    test('gram path preserved: servingG logging unchanged with mass provenance', async () => {
      const saved = await svc.logScannedFood('u1', { productName: 'Oats', servingG: 40, servingLabel: '1/2 cup (40 g)', servingUnit: 'g', massSource: 'manufacturer', nutrients: { calories: 152, proteinG: 5 } });
      const data = prisma.foodLog.create.mock.calls[0][0].data;
      expect(data.quantityG).toBe(40);
      expect(data.quantityMl).toBeUndefined(); // gram path untouched
      expect(data.calories).toBe(152);
      expect(data.nutritionSnapshot.massSource).toBe('manufacturer');
      expect(data.nutritionSnapshot.nutritionBasis).toBeUndefined();
    });
  });

});
