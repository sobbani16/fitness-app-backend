jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const { logCheckIn, getWellnessSummary } = require('../src/services/wellness');

function fakeDb(rows = []) {
  getPrisma.mockReturnValue({
    wellnessCheckIn: {
      create: jest.fn(async d => ({ id: 'w1', ...d.data })),
      findMany: jest.fn(async () => rows),
    },
  });
}
const row = (s, m, f) => ({ stress: s, mood: m, fatigue: f, loggedAt: new Date() });

test('check-in validates 1–5 range', async () => {
  fakeDb();
  await expect(logCheckIn('u1', { stress: 0, mood: 3, fatigue: 3 })).rejects.toMatchObject({ status: 400 });
  const r = await logCheckIn('u1', { stress: 4, mood: 2, fatigue: 5 });
  expect(r.stress).toBe(4);
});

test('empty → nulls, no signals', async () => {
  fakeDb([]);
  const r = await getWellnessSummary('u1');
  expect(r.avgStress).toBeNull();
  expect(r.signals).toEqual([]);
});

test('sustained high stress + low mood → signals with evidence', async () => {
  fakeDb([row(5, 2, 4), row(4, 1, 5), row(4, 2, 4)]);
  const r = await getWellnessSummary('u1');
  expect(r.signals.find(s => s.key === 'high_stress')).toBeTruthy();
  expect(r.signals.find(s => s.key === 'low_mood')).toBeTruthy();
  expect(r.note).toMatch(/not a clinical/i);
});
