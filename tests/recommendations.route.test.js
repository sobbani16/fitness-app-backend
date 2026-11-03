const request = require('supertest');
const app = require('../src/app');

describe('GET /recommendations', () => {
  it('returns a recommendation with defaults — intake not invented', async () => {
    const res = await request(app).get('/recommendations');
    expect(res.status).toBe(200);
    expect(res.body.recommendation).toBeDefined();
    expect(res.body.intakeProvided).toBe(false);
    // With no intake provided the nudge is about logging, not eating less.
    expect(res.body.recommendation.type).toBe('log');
    expect(res.body.balance).toBeDefined();
    expect(typeof res.body.balance.surplus).toBe('number');
  });

  it('reflects query params (above target -> pacing review, never offset workout)', async () => {
    const res = await request(app).get('/recommendations').query({
      sex: 'male', weightKg: 80, heightCm: 180, age: 30,
      activityLevel: 'sedentary', goal: 'maintain',
      caloriesIn: 3000, caloriesBurnedExercise: 0,
    });
    expect(res.status).toBe(200);
    expect(res.body.recommendation.type).toBe('review');
    expect(res.body.recommendation.reason).not.toMatch(/offset|cancel|earn/i);
    expect(res.body.balance.surplus).toBeGreaterThan(0);
  });

  it('exercise calories are never subtracted again from intake', async () => {
    const [a, b] = await Promise.all([
      request(app).get('/recommendations').query({ caloriesIn: 2000, caloriesBurnedExercise: 600, goal: 'maintain' }),
      request(app).get('/recommendations').query({ caloriesIn: 2000, caloriesBurnedExercise: 0, goal: 'maintain' }),
    ]);
    expect(a.body.balance.surplus).toBe(b.body.balance.surplus);
  });
});
