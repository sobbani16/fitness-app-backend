const request = require('supertest');
const app = require('../src/app');

describe('POST /summary/daily', () => {
  it('returns full summary for a profile with meals', async () => {
    const res = await request(app)
      .post('/summary/daily')
      .send({
        profile: {
          sex: 'male', weightKg: 80, heightCm: 180, age: 30,
          activityLevel: 'sedentary', goal: 'maintain',
        },
        meals: [
          { name: 'Oatmeal', calories: 300 },
          { name: 'Pizza', calories: 600 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.balance.caloriesIn).toBe(900);
    expect(res.body.recommendation).toBeDefined();
    expect(typeof res.body.insight).toBe('string');
  });

  it('400 without profile', async () => {
    const res = await request(app).post('/summary/daily').send({});
    expect(res.status).toBe(400);
  });
});
