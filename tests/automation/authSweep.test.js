// automation SEC-01/AUTH-05/AUTH-10/11: unauthenticated requests must be rejected
// across the protected surface — and a spoofed x-user-id header alone must not
// authenticate. Runs with AUTH_TEST_BYPASS off so the real middleware path runs.
const request = require('supertest');
const app = require('../../src/app');

// Representative protected endpoints spanning every route file (GET where
// possible; params filled with syntactically-valid fakes).
const PROTECTED = [
  '/recommendations', '/recommendations/suggest', '/recommendations/nutrition-status',
  '/summary/daily', '/chat/status', '/weather', '/weather/environment',
  '/activity-safety/profile', '/activity-safety/recommendation', '/activity-safety/symptoms',
  '/exercises', '/exercises/library/muscles', '/exercises/library/search?q=press',
  '/recipes/search?q=rice', '/recipes/abc', '/supplements', '/supplements/mine',
  '/supplements/safety', '/today/actions', '/today/recovery', '/gut/summary',
  '/habits', '/wellness/summary', '/coaching/x', '/trainer/copilot/clients',
  '/form-checks/mine', '/weekly-review', '/mind/check-ins', '/mind/tracks',
  '/food-intel/barcode/123', '/food-intel/favorites', '/health-sources/providers',
  '/ingredients/search?q=rice', '/ingredients/selections', '/foods/search?q=rice',
  '/grocery', '/safety/context', '/safety/recommend', '/safety/coaching',
  '/trainers', '/trainers/me/clients', '/trainer-requests', '/workout-plans',
  '/nutritionists', '/meal-plans', '/coach-notes', '/admin/users', '/admin/analytics',
  '/admin/feature-flags', '/audit-logs', '/me/roles', '/macro-score', '/macro-score/goals',
  '/health-score', '/weekly-plan/current', '/food-logs', '/daily-stats/steps',
  '/daily-stats/water', '/label-scanner/history', '/daily-progress/today',
  '/progress-coach/streak', '/reminders/inbox', '/reminders/preferences',
  '/videos/search?q=yoga', '/health-data/summary', '/personal-plans',
  '/conversations', '/conversations/unread-count', '/me/push-tokens',
  '/trainer/workout-plans', '/me/workout-plans', '/trainer/nutrition-plans',
  '/me/nutrition-plans', '/trainer/schedule/bookings', '/me/bookings',
  '/me/notifications', '/check-ins/mine', '/energy/summary', '/meal-suggest',
  '/communication/privacy', '/academy/articles', '/editorial/panel/stats',
  '/me/progress', '/me/progress/unified', '/me/profile', '/me/account/retention',
  '/me/entitlements', '/me/purchases', '/trainer/commerce/packages',
  '/config/features', '/super-admin/ingredient-evidence', '/super-admin/nutrition-profiles',
];

describe('AUTH SWEEP — unauthenticated access', () => {
  const saved = process.env.AUTH_TEST_BYPASS;
  beforeAll(() => { process.env.AUTH_TEST_BYPASS = 'false'; });
  afterAll(() => { process.env.AUTH_TEST_BYPASS = saved; });

  test.each(PROTECTED)('GET %s → 401 without token', async (p) => {
    const res = await request(app).get(p);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  test.each([
    ['post', '/food-logs'], ['post', '/supplements/mine'], ['post', '/chat'],
    ['post', '/voice/interpret'], ['post', '/reminders/tick'], ['post', '/admin/clinical-rules/transition'],
    ['put', '/me/profile'], ['delete', '/food-logs/x'],
  ])('%s %s → 401 without token', async (m, p) => {
    const res = await request(app)[m](p).send({});
    expect(res.status).toBe(401);
  });

  test('spoofed x-user-id header without Bearer token → 401', async () => {
    const res = await request(app).get('/food-logs').set('x-user-id', 'victim-user');
    expect(res.status).toBe(401);
  });

  test('malformed Bearer token → 401', async () => {
    const res = await request(app).get('/food-logs').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});

describe('public endpoints stay reachable', () => {
  test('GET /health → 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
  test('GET /health/ready → 200 or 503 (never 401)', async () => {
    const res = await request(app).get('/health/ready');
    expect([200, 503]).toContain(res.status);
  });
});
