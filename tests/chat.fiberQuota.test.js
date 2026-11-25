// Deterministic fiber answers cost no LLM call — they must not consume the
// daily chat quota, and a quota-exhausted user must still get fiber answers.

jest.mock('../src/services/aiService', () => require('./fixtures/aiService'));

const mockFlags = {};
jest.mock('../src/services/featureFlags/service', () => ({
  isEnabled: async (key) => key === 'ai_coach' ? true : Boolean(mockFlags[key]),
}));

const mockGroundFiberAnswer = jest.fn(async () => ({ handled: false }));
jest.mock('../src/services/fiber/assistant', () => ({
  groundFiberAnswer: (...args) => mockGroundFiberAnswer(...args),
}));

const request = require('supertest');
const app = require('../src/app');
const chatRouter = require('../src/routes/chat');

beforeEach(() => {
  Object.keys(mockFlags).forEach((k) => delete mockFlags[k]);
  mockGroundFiberAnswer.mockReset().mockResolvedValue({ handled: false });
  if (chatRouter.__limiter) chatRouter.__limiter.reset();
});

describe('POST /chat fiber quota', () => {
  it('a grounded fiber answer does not consume chat quota', async () => {
    mockFlags.fiber_ai_enabled = true;
    mockGroundFiberAnswer.mockResolvedValue({ handled: true, topic: 'fiber', answer: 'You logged 12 g fiber today.', source: 'fiber-engine' });

    const res = await request(app).post('/chat').set('x-user-id', 'u-fiber').send({ message: 'how much fiber today?' });
    expect(res.status).toBe(200);
    expect(res.body.answer).toContain('12 g');
    expect(res.body.quota.used).toBe(0);
    expect(res.body.quota.remaining).toBe(5);

    const status = await request(app).get('/chat/status').set('x-user-id', 'u-fiber');
    expect(status.body.used).toBe(0);
  });

  it('a fiber question still answers after the LLM quota is exhausted', async () => {
    mockFlags.fiber_ai_enabled = true;
    for (let i = 0; i < 5; i += 1) {
      const r = await request(app).post('/chat').set('x-user-id', 'u-full').send({ message: 'tell me about protein' });
      expect(r.status).toBe(200);
    }
    const blocked = await request(app).post('/chat').set('x-user-id', 'u-full').send({ message: 'protein again' });
    expect(blocked.status).toBe(429);

    mockGroundFiberAnswer.mockResolvedValue({ handled: true, topic: 'fiber', answer: 'Confirmed fiber is 8 g.', source: 'fiber-engine' });
    const fiber = await request(app).post('/chat').set('x-user-id', 'u-full').send({ message: 'how much fiber did I eat?' });
    expect(fiber.status).toBe(200);
    expect(fiber.body.answer).toContain('8 g');
    expect(fiber.body.quota.used).toBe(5);
  });

  it('flag off: fiber questions fall through to the normal quota path', async () => {
    const res = await request(app).post('/chat').set('x-user-id', 'u-noff').send({ message: 'how much fiber today?' });
    expect(res.status).toBe(200);
    expect(res.body.quota.used).toBe(1);
    expect(mockGroundFiberAnswer).not.toHaveBeenCalled();
  });
});
