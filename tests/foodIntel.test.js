// Food Intelligence tests — barcode, evidence, deterministic suitability.
jest.mock('../src/lib/prisma', () => { const db = {
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
});
