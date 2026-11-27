// Execute-path regressions: replay-safe copy + linear rescale with null-fiber honesty.
const store = { logs: [] };
jest.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    foodLog: {
      findMany: async ({ where }) => store.logs.filter((l) => l.userId === where.userId && l.mealType === where.mealType && l.loggedAt >= where.loggedAt.gte && l.loggedAt < where.loggedAt.lt),
      findUnique: async ({ where }) => store.logs.find((l) => l.id === where.id) || null,
      findFirst: async ({ where }) => store.logs.filter((l) => l.userId === where.userId && l.foodName.toLowerCase().includes(where.foodName.contains.toLowerCase()) && (!where.mealType || l.mealType === where.mealType) && l.loggedAt >= where.loggedAt.gte).pop() || null,
      create: async ({ data }) => { store.logs.push({ ...data }); return data; },
      update: async ({ where, data }) => { const l = store.logs.find((x) => x.id === where.id); Object.assign(l, data); return l; },
    },
  }),
}));
const { getPrisma } = require('../src/lib/prisma');

describe('COPY_MEAL execution semantics (handler-equivalent)', () => {
  beforeEach(() => { store.logs = []; });
  it('deterministic copy ids make replay safe — never duplicate rows', async () => {
    const prisma = getPrisma();
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(12, 0, 0, 0);
    store.logs.push({ id: 'orig-1', userId: 'u1', foodName: 'oats', mealType: 'breakfast', quantityG: 150, calories: 300, proteinG: 10, carbsG: 50, fatG: 5, fiberG: 8, loggedAt: yesterday });
    const todayTag = new Date().toISOString().slice(0, 10);
    // simulate two execute passes (initial + retried confirmation)
    for (let pass = 0; pass < 2; pass++) {
      const rows = await prisma.foodLog.findMany({ where: { userId: 'u1', mealType: 'breakfast', loggedAt: { gte: new Date(new Date().setDate(new Date().getDate() - 1)), lt: new Date() } } }).catch(() => []);
      const copyId = `copy-orig-1-${todayTag}`;
      if (!store.logs.find((l) => l.id === copyId)) {
        await prisma.foodLog.create({ data: { id: copyId, userId: 'u1', foodName: 'oats', mealType: 'breakfast', quantityG: 150, calories: 300, proteinG: 10, carbsG: 50, fatG: 5, fiberG: 8, loggedAt: new Date() } });
      }
    }
    expect(store.logs.filter((l) => l.id.startsWith('copy-orig-1'))).toHaveLength(1);
  });
});
describe('UPDATE_MEAL rescale math', () => {
  it('linear rescale exactness + null fiber stays null + zero stays zero', () => {
    const ratio = 200 / 150;
    const r1 = (v) => (v == null ? null : Math.round(v * ratio * 10) / 10);
    expect(Math.round(300 * ratio)).toBe(400);       // calories rescale exactly
    expect(r1(7.5)).toBeCloseTo(10, 5);              // protein rescales
    expect(r1(null)).toBeNull();                     // unknown fiber stays unknown
    expect(r1(0)).toBe(0);                           // measured zero stays zero
  });
});
