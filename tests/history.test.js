const { buildHistory } = require('../src/services/summaryService');
const request = require('supertest');
const app = require('../src/app');

const profile = {
  sex: 'male', weightKg: 80, heightCm: 180, age: 30,
  activityLevel: 'sedentary', goal: 'maintain',
};

describe('buildHistory', () => {
  it('computes per-day status and streaks', () => {
    const r = buildHistory({
      profile,
      days: [
        { date: '2025-04-16', caloriesIn: 2500, mealCount: 3 },
        { date: '2025-04-17', caloriesIn: 2500, mealCount: 3 },
        { date: '2025-04-18', caloriesIn: 2500, mealCount: 3 },
      ],
    });
    expect(r.entries).toHaveLength(3);
    expect(r.entries[2].status).toBeDefined();
    expect(r.streaks.logged).toBe(3);
  });

  it('breaks streak on an unlogged day', () => {
    const r = buildHistory({
      profile,
      days: [
        { date: '2025-04-16', caloriesIn: 2500, mealCount: 3 },
        { date: '2025-04-17', caloriesIn: 0,    mealCount: 0 },
        { date: '2025-04-18', caloriesIn: 2500, mealCount: 3 },
      ],
    });
    expect(r.streaks.logged).toBe(1);
  });

  it('sorts days ascending', () => {
    const r = buildHistory({
      profile,
      days: [
        { date: '2025-04-18', caloriesIn: 2000, mealCount: 2 },
        { date: '2025-04-16', caloriesIn: 2000, mealCount: 2 },
        { date: '2025-04-17', caloriesIn: 2000, mealCount: 2 },
      ],
    });
    expect(r.entries.map((e) => e.date)).toEqual(['2025-04-16', '2025-04-17', '2025-04-18']);
  });

  it('requires profile', () => {
    expect(() => buildHistory({ days: [] })).toThrow();
  });
});

describe('POST /summary/history', () => {
  it('returns 200 with entries and streaks', async () => {
    const res = await request(app).post('/summary/history').send({
      profile,
      days: [{ date: '2025-04-18', caloriesIn: 2500, mealCount: 3 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.streaks).toBeDefined();
  });

  it('400 without profile', async () => {
    const res = await request(app).post('/summary/history').send({ days: [] });
    expect(res.status).toBe(400);
  });
});
