// HTTP-level flag enforcement: /config/features shape + requireFeature 403s.
const request = require('supertest');
const app = require('../src/app');
const flags = require('../src/services/featureFlags/service');
const { envOverrideName } = require('../src/config/featureRegistry');

const setEnv = (key, value) => { process.env[envOverrideName(key)] = value; flags.resetCache(); };
const restore = (key) => { setEnv(key, 'true'); };

afterEach(() => {
  delete process.env.AI_EMERGENCY_SHUTDOWN;
  restore('ai_coach'); restore('food_photo_scanning'); restore('trainer_dashboard');
  restore('supplements'); restore('video_search'); restore('weekly_meal_plans');
  restore('apple_health_sync'); restore('android_health_sync');
});

describe('GET /config/features', () => {
  test('returns versioned per-user config with private cache headers', async () => {
    const res = await request(app).get('/config/features').set('x-user-id','u1');
    expect(res.status).toBe(200);
    expect(res.body.configVersion).toBeDefined();
    expect(res.body.refreshAfterSeconds).toBe(60);
    expect(res.headers['cache-control']).toMatch(/private/);
    expect(res.body.features.manualFoodLogging).toBe(true);
    expect(res.body.features.aiCoach).toBe(true); // setup.js enables all
    // never leaks provider internals
    expect(JSON.stringify(res.body)).not.toMatch(/posthog|POSTHOG|phc_/i);
  });
});

describe('requireFeature enforcement', () => {
  test('disabled ai_coach => 403 FEATURE_DISABLED on /chat and /chat/status', async () => {
    setEnv('ai_coach', 'false');
    for (const path of ['/chat/status']) {
      const res = await request(app).get(path).set('x-user-id','u1');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FEATURE_DISABLED');
    }
    const res = await request(app).post('/chat').set('x-user-id','u1').send({ message: 'hi' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });

  test('disabled food_photo_scanning => /meals/detect 403 before quota work', async () => {
    setEnv('food_photo_scanning', 'false');
    const res = await request(app).post('/meals/detect').set('x-user-id','u1').send({ imageDataUrl: 'data:image/png;base64,AAAA' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });

  test('AI_EMERGENCY_SHUTDOWN blocks ai endpoints even when flags enabled', async () => {
    process.env.AI_EMERGENCY_SHUTDOWN = 'true';
    flags.resetCache();
    const res = await request(app).post('/chat').set('x-user-id','u1').send({ message: 'hi' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
    // manual logging untouched
    expect((await request(app).get('/config/features').set('x-user-id','u1')).body.features.manualFoodLogging).toBe(true);
  });

  test('health-data requires either health sync flag', async () => {
    setEnv('apple_health_sync', 'false'); setEnv('android_health_sync', 'false');
    const res = await request(app).get('/health-data/summary').set('x-user-id','u1');
    expect(res.status).toBe(403);
    setEnv('apple_health_sync', 'true');
    flags.resetCache();
    const res2 = await request(app).get('/health-data/summary').set('x-user-id','u1');
    expect(res2.status).not.toBe(403);
  });

  test('trainer suite gated by trainer_dashboard', async () => {
    setEnv('trainer_dashboard', 'false');
    const res = await request(app).get('/trainers').set('x-user-id','u1');
    expect(res.status).toBe(403);
  });
});
