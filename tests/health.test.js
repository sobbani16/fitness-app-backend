const request = require('supertest');
const app = require('../src/app');

describe('GET /health', () => {
  it('returns status ok with ISO time', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.time).toBe('string');
    // Rough ISO check
    expect(new Date(res.body.time).toString()).not.toBe('Invalid Date');
  });
});
