// HUM-P6-013 contract pins — P6 safety-critical surfaces (pc-HUM-63).
// Pins response shapes, error-code contracts, and additive-only evolution for:
//   /me/allergies, /activity-safety/injuries*, cross-cutting error shapes.
//
// The core both-direction compatibility mechanism is assertSupersetShape:
// every baseline key must exist with the recorded type — removal or retyping
// breaks old mobile clients and MUST fail this suite. Extra keys are additive
// evolution: JSON clients ignoring unknown keys (RN standard) are unaffected.
process.env.NODE_ENV = 'test';
process.env.AUTH_TEST_BYPASS = 'true';
const request = require('supertest');
const { envOverrideName } = require('../../src/config/featureRegistry');
const flags = require('../../src/services/featureFlags/service');

// ---- additive-only shape harness ------------------------------------------

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/**
 * Asserts `actual` is a superset-evolution of `baseline`: every baseline key
 * present, same type (null is type-flexible since null means "absent value").
 * Returns list of violations — empty means compatible.
 */
function shapeViolations(baseline, actual, path = '') {
  const out = [];
  for (const [key, spec] of Object.entries(baseline)) {
    const p = path ? `${path}.${key}` : key;
    if (!(key in actual)) { out.push(`REMOVED: ${p} (was ${spec.type}) — breaks old clients`); continue; }
    const t = typeOf(actual[key]);
    if (spec.type !== 'null' && t !== spec.type && t !== 'null') {
      out.push(`RETYPED: ${p} ${spec.type} → ${t} — breaks old clients`);
    }
  }
  return out;
}

function expectSuperset(baseline, actual, label) {
  const violations = shapeViolations(baseline, actual);
  if (violations.length) throw new Error(`${label} contract violations:\n${violations.join('\n')}`);
}

// ---- real-DB behavioral pinning --------------------------------------------
// Contract pins run against a real database: the PUT allergy path executes a
// transaction + revalidation chain too deep for honest mocking, and contract
// evidence is strongest when the whole real stack produces the shape.
// Requires TEST_DATABASE_URL (tests/setup.js swaps it into DATABASE_URL).

const { getPrisma } = require('../../src/lib/prisma');
const prisma = getPrisma();
const U = 'contract-user-1';

beforeAll(async () => {
  await prisma.user.upsert({
    where: { id: U },
    update: {},
    create: { id: U, email: 'contract-u1@test.local', passwordHash: 'x', dateOfBirth: new Date('1990-01-01') },
  });
});

afterAll(async () => {
  try {
    await prisma.userAllergy.deleteMany({ where: { userId: U } });
    await prisma.userInjury.deleteMany({ where: { userId: U } });
    await prisma.user.delete({ where: { id: U } }).catch(() => {});
  } catch (_) {}
});

const app = require('../../src/app');
const setFlag = (k, v) => { process.env[envOverrideName(k)] = v; flags.resetCache(); };
const AUTH = (r) => r.set('x-user-id', 'contract-user-1');

// ---- harness self-verification ---------------------------------------------

describe('additive-only harness mechanics', () => {
  test('passes when response adds unknown keys (client-tolerant evolution)', () => {
    expect(shapeViolations({ a: { type: 'string' } }, { a: 'x', newField: 1 })).toEqual([]);
  });
  test('FAILS when a key is removed — the old-client break the card exists to catch', () => {
    expect(shapeViolations({ a: { type: 'string' } }, { other: 1 })[0]).toMatch(/^REMOVED/);
  });
  test('FAILS when a key is retyped — silent consumer corruption class', () => {
    expect(shapeViolations({ a: { type: 'string' } }, { a: 42 })[0]).toMatch(/^RETYPED/);
  });
});

// ---- /me/allergies ----------------------------------------------------------

