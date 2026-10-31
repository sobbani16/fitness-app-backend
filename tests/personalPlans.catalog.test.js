const express = require('express');
const request = require('supertest');

const app = express();
app.use(express.json());
app.use('/personal-plans', require('../src/routes/personalPlans'));

const get = q => request(app).get(`/personal-plans/catalog${q}`).set('x-user-id', 'u-1');

describe('GET /personal-plans/catalog', () => {
  it('returns catalog exercises with suitability classifications', async () => {
    const res = await get('');
    expect(res.status).toBe(200);
    expect(res.body.exercises.length).toBeGreaterThan(10);
    const bench = res.body.exercises.find(e => e.id === 'bench-press');
    expect(bench).toMatchObject({ name: 'Bench Press', pattern: 'push-horizontal' });
    expect(['suitable', 'adapt', 'needs-info', 'review']).toContain(bench.suitability.status);
  });

  it('adapts exercises that conflict with reported limitations', async () => {
    const res = await get('?limitations=seated-only&equipment=machine');
    const squat = res.body.exercises.find(e => e.id === 'squat');
    expect(squat.suitability.status).toBe('adapt');
    const lat = res.body.exercises.find(e => e.id === 'lat-pulldown');
    expect(lat.suitability.status).toBe('suitable');
  });

  it('flags advanced moves for beginners as adapt, not blocked', async () => {
    const res = await get('?experience=beginner');
    const pullup = res.body.exercises.find(e => e.id === 'pull-up');
    expect(pullup.suitability.status).toBe('adapt');
    expect(pullup.suitability.alternatives.length).toBeGreaterThan(0);
  });

  it('requires a user id', async () => {
    const res = await request(app).get('/personal-plans/catalog');
    expect(res.status).toBe(400);
  });
});
