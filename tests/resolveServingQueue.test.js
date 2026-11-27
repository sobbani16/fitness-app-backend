// pc-HUM-51 — resolution tooling discipline: only FDC-published measures,
// never derived, never fabricated; unverifiable stays unresolved.
jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { extractPortions, assessItem, run } = require('../scripts/resolve-serving-queue');
const { getPrisma } = require('../src/lib/prisma');

describe('extractPortions', () => {
  it('keeps only gram-weighted published measures', () => {
    const detail = { foodPortions: [
      { measureUnit: { name: 'cup' }, amount: 1, gramWeight: 137 },
      { measureUnit: { name: 'oz' }, amount: 1, gramWeight: null }, // dropped — no gram weight
      { measureUnit: null, amount: 1, gramWeight: 30 }, // dropped — no unit
    ] };
    const out = extractPortions(detail);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ unit: 'cup', gramWeight: 137 });
  });
  it('empty when FDC publishes no portions — never derived', () => {
    expect(extractPortions({ foodPortions: [] })).toEqual([]);
    expect(extractPortions({})).toEqual([]);
  });
});

describe('assessItem', () => {
  const ing = { id: 'i1', name: 'Cashew nuts, raw' };
  it('no-fdc-match stays unresolved with explicit non-FDC guidance', () => {
    const r = assessItem(ing, null, null);
    expect(r.status).toBe('no-fdc-match');
    expect(r.reason).toMatch(/never|IFCT|manufacturer|measurement/i);
  });
  it('no-published-portions: per-100g is never treated as a serving weight', () => {
    const r = assessItem(ing, { fdcId: 1 }, { dataType: 'Foundation', foodPortions: [] });
    expect(r.status).toBe('no-published-portions');
    expect(r.reason).toMatch(/never derived/);
  });
  it('evidence-found carries citation AND review-required gate — association ≠ verification', () => {
    const r = assessItem(ing, { fdcId: 2515374, description: 'Nuts, cashew nuts, raw' }, { dataType: 'Foundation', foodPortions: [{ measureUnit: { name: 'RACC' }, amount: 1, gramWeight: 30 }] });
    expect(r.status).toBe('evidence-found');
    expect(r.citation).toMatch(/USDA FDC Foundation fdcId 2515374/);
    expect(r.reviewRequired).toBe(true);
    expect(r.portions[0].gramWeight).toBe(30);
  });
});

describe('run() queue behavior', () => {
  it('prioritizes named-queue items and never writes the database', async () => {
    const prisma = {
      ingredient: { findMany: jest.fn().mockResolvedValue([
        { id: 'i1', name: 'Whole-wheat atta flour, dry' }, { id: 'i2', name: 'Unrelated x' },
      ]) },
    };
    getPrisma.mockReturnValue(prisma);
    const queryFn = jest.fn().mockResolvedValue({ ingredientId: 'i1', status: 'no-fdc-match' });
    const report = await run(prisma, 'k', { queryFn });
    expect(queryFn).toHaveBeenCalledTimes(1); // only the priority item, not 'Unrelated x'
    expect(report.tally['no-fdc-match']).toBe(1);
    expect(report.discipline).toMatch(/nothing applied/);
  });
});
