// pc-HUM-51 — conversion-validity audit classification + compat-risk guard.
jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const { run, classifyServing } = require('../scripts/serving-coverage-audit');

describe('classifyServing', () => {
  const base = { id: 's1', ingredientId: 'i1', label: 'cup' };
  it('verified: estimated=false with traceable source', () => {
    expect(classifyServing({ ...base, grams: 240, estimated: false, sourceRecord: { fdcId: '123' } }).cls).toBe('verified');
  });
  it('estimated-traceable: estimated with documented measurement', () => {
    expect(classifyServing({ ...base, grams: 240, estimated: true, sourceRecord: { measurement: 'kitchen scale' } }).cls).toBe('estimated-traceable');
  });
  it('unsupported: no source provenance at all — never silently trusted', () => {
    expect(classifyServing({ ...base, grams: 240, estimated: false, sourceRecord: {} }).cls).toBe('unsupported');
    expect(classifyServing({ ...base, grams: 240, estimated: true, sourceRecord: null }).cls).toBe('unsupported');
  });
  it('implausible: non-finite/zero/over-5000 grams rejected regardless of source', () => {
    for (const grams of [0, -5, 5001, NaN, Infinity]) {
      expect(classifyServing({ ...base, grams, estimated: false, sourceRecord: { fdcId: '1' } }).cls).toBe('implausible');
    }
    expect(classifyServing({ ...base, grams: 5000, estimated: false, sourceRecord: { fdcId: '1' } }).cls).toBe('verified'); // boundary inclusive
  });
});

describe('run() audit math', () => {
  it('computes coverage + compat-risk against a mocked catalog', async () => {
    const prisma = {
      ingredient: { findMany: jest.fn().mockResolvedValue([{ id: 'i1', name: 'rice' }, { id: 'i2', name: 'atta' }]) },
      ingredientServing: { findMany: jest.fn().mockResolvedValue([
        { id: 's1', ingredientId: 'i1', label: 'cup', grams: 158, estimated: false, sourceRecord: { fdcId: '168' } },
        { id: 's2', ingredientId: 'i2', label: 'cup', grams: 120, estimated: true, sourceRecord: {} },
      ]) },
      foodLog: { findMany: jest.fn().mockResolvedValue([{ nutritionSnapshot: { servingId: 's1' } }, { nutritionSnapshot: { servingId: 'ghost-serving' } }]) },
    };
    getPrisma.mockReturnValue(prisma);
    const r = await run(prisma, {});
    expect(r.denominator.count).toBe(2);
    expect(r.coverage.withVerifiedServing.count).toBe(1); // only i1 has a verified serving
    expect(r.coverage.withAnyServing.count).toBe(2);
    expect(r.servingRows.unsupported).toBe(1); // atta cup without provenance counted, never hidden
    expect(r.compat.referencedServings).toBe(2);
    expect(r.compat.missingButReferenced).toBe(1); // ghost-serving referenced by history but missing — compat guard fires
    expect(r.compat.detail[0].servingId).toBe('ghost-serving');
  });
});
