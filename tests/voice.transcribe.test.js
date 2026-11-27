// pc-HUM-74 — /voice/transcribe must pass through the shared AI gates
// (emergency shutdown + per-user quota) like every other paid provider call.

const mockTranscribe = jest.fn(async () => ({ text: 'two eggs' }));
jest.mock('openai', () => ({ OpenAI: jest.fn(() => ({ audio: { transcriptions: { create: (...a) => mockTranscribe(...a) } } })) }));

const mockFlags = {};
jest.mock('../src/services/featureFlags/service', () => ({
  isEnabled: async (key) => (key === 'voice_food_logging' || key === 'voice_exercise_logging') ? true : Boolean(mockFlags[key]),
  isAiShutdown: async () => Boolean(mockFlags.__ai_shutdown__),
  evaluateAll: async () => ({}),
}));

const request = require('supertest');
const express = require('express');

const app = express();
app.use(express.json({ limit: '6mb' }));
app.use((req, _res, next) => { req.userId = req.headers['x-user-id'] || null; next(); });
app.use('/voice', require('../src/routes/voice'));
app.use((err, _req, res, _next) => res.status(err.status || 500).json(err.body || { error: err.message }));

const clip = Buffer.from('RIFFfakeaudio').toString('base64');
const post = (uid = 'u-t') => request(app).post('/voice/transcribe').set('x-user-id', uid).send({ audio: clip });

beforeEach(() => {
  Object.keys(mockFlags).forEach((k) => delete mockFlags[k]);
  mockTranscribe.mockClear();
  process.env.OPENAI_API_KEY = 'sk-test';
  // reset the provider's in-process quota map between tests
  jest.resetModules && (require('../src/services/aiProvider').__usage = new Map());
});

describe('POST /voice/transcribe gates', () => {
  it('emergency AI shutdown blocks transcription (403 FEATURE_DISABLED)', async () => {
    mockFlags.__ai_shutdown__ = true;
    const res = await post();
    expect(res.status).toBe(403);
    expect(res.body.code || res.body.error?.code).toBe('FEATURE_DISABLED');
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  it('per-user daily call cap applies to transcription', async () => {
    // DAILY_CALL_CAP default 20 — 21st call must 429 before reaching provider
    let last;
    for (let i = 0; i < 21; i += 1) last = await post('u-cap');
    expect(last.status).toBe(429);
    expect(mockTranscribe.mock.calls.length).toBe(20);
  });

  it('valid clip transcribes and returns only the transcript', async () => {
    const res = await post('u-ok');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ transcript: 'two eggs' });
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
  });

  it('missing audio → 400; oversized clip → 413', async () => {
    const res400 = await request(app).post('/voice/transcribe').set('x-user-id', 'u1').send({});
    expect(res400.status).toBe(400);
    const big = Buffer.alloc(4_500_000).toString('base64');
    const res413 = await request(app).post('/voice/transcribe').set('x-user-id', 'u1').send({ audio: big });
    expect(res413.status).toBe(413);
  });
});
