// §15.4 security-event boundary — asserts what actually reaches the sink.
// Fixture values are synthetic; assertions use boolean containment checks so
// a failing assertion can never print the fixtures themselves.
const { emitSecurityEvent, emitLoginResult } = require('../src/services/securityEvents');

function capture() {
  const lines = [];
  return { lines, logger: { info: l => lines.push(l), warn: l => lines.push(l) } };
}
// Synthetic fixtures — never real values.
const PW = 'synthetic-pw-fixture-9x';
const OTP = '482916';
const TOK = 'synthetic-token-fixture-cog';
const KEY = 'synthetic-key-fixture-sk';
const HEALTH = 'synthetic-health-record-fixture';
const PROMPT = 'sensitive-ai-prompt-fixture';
const CARD = '4242424242424242';

test('valid login success emits flat JSON with allowlist keys only', () => {
  const { lines } = capture();
  const c = capture();
  emitLoginResult({ outcome: 'success', userId: 'user-abc12345', correlationId: 'corr-test-1234' }, c.logger);
  expect(c.lines).toHaveLength(1);
  const parsed = JSON.parse(c.lines[0]);
  expect(parsed.event).toBe('security');
  expect(parsed.type).toBe('auth.login');
  expect(parsed.severity).toBe('info');
  expect(parsed.result).toBe('success');
  expect(parsed.actorRef).toBe('user-abc12345');
  expect(parsed.resourceType).toBe('session');
  expect(parsed.requestId).toBe('corr-test-1234');
  expect(typeof parsed.timestamp).toBe('string');
  expect(typeof parsed.environment).toBe('string');
  expect(Object.keys(parsed).sort()).toEqual(['actorRef', 'environment', 'event', 'requestId', 'resourceType', 'result', 'severity', 'timestamp', 'type'].sort());
});

test('failure events are warn-level with closed-enum reason; failure has no actorRef', () => {
  const c = capture();
  emitLoginResult({ outcome: 'invalid_credentials', correlationId: 'corr-test-1234' }, c.logger);
  const parsed = JSON.parse(c.lines[0]);
  expect(parsed.severity).toBe('warn');
  expect(parsed.result).toBe('failure');
  expect(parsed.outcomeReason).toBe('invalid_credentials');
  expect(parsed.actorRef).toBeUndefined();
});

test('forbidden content never reaches the sink — top-level, nested, or in allowed-looking fields', () => {
  const c = capture();
  emitSecurityEvent({
    type: 'auth.login', severity: 'warn', result: 'failure',
    actorRef: 'user-abc12345', requestId: 'corr-test-1234',
    password: PW, otp: OTP, token: TOK, apiKey: KEY,
    health: HEALTH, prompt: PROMPT, card: CARD,
    message: `login failed with ${PW}`, error: new Error(PW),
    nested: { secret: TOK }, payload: { body: HEALTH },
  }, c.logger);
  expect(c.lines).toHaveLength(1);
  const line = c.lines[0];
  for (const fixture of [PW, OTP, TOK, KEY, HEALTH, PROMPT, CARD]) {
    expect(line.includes(fixture)).toBe(false);
  }
  const parsed = JSON.parse(line);
  expect(parsed.password).toBeUndefined();
  expect(parsed.nested).toBeUndefined();
  expect(parsed.error).toBeUndefined();
  expect(parsed.message).toBeUndefined();
});

test('malformed values in allowed fields are omitted, not logged', () => {
  const c = capture();
  emitSecurityEvent({
    type: 'auth.login', severity: 'info', result: 'success',
    actorRef: 'not valid! spaces', requestId: 'sh0rt', resourceType: 'free-form-string-type',
  }, c.logger);
  const parsed = JSON.parse(c.lines[0]);
  expect(parsed.actorRef).toBeUndefined();
  expect(parsed.requestId).toBeUndefined();
  expect(parsed.resourceType).toBeUndefined();
});

test('unknown type/severity/result reject the whole event — sink untouched', () => {
  const c = capture();
  expect(emitSecurityEvent({ type: 'auth.login.attempt', severity: 'info', result: 'success' }, c.logger)).toBeNull();
  expect(emitSecurityEvent({ type: 'auth.login', severity: 'debug', result: 'success' }, c.logger)).toBeNull();
  expect(emitSecurityEvent({ type: 'auth.login', severity: 'info', result: 'maybe' }, c.logger)).toBeNull();
  expect(emitSecurityEvent(null, c.logger)).toBeNull();
  expect(emitSecurityEvent('auth.login', c.logger)).toBeNull();
  expect(c.lines).toHaveLength(0);
});

test('caller-controlled timestamp/environment are never accepted', () => {
  const c = capture();
  emitSecurityEvent({
    type: 'auth.login', severity: 'info', result: 'success',
    timestamp: '1970-01-01T00:00:00Z', environment: 'production-as attacker-claimed',
  }, c.logger);
  const parsed = JSON.parse(c.lines[0]);
  expect(parsed.timestamp).not.toBe('1970-01-01T00:00:00Z');
  expect(parsed.environment).not.toContain('attacker');
});

test('rate_limited reason survives; unknown reasons omitted', () => {
  const c = capture();
  emitLoginResult({ outcome: 'rate_limited' }, c.logger);
  expect(JSON.parse(c.lines[0]).outcomeReason).toBe('rate_limited');
  const d = capture();
  emitSecurityEvent({ type: 'auth.login', severity: 'warn', result: 'failure', outcomeReason: `pw is ${PW}` }, d.logger);
  expect(JSON.parse(d.lines[0]).outcomeReason).toBeUndefined();
  expect(d.lines[0].includes(PW)).toBe(false);
});

test('emitter never throws on pathological input', () => {
  const c = capture();
  expect(() => emitSecurityEvent(undefined, c.logger)).not.toThrow();
  expect(() => emitSecurityEvent({ type: 'auth.login', severity: 'info', result: 'success', actorRef: { evil: true } }, c.logger)).not.toThrow();
});
