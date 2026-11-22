// Fiber supplement eligibility — label verification + safety gates.
// The service must fail closed: unverified labels, GI contraindications,
// missing interaction data, and minors all suppress or warn — never a dose.

const store = { supplement: null, product: null, user: null, conditions: [], allergies: [], suppLogs: [], rules: [], checks: [] };

jest.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    supplement: {
      findUnique: async ({ where }) => (store.supplement && store.supplement.id === where.id ? store.supplement : null),
      findFirst: async () => store.supplement,
    },
    supplementProduct: {
      findUnique: async ({ where }) => (store.product && store.product.id === where.id ? store.product : null),
    },
    user: { findUnique: async () => store.user },
    userHealthCondition: { findMany: async () => store.conditions },
    userAllergy: { findMany: async () => store.allergies },
    supplementLog: { findMany: async () => store.suppLogs },
    supplementInteractionRule: { findMany: async () => store.rules },
    fiberSupplementCheck: {
      create: async ({ data }) => { const row = { id: `check-${store.checks.length + 1}`, ...data }; store.checks.push(row); return row; },
      findFirst: async ({ where }) => store.checks.find((c) => c.id === where.id && c.userId === where.userId) || null,
      update: async ({ where, data }) => Object.assign(store.checks.find((c) => c.id === where.id), data),
    },
  }),
}));

const { evaluateFiberSupplement, confirmCheck } = require('../src/services/fiber/supplementCheck');

const ADULT = { dateOfBirth: new Date('1990-01-01T00:00:00Z') };

function verifiedProduct(overrides = {}) {
  return {
    id: 'prod-1', name: 'Psyllium Husk Powder', brand: 'BrandX', manufacturer: 'Mfg',
    verificationStatus: 'VERIFIED', servingSize: 5, servingUnit: 'g', servingText: '1 rounded teaspoon (5 g)',
    labelFacts: { dietaryFiberG: 4, directions: 'Mix into 8 oz water.' }, warnings: 'Take with a full glass of water.',
    dataSource: 'label_photo', ingredients: [],
    ...overrides,
  };
}
const psylliumSupp = { id: 'supp-1', name: 'Psyllium husk', category: 'Fiber, gut & digestion', ingredient: { slug: 'psyllium-husk', name: 'Psyllium husk', parentFamily: 'fiber' } };

beforeEach(() => {
  store.supplement = { ...psylliumSupp, product: null };
  store.product = null;
  store.user = ADULT;
  store.conditions = []; store.allergies = []; store.suppLogs = []; store.rules = []; store.checks = [];
});

describe('product verification', () => {
  it('rejects non-fiber supplements as not_applicable without touching label data', async () => {
    store.supplement = { id: 'supp-9', name: 'Vitamin D3', ingredient: { slug: 'vitamin-d' }, product: null };
    const r = await evaluateFiberSupplement('u1', { supplementId: 'supp-9' });
    expect(r.outcome).toBe('not_applicable');
    expect(r.education.points.length).toBeGreaterThan(0);
  });
  it('suppresses when no verified label exists — fiber stays unknown', async () => {
    store.product = verifiedProduct({ verificationStatus: 'UNVERIFIED' });
    const r = await evaluateFiberSupplement('u1', { productId: 'prod-1' });
    expect(r.outcome).toBe('suppressed_unverified');
    expect(r.labelFiberG).toBeNull();
    expect(r.servingKnown).toBe(false);
    expect(r.reasons.map((x) => x.code)).toContain('label_unverified');
  });
  it('suppresses when the label has no fiber line', async () => {
    store.product = verifiedProduct({ labelFacts: { directions: 'x' } });
    const r = await evaluateFiberSupplement('u1', { productId: 'prod-1' });
    expect(r.outcome).toBe('suppressed_unverified');
    expect(r.labelFiberG).toBeNull();
  });
  it('returns label fiber verbatim when verified — no tsp→g guessing', async () => {
    store.product = verifiedProduct();
    const r = await evaluateFiberSupplement('u1', { productId: 'prod-1' });
    expect(r.outcome).toBe('eligible');
    expect(r.labelFiberG).toBe(4);
    expect(r.servingLabel).toBe('1 rounded teaspoon (5 g)');
    expect(r.fiberSource).toBe('product_label');
  });
  it('marks review_only catalog entries as suppressed, never suggested', async () => {
    store.supplement = { ...psylliumSupp, catalogStatus: 'review_only', product: verifiedProduct() };
    const r = await evaluateFiberSupplement('u1', { supplementId: 'supp-1' });
    expect(r.outcome).toBe('suppressed_safety');
    expect(r.reasons.map((x) => x.code)).toContain('review_only_entry');
  });
});

