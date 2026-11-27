// HUM-P6-004 — backend authoritative portion cap on food-log writes.
// A food log is a consumed portion, never a bulk batch; the cap is 5000 g.
// Rejected input must never reach prisma — validation precedes persistence.
const mockPrisma = {
  foodLog: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
  ingredient: { findUnique: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
const request = require('supertest');
const app = require('../src/app');
const A = 'user-alice';

beforeEach(() => { jest.clearAllMocks(); mockPrisma.foodLog.findUnique.mockResolvedValue(null); });

const post = (body) => request(app).post('/food-logs').set('x-user-id', A).send({
  foodName: 'cap probe', calories: 100, proteinG: 5, carbsG: 10, fatG: 2, fiberG: 1, mealType: 'meal', ...body,
});

describe('boundary matrix — quantityG', () => {
  test.each([
    ['null', null, 'rejected-or-defaulted'],
    ['zero', 0, 'passes-validation'],        // zero/unknown weight is contract-allowed
    ['4999', 4999, 'passes-validation'],
    ['5000 exact cap', 5000, 'passes-validation'],
    ['5001 over cap', 5001, 400],
    ['huge 99999', 99999, 400],
    ['NaN', NaN, 400],
    ['negative', -5, 400],
    ['sci-notation 5e3', 5e3, 'passes-validation'],
    ['sci-notation 5.001e3', 5.001e3, 400],
    ['Infinity', Infinity, 400],
  ])('%s', async (_l, grams, expected) => {
    mockPrisma.foodLog.create.mockResolvedValue({ id: 'x' });
    const res = await post({ id: `cap-${_l.replace(/\W/g, '')}-${Date.now()}`, quantityG: grams });
    if (expected === 400) {
      expect(res.status).toBe(400);
      expect(mockPrisma.foodLog.create).not.toHaveBeenCalled(); // never persists
    } else if (expected === 'passes-validation') {
      expect(res.status).not.toBe(400);
    }
  });
});

describe('rejection semantics', () => {
  it('over-cap error names the policy and never touches the database', async () => {
    const res = await post({ id: 'cap-over-1', quantityG: 6000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/5000/);
    expect(mockPrisma.foodLog.create).not.toHaveBeenCalled();
    expect(mockPrisma.foodLog.findFirst).not.toHaveBeenCalledWith(expect.objectContaining({ select: expect.anything() }));
  });
  it('cap applies to retry-stable ids too — no persistence path bypasses it', async () => {
    const res = await post({ id: 'cap-retry-stable', quantityG: 5001 });
    expect(res.status).toBe(400);
    expect(mockPrisma.foodLog.create).not.toHaveBeenCalled();
  });
});
