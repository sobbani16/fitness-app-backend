// HUM-90: /leo/transcribe contract skeleton — validation + honest 501.
const request = require('supertest');
const express = require('express');

jest.mock('../src/services/featureFlags/service', () => ({ isEnabled: async () => true }));
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => ({}) }));

const loadApp = () => {
  const router = require('../src/routes/leo');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = req.headers['x-user-id'] || null; next(); });
  app.use('/leo', router);
  // mirror the production error serialization so tests assert real shapes
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    res.status(status).json({ error: err.message, correlationId: null });
  });
  return app;
};
const app = loadApp();
const H = { 'x-user-id': 'u1' };

describe('POST /leo/transcribe contract', () => {
  it('rejects invalid audio format — 400', async () => {
    const r = await request(app).post('/leo/transcribe').set(H).send({ format: 'exe', durationMs: 5000, audioRef: 'store/abc123' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/format/);
  });

  it('rejects unbounded durations — voice captures cap at 2 minutes', async () => {
    const r = await request(app).post('/leo/transcribe').set(H).send({ format: 'm4a', durationMs: 300000, audioRef: 'store/abc123' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/durationMs/);
  });

  it('rejects inline/missing audio — audioRef must be an opaque reference', async () => {
    const r = await request(app).post('/leo/transcribe').set(H).send({ format: 'm4a', durationMs: 5000 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/audioRef/);
  });

  it('valid payload → 501 naming the exact blocker until the provider decision lands', async () => {
    delete process.env.LEO_STT_PROVIDER;
    const r = await request(app).post('/leo/transcribe').set(H).send({ format: 'm4a', durationMs: 5000, audioRef: 'store/abc123' });
    expect(r.status).toBe(501);
    expect(r.body.error).toBe('stt_provider_not_configured');
    expect(r.body.detail).toMatch(/needs_human/);
  });

  it('requires authentication', async () => {
    const r = await request(app).post('/leo/transcribe').send({ format: 'm4a', durationMs: 5000, audioRef: 'store/abc123' });
    expect(r.status).toBe(401);
  });
});
