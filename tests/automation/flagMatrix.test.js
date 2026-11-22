// automation J-H / SAFE-12 / SEC-08: feature flags must be enforced server-side.
// Flag OFF → 403 FEATURE_DISABLED for every sampled gated route. Flag OFF must
// also block API access even though the client could hide UI (J-H).
const request = require('supertest');
const app = require('../../src/app');
const flags = require('../../src/services/featureFlags/service');
const { envOverrideName } = require('../../src/config/featureRegistry');

// [flagKey, method, path] — route/flag mapping confirmed from requireFeature() usage.
const CASES = [
  ['supplements', 'get', '/supplements'],
  ['activity_safety_engine', 'get', '/activity-safety/profile'],
  ['ai_coach', 'post', '/chat'],
  ['weekly_meal_plans', 'get', '/weekly-plan/current'],
  ['trainer_copilot_enabled', 'get', '/trainer/copilot/clients'],
  ['trainer_workout_plans_enabled', 'get', '/me/workout-plans'],
  ['food_intelligence_enabled', 'get', '/food-intel/barcode/12345678'],
  ['nutrition_label_scanning', 'post', '/label-scanner/extract'],
  ['trainer_messaging_enabled', 'get', '/conversations'],
  ['video_search', 'get', '/videos/search?q=yoga'],
  ['gut_health', 'get', '/gut/summary'],
  ['mind_habits_enabled', 'get', '/mind/check-ins'],
  ['weekly_health_review_enabled', 'get', '/weekly-review'],
  ['trainer_paid_coaching_enabled', 'get', '/me/purchases'],
  ['trainer_scheduling_enabled', 'get', '/me/bookings'],
  ['trainer_nutrition_guidance_enabled', 'get', '/me/nutrition-plans'],
  ['trainer_form_feedback_enabled', 'get', '/form-checks/mine'],
  ['wearable_platform_enabled', 'get', '/health-sources/providers'],
  ['health_data_sources_enabled', 'post', '/health-sources/sources/sim/connect'],
  ['leo_progress_enabled', 'get', '/me/progress/unified'],
  ['stress_wellness', 'get', '/wellness/summary'],
];

// Structural dependsOn chains (featureRegistry.js): env overrides can NEVER
// satisfy a flag whose dependency is off — ON cases must enable ancestors too.
const DEPS = {
  trainer_paid_coaching_enabled: ['trainer_advanced_features_enabled'],
  health_data_sources_enabled: ['wearable_platform_enabled'],
};

describe('FLAG MATRIX — server-side enforcement', () => {
  const saved = {};
  const set = (key, v) => { const env = envOverrideName(key); if (!(env in saved)) saved[env] = process.env[env]; process.env[env] = v; };
  afterEach(() => {
    for (const [env, v] of Object.entries(saved)) { if (v === undefined) delete process.env[env]; else process.env[env] = v; delete saved[env]; }
    flags.resetCache();
  });

  test.each(CASES)('%s OFF → %s %s returns 403 FEATURE_DISABLED', async (key, method, path) => {
    set(key, 'false');
    flags.resetCache();
    const res = await request(app)[method](path).set('x-user-id', 'flag-matrix-user').send({});
    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe('FEATURE_DISABLED');
  });

  test.each(CASES)('%s ON → %s %s is NOT blocked by flag (status ≠ 403/FEATURE_DISABLED)', async (key, method, path) => {
    for (const dep of DEPS[key] || []) set(dep, 'true');
    set(key, 'true');
    flags.resetCache();
    const res = await request(app)[method](path).set('x-user-id', 'flag-matrix-user').send({});
    // Route may 200/400/404 on input/business grounds — but must not be flag-blocked.
    if (res.status === 403) expect(res.body?.error?.code).not.toBe('FEATURE_DISABLED');
  });

  test('dependsOn invariant: env override cannot force-enable child when parent is OFF', async () => {
    set('trainer_paid_coaching_enabled', 'true');
    set('trainer_advanced_features_enabled', 'false');
    flags.resetCache();
    const res = await request(app).get('/me/purchases').set('x-user-id', 'flag-matrix-user');
    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe('FEATURE_DISABLED');
  });

  test('medical-group flags are never auto-enabled by test setup', () => {
    const { FEATURES } = require('../../src/config/featureRegistry');
    const medical = Object.entries(FEATURES).filter(([, f]) => f.group === 'medical').map(([k]) => k);
    expect(medical.length).toBeGreaterThan(0);
    for (const k of medical) {
      // setup.js must not have auto-enabled these — they require explicit opt-in.
      expect(process.env[envOverrideName(k)]).not.toBe('true');
    }
  });
});