describe('safety gates', () => {
  beforeEach(() => { store.product = verifiedProduct(); });
  it.each([
    ['swallowing', { name: 'Dysphagia' }, 'swallowing_risk'],
    ['obstruction', { name: 'Bowel obstruction' }, 'gi_obstruction'],
    ['IBD', { name: 'Crohn disease' }, 'gi_ibd'],
    ['stricture', { name: 'Intestinal stricture' }, 'gi_stricture'],
  ])('suppresses for %s', async (_label, cond, code) => {
    store.conditions = [{ condition: cond }];
    const r = await evaluateFiberSupplement('u1', { productId: 'prod-1' });
    expect(r.outcome).toBe('suppressed_safety');
    expect(r.reasons.map((x) => x.code)).toContain(code);
  });
  it('suppresses under-12 users', async () => {
    store.user = { dateOfBirth: new Date(Date.now() - 8 * 365.25 * 86400000) };
    const r = await evaluateFiberSupplement('u1', { productId: 'prod-1' });
    expect(r.outcome).toBe('suppressed_safety');
    expect(r.reasons.map((x) => x.code)).toContain('under_12');
  });
  it('warns for pregnancy and fluid-restricted conditions', async () => {
    store.conditions = [{ condition: { name: 'Pregnancy' } }, { condition: { name: 'Chronic kidney disease' } }];
    const r = await evaluateFiberSupplement('u1', { productId: 'prod-1' });
    expect(r.outcome).toBe('eligible_with_warnings');
    expect(r.warnings.map((x) => x.code).sort()).toEqual(['fluid_restriction', 'pregnancy']);
  });
  it('suppresses on a recorded psyllium allergy', async () => {
    store.allergies = [{ allergy: { name: 'Psyllium' } }];
    const r = await evaluateFiberSupplement('u1', { productId: 'prod-1' });
    expect(r.outcome).toBe('suppressed_safety');
    expect(r.reasons.map((x) => x.code)).toContain('psyllium_allergy');
  });
  it('reports medication interactions as not evaluated when no published rule exists', async () => {
    const r = await evaluateFiberSupplement('u1', { productId: 'prod-1' });
    expect(r.infos.map((x) => x.code)).toContain('medications_not_evaluated');
    expect(JSON.stringify(r)).not.toMatch(/safe to take|no interaction/i);
  });
  it('notes a same-day fiber supplement without calling it unsafe', async () => {
    store.suppLogs = [{ supplementName: 'Isabgol powder', fiberG: 3.5 }];
    const r = await evaluateFiberSupplement('u1', { productId: 'prod-1' });
    expect(r.infos.map((x) => x.code)).toContain('fiber_supplement_already_logged');
  });
});

describe('directions + audit trail', () => {
  beforeEach(() => { store.product = verifiedProduct(); });
  it('always carries safe-administration points and label warnings', async () => {
    const r = await evaluateFiberSupplement('u1', { productId: 'prod-1' });
    expect(r.directions.join(' ')).toMatch(/240 mL/);
    expect(r.directions.join(' ')).toMatch(/never take psyllium dry/i);
    expect(r.directions.join(' ')).toMatch(/bedtime/i);
    expect(r.directions.join(' ')).toMatch(/full glass of water/);
  });
  it('persists every check — suppressed outcomes included', async () => {
    store.product = verifiedProduct({ verificationStatus: 'UNVERIFIED' });
    const r = await evaluateFiberSupplement('u1', { productId: 'prod-1' });
    expect(store.checks.length).toBe(1);
    expect(store.checks[0].outcome).toBe('suppressed_unverified');
    expect(r.checkId).toBe('check-1');
  });
  it('never emits a dose or grams-per-teaspoon conversion', async () => {
    const r = await evaluateFiberSupplement('u1', { productId: 'prod-1' });
    expect(JSON.stringify(r)).not.toMatch(/take \d+ ?(g|gram|tsp|teaspoon|scoop)/i);
    expect(r.doseG).toBeUndefined();
  });
  it('confirmCheck marks eligible checks and refuses suppressed ones', async () => {
    const r = await evaluateFiberSupplement('u1', { productId: 'prod-1' });
    const confirmed = await confirmCheck('u1', r.checkId);
    expect(confirmed.userConfirmed).toBe(true);
    store.product = verifiedProduct({ verificationStatus: 'UNVERIFIED' });
    const r2 = await evaluateFiberSupplement('u1', { productId: 'prod-1' });
    await expect(confirmCheck('u1', r2.checkId)).rejects.toThrow(/suppressed/i);
  });
});
