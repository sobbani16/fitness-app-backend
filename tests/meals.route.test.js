const request = require('supertest');
const app = require('../src/app');

describe('POST /meals/analyze', () => {
  it('returns analysis for a known description', async () => {
    const res = await request(app)
      .post('/meals/analyze')
      .send({ description: 'grilled chicken with rice' });
    expect(res.status).toBe(200);
    expect(res.body.calories).toBeGreaterThan(0);
    expect(typeof res.body.name).toBe('string');
    expect(res.body.macros).toBeDefined();
  });

  it('uses meal type fallback when description missing', async () => {
    const res = await request(app)
      .post('/meals/analyze')
      .send({ mealType: 'snack' });
    expect(res.status).toBe(200);
    expect(res.body.calories).toBe(200);
  });

  it('accepts empty body', async () => {
    const res = await request(app).post('/meals/analyze').send({});
    expect(res.status).toBe(200);
    expect(res.body.calories).toBeGreaterThan(0);
  });
});
