// Voice kill-switch completeness (pc-HUM-97): the write path must close when
// voice flags are off — gating only transcribe/interpret leaves the mutation
// channel open, which is not a kill switch. Regression guard for the gate on
// /voice/commands/execute.
const request = require('supertest');
const flags = require('../src/services/featureFlags/service');
const { envOverrideName } = require('../src/config/featureRegistry');

process.env.AUTH_TEST_BYPASS = 'true';
const app = require('../src/app');
const H = { 'x-user-id': 'kill-switch-test-u' };

function voiceFlagsOff() {
  delete process.env[envOverrideName('voice_food_logging')];
  delete process.env[envOverrideName('voice_exercise_logging')];
  flags.resetCache();
}
function voiceFlagsOn() {
  process.env[envOverrideName('voice_food_logging')] = 'true';
  process.env[envOverrideName('voice_exercise_logging')] = 'true';
  flags.resetCache();
}

describe('voice kill switch closes the write path', () => {
  afterEach(voiceFlagsOn);   // restore auto-enabled state for other suites

  it('flags OFF → execute refused 403 FEATURE_DISABLED before any persistence', async () => {
    voiceFlagsOff();
    const res = await request(app).post('/voice/commands/execute').set(H)
      .send({ commandId: 'vc-killtest1', transcript: 'x', actions: [{ intent: 'LOG_WATER', entities: { amountMl: 1 }, status: 'ready' }] });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FEATURE_DISABLED');
  });

  it('flags ON → gate passes and the handler runs (validation proof, no DB needed)', async () => {
    voiceFlagsOn();
    // empty actions array trips the handler's own validation — reaching that
    // 400 is proof the request passed THROUGH the gate into the handler.
    const res = await request(app).post('/voice/commands/execute').set(H)
      .send({ commandId: 'vc-killtest2', transcript: 'x', actions: [] });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).not.toBe('FEATURE_DISABLED');
  });

  it('flags OFF → transcribe still refused (pre-existing gate, no regression)', async () => {
    voiceFlagsOff();
    const res = await request(app).post('/voice/transcribe').set(H).send({ audio: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FEATURE_DISABLED');
  });

  it('undo remains reachable with flags OFF — remediation survives the kill switch', async () => {
    voiceFlagsOff();
    // nonexistent command → handler-level response (404/400), never FEATURE_DISABLED
    const res = await request(app).post('/voice/commands/undo').set(H).send({ commandId: 'vc-nonexistent-zz' });
    expect(res.body.error?.code).not.toBe('FEATURE_DISABLED');
  });
});
