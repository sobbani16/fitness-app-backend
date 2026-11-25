// §5: retries deduplicated while intentional repeated meals still work.
// POST /food-logs carries a stable client id: re-delivery is a no-op replay;
// different ids for the same food/time are legitimate repeats and both persist.
const request = require('supertest');

const rows = [];
const mockPrisma = new Proxy({}, {
  get: (t, model) => new Proxy({}, {
    get: (t2, fn) => {
      if (model === 'foodLog') {
        if (fn === 'findUnique') return async ({ where }) => rows.find(r => r.id === where.id) || null;
        if (fn === 'findFirst') return async () => rows[0] || null;
        if (fn === 'create') return async ({ data }) => { rows.push({ id: data.id, ...data }); return rows[rows.length - 1]; };
        if (fn === 'findMany') return async () => rows;
      }
      return async () => null;
    },
  }),
});
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
const app = require('../src/app');
const H = { 'x-user-id': 'u-dedup-1' };

beforeEach(() => { rows.length = 0; });

describe('POST /food-logs idempotency', () => {
  const body = (id) => ({ id, foodName: 'Oatmeal bowl', mealType: 'breakfast', quantityG: 150, calories: 300, proteinG: 10, carbsG: 50, fatG: 5 });

  it('a retried create (same id) does not duplicate the row', async () => {
    const r1 = await request(app).post('/food-logs').set(H).send(body('meal-1'));
    expect(r1.status).toBe(201);
    const r2 = await request(app).post('/food-logs').set(H).send(body('meal-1'));
    expect(r2.status).toBe(200);
    expect(rows.filter(r => r.id === 'meal-1')).toHaveLength(1);
  });

  it('intentional repeated meals (different ids) both persist', async () => {
    await request(app).post('/food-logs').set(H).send(body('meal-1'));
    const r2 = await request(app).post('/food-logs').set(H).send(body('meal-2'));
    expect(r2.status).toBe(201);
    expect(rows).toHaveLength(2);
    // advisory duplicateWarning may fire — it never blocks legitimate repeats
    expect(rows.map(r => r.id).sort()).toEqual(['meal-1', 'meal-2']);
  });

  it('same id from another user → 409 conflict, no overwrite', async () => {
    await request(app).post('/food-logs').set(H).send(body('meal-1'));
    const r = await request(app).post('/food-logs').set('x-user-id', 'attacker').send({ ...body('meal-1'), calories: 1 });
    expect(r.status).toBe(409);
    expect(rows.find(x => x.id === 'meal-1').calories).toBe(300);
  });

  it('missing or invalid stable id → 400', async () => {
    const r = await request(app).post('/food-logs').set(H).send({ foodName: 'x', quantityG: 10, calories: 10, proteinG: 1, carbsG: 1, fatG: 1 });
    expect(r.status).toBe(400);
  });
});