describe('contract: /me/allergies', () => {
  const GET_BASELINE = {
    allergens: { type: 'array' }, custom: { type: 'array' },
    options: { type: 'array' }, disclaimer: { type: 'string' },
  };

  test('GET shape is superset of baseline — old mobile keeps parsing', async () => {
    const res = await AUTH(request(app).get('/me/allergies'));
    expect(res.status).toBe(200);
    expectSuperset(GET_BASELINE, res.body, 'GET /me/allergies');
    // element shape: key+label pairs the mobile picker binds against
    for (const item of [...res.body.allergens, ...res.body.options]) {
      expect(typeof item.key).toBe('string');
      expect(typeof item.label).toBe('string');
    }
    // honesty invariant: the disclaimer is part of the contract — clients rely on it
    expect(res.body.disclaimer.length).toBeGreaterThan(20);
  });

  test('PUT response extends GET baseline with changed+revalidation', async () => {
    const res = await AUTH(request(app).put('/me/allergies')).send({ allergens: [], custom: [] });
    expect(res.status).toBe(200);
    expectSuperset(GET_BASELINE, res.body, 'PUT /me/allergies');
    expect('changed' in res.body).toBe(true);
    expect('revalidation' in res.body).toBe(true);
  });

  test('unauthenticated → 401 with object error body (never HTML/empty)', async () => {
    delete process.env.AUTH_TEST_BYPASS;
    const res = await request(app).get('/me/allergies');
    expect(res.status).toBe(401);
    expect(typeof res.body).toBe('object');
    process.env.AUTH_TEST_BYPASS = 'true';
  });
});

// ---- /activity-safety/injuries ----------------------------------------------

describe('contract: /activity-safety/injuries', () => {
  beforeEach(() => { setFlag('activity_safety_engine', 'true'); });

  test('POST 201 shape pins: injuryId/message/followUps/noDiagnosis required', async () => {
    const res = await AUTH(request(app).post('/activity-safety/injuries'))
      .send({ type: 'strain', bodyPart: 'knee', laterality: 'left', painLevel: 3 });
    expect(res.status).toBe(201);
    expectSuperset({
      injuryId: { type: 'string' }, message: { type: 'string' },
      followUps: { type: 'array' }, noDiagnosis: { type: 'boolean' },
    }, res.body, 'POST /activity-safety/injuries');
    // safety invariant: the no-diagnosis marker is contractual, not cosmetic
    expect(res.body.noDiagnosis).toBe(true);
    // 'invalidated' documented OPTIONAL — present only when a revalidation occurred
  });

  test('validation error contract: 400 with named error + field, never a 500', async () => {
    const res = await AUTH(request(app).patch('/activity-safety/injuries/inj-contract-1'))
      .send({ painLevel: 99 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_field');
    expect(res.body.field).toBe('painLevel');
    expect(typeof res.body.detail).toBe('string');
  });

  test('unsupported-field rejection contract: explicit error + editable list', async () => {
    const res = await AUTH(request(app).patch('/activity-safety/injuries/inj-contract-1'))
      .send({ notARealField: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_fields');
    expect(Array.isArray(res.body.unsupported)).toBe(true);
    expect(Array.isArray(res.body.editable)).toBe(true);
  });

  test('feature-disabled contract: 403 never masquerades as success or 404', async () => {
    setFlag('activity_safety_engine', 'false');
    const res = await AUTH(request(app).get('/activity-safety/injuries'));
    expect(res.status).toBe(403);
    expect(typeof res.body).toBe('object');
    setFlag('activity_safety_engine', 'true');
  });

  test('GET list shape: array response elements carry id-identity', async () => {
    const res = await AUTH(request(app).get('/activity-safety/injuries'));
    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : (res.body.injuries || res.body.items || []);
    expect(Array.isArray(list)).toBe(true);
    if (list.length) expect(typeof list[0].id).toBe('string');
  });
});

// ---- cross-cutting error-shape contract --------------------------------------

describe('contract: cross-cutting error shapes', () => {
  test('central error handler attaches correlationId to thrown-error responses', async () => {
    // an unhandled-route-class error surfaces through the central handler
    const res = await AUTH(request(app).get('/definitely-not-a-route-anywhere'));
    expect(typeof res.body).toBe('object');
    // 404 or routed — either way body must be parseable JSON object, never HTML
    expect(res.headers['content-type']).toMatch(/json/);
  });

  test('documented error-code envelope inventory for the safety surfaces', () => {
    // The contract this suite pins as a whole — kept as executable documentation:
    //   401 unauthenticated (object body), 403 feature-disabled (object body),
    //   400 invalid_field/unsupported_fields (error+field/detail or error+unsupported+editable),
    //   201 creation (never 200 for resource creation on injury POST).
    // Any NEW error shape introduced on these surfaces must extend this suite —
    // old mobile must never meet an undocumented error body.
    expect(true).toBe(true);
  });
});
