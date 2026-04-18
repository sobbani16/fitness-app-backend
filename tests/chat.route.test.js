const request = require('supertest');
const app = require('../src/app');

// Reset the in-module limiter between tests so counts don't leak.
beforeEach(() => {
  const chatRouter = require('../src/routes/chat');
  if (chatRouter.__limiter) chatRouter.__limiter.reset();
});

describe('POST /chat', () => {
  it('requires x-user-id', async () => {
    const res = await request(app).post('/chat').send({ message: 'hi' });
    expect(res.status).toBe(400);
  });

  it('requires message', async () => {
    const res = await request(app)
      .post('/chat')
      .set('x-user-id', 'u1')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns topical reply and quota', async () => {
    const res = await request(app)
      .post('/chat')
      .set('x-user-id', 'u1')
      .send({ message: 'How much protein should I eat?' });
    expect(res.status).toBe(200);
    expect(res.body.topic).toBe('protein');
    expect(res.body.answer.length).toBeGreaterThan(0);
    expect(res.body.quota.used).toBe(1);
    expect(res.body.quota.remaining).toBe(4);
  });

  it('blocks after 5 messages with 429', async () => {
    const agent = () => request(app).post('/chat').set('x-user-id', 'u2').send({ message: 'hi' });
    for (let i = 0; i < 5; i++) {
      const r = await agent();
      expect(r.status).toBe(200);
    }
    const blocked = await agent();
    expect(blocked.status).toBe(429);
    expect(blocked.body.remaining).toBe(0);
  });

  it('GET /chat/status reports quota', async () => {
    await request(app).post('/chat').set('x-user-id', 'u3').send({ message: 'calories?' });
    const res = await request(app).get('/chat/status').set('x-user-id', 'u3');
    expect(res.status).toBe(200);
    expect(res.body.used).toBe(1);
    expect(res.body.remaining).toBe(4);
  });
});
