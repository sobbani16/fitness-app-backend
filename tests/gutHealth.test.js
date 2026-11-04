jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const { getGutHealthSummary, logSymptom, setTolerance } = require('../src/services/gutHealth');

const day = n => new Date(Date.now() - n * 86400000);

function fakeDb({ logs = [], symptoms = [], tolerances = [] } = {}) {
  getPrisma.mockReturnValue({
    foodLog: { findMany: jest.fn(async () => logs) },
    gutSymptom: { findMany: jest.fn(async () => symptoms), create: jest.fn(async d => ({ id: 's1', ...d.data })) },
    foodTolerance: { findMany: jest.fn(async () => tolerances), create: jest.fn(async d => ({ id: 't1', ...d.data })) },
  });
}

describe('gut health intelligence', () => {
  test('no logs → completeness none, honest fiber null', async () => {
    fakeDb({});
    const r = await getGutHealthSummary('u1');
    expect(r.completeness).toBe('none');
    expect(r.fiber.avgPerDayG).toBeNull();
    expect(r.signals).toEqual([]);
  });

  test('low fiber across 5+ logs → low_fiber signal', async () => {
    fakeDb({ logs: Array.from({ length: 6 }, (_, i) => ({ fiberG: 5, ingredientId: `p${i}`, loggedAt: day(i) })) });
    const r = await getGutHealthSummary('u1');
    expect(r.fiber.avgPerDayG).toBe(5);
    expect(r.signals.find(s => s.key === 'low_fiber')).toBeTruthy();
    expect(r.plantVariety.distinctIngredients).toBe(6);
  });

  test('adequate fiber + variety → no signals', async () => {
    fakeDb({ logs: Array.from({ length: 12 }, (_, i) => ({ fiberG: 30, ingredientId: `plant${i}`, loggedAt: day(i % 7) })) });
    const r = await getGutHealthSummary('u1');
    expect(r.signals).toEqual([]);
  });

  test('symptom journal validates + stores; rejects unknown symptom', async () => {
    fakeDb({});
    await expect(logSymptom('u1', { symptom: 'nonsense' })).rejects.toMatchObject({ status: 400 });
    const s = await logSymptom('u1', { symptom: 'bloating', severity: 9 });
    expect(s.severity).toBe(5); // clamped
    await expect(logSymptom('u1', { symptom: 'gas', bristol: 9 })).rejects.toMatchObject({ status: 400 });
  });

  test('tolerance kinds exclude allergy (managed separately)', async () => {
    fakeDb({});
    await expect(setTolerance('u1', { foodName: 'milk', kind: 'allergy' })).rejects.toMatchObject({ status: 400 });
    const t = await setTolerance('u1', { foodName: 'onion', kind: 'suspected' });
    expect(t.kind).toBe('suspected');
  });
});
