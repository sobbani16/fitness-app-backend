const request = require('supertest');
const app = require('../src/app');

describe('GET /recommendations', () => {
  it('returns a recommendation with defaults', async () => {
    const res = await request(app).get('/recommendations');
    expect(res.status).toBe(200);
    expect(res.body.recommendation).toBeDefined();
    expect(typeof res.body.recommendation.type).toBe('string');
    expect(res.body.balance).toBeDefined();
    expect(typeof res.body.balance.surplus).toBe('number');
  });

  it('reflects query params (surplus -> workout)', async () => {
    const res = await request(app).get('/recommendations').query({
      sex: 'male', weightKg: 80, heightCm: 180, age: 30,
      activityLevel: 'sedentary', goal: 'maintain',
      caloriesIn: 3000, caloriesBurnedExercise: 0,
    });
    expect(res.status).toBe(200);
    expect(res.body.recommendation.type).toBe('workout');
    expect(res.body.balance.surplus).toBeGreaterThan(0);
  });

  it('applies weather (hot moves outdoor -> indoor)', async () => {
    const res = await request(app).get('/recommendations').query({
      caloriesIn: 2500, goal: 'maintain', weather: 'hot',
    });
    expect(res.status).toBe(200);
    // Small surplus default -> 15 min walk (outdoor) -> becomes indoor when hot
    if (res.body.recommendation.durationMin === 15) {
      expect(res.body.recommendation.location).toBe('indoor');
    }
  });
});
