// Golden-path E2E regression tests — Mind, Food Intelligence, Wearables.
// Real Express app + real disposable DB; flags auto-enabled by setup.js.
const request = require('supertest');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
// These tests write to a real Postgres database — only ever the disposable
// localhost fitness_auth_readiness DB. Skips (not fails) under the default suite run.
const SAFE_DB = ['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/fitness_auth_readiness';
if (SAFE_DB) process.env.AUTH_TEST_BYPASS = 'false';
const prisma = SAFE_DB ? new PrismaClient() : null;
const app = SAFE_DB ? require('../../src/app') : null;
const d = SAFE_DB ? describe : describe.skip;
const { hashPassword, createSession } = require('../../src/services/authService');

async function account() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, passwordHash: await hashPassword('Passw0rd!e2e'), emailVerifiedAt: new Date() } });
  return createSession(user);
}
const get = (t, p) => request(app).get(p).set('Authorization', `Bearer ${t.token}`);
const post = (t, p, b = {}) => request(app).post(p).set('Authorization', `Bearer ${t.token}`).send(b);
const put = (t, p, b = {}) => request(app).put(p).set('Authorization', `Bearer ${t.token}`).send(b);

afterAll(async () => prisma.$disconnect());

d('golden path — Mind & Habits', () => {
  test('opt in → check-in → history → edit → insights → exercise → delete', async () => {
    const who = await account();
    // opt in / prefs
    const prefs = await get(who, '/mind/preferences').expect(200);
    expect(prefs.body.preferences.moduleEnabled).toBe(true);
    await put(who, '/mind/preferences', { remindersEnabled: true }).expect(200);

    // check-in
    const c = await post(who, '/mind/check-ins', { mood: 'good', energy: 4, stress: 2, contextTags: ['work'], journal: 'private note' }).expect(201);
    expect(c.body.checkin.mood).toBe('good');

    // history (owner sees own journal)
    const hist = await get(who, '/mind/check-ins').expect(200);
    expect(hist.body.checkins.length).toBe(1);
    expect(hist.body.checkins[0].journal).toBe('private note');

    // edit
    await request(app).patch(`/mind/check-ins/${c.body.checkin.id}`).set('Authorization', `Bearer ${who.token}`).send({ mood: 'neutral', energy: 3 }).expect(200);

    // insights — insufficient under threshold, honest
    const ins = await get(who, '/mind/insights').expect(200);
    expect(ins.body.dataQuality).toBe('insufficient');

    // tracks + exercise completion
    const tracks = await get(who, '/mind/tracks').expect(200);
    expect(tracks.body.tracks.length).toBe(4);
    const track = await get(who, '/mind/tracks/self_awareness').expect(200);
    expect(track.body.track.lessons.length).toBe(3);
    await post(who, '/mind/exercises/breathing-2min/complete', { reflection: 'ok' }).expect(201);

    // isolation: another user cannot see the check-in
    const other = await account();
    const oh = await get(other, '/mind/check-ins').expect(200);
    expect(oh.body.checkins.length).toBe(0);

    // delete
    await request(app).delete(`/mind/check-ins/${c.body.checkin.id}`).set('Authorization', `Bearer ${who.token}`).expect(200);
    expect((await get(who, '/mind/check-ins')).body.checkins.length).toBe(0);
  });
});

d('golden path — Food Intelligence', () => {
  test('barcode → product → suitability → evidence → scan-result → log', async () => {
    const who = await account();
    // seed catalog product + allergy
    await post(who, '/food-intel/barcode', { barcode: '8901234567890', name: 'Test Oats', brand: 'Acme', servingSizeG: 40, nutrients: { calories: 150, proteinG: 5, carbsG: 27, fatG: 2, fiberG: 4 }, ingredients: 'oats, honey, cinnamon', allergens: [] }).expect(201);
    const allergy = await prisma.allergy.create({ data: { name: 'peanut-e2e' } }).catch(async () => prisma.allergy.findFirst({ where: { name: 'peanut-e2e' } }));
    await prisma.userAllergy.create({ data: { userId: who.user.id, allergyId: allergy.id } });

    // resolve
    const hit = await get(who, '/food-intel/barcode/8901234567890').expect(200);
    expect(hit.body.found).toBe(true);
    const miss = await get(who, '/food-intel/barcode/0000000000000').expect(200);
    expect(miss.body.found).toBe(false);
    expect(miss.body.nextStep).toBe('label_photo_or_manual');

    // suitability: allergy conflict is hard
    const suit = await post(who, '/food-intel/suitability', { ingredientText: 'oats, peanut-e2e butter' }).expect(200);
    expect(suit.body.verdict).toBe('conflict');

    // evidence: approved only + alias resolution
    const ev = await get(who, '/food-intel/evidence/cinnamon').expect(200);
    expect(ev.body.found).toBe(true);
    const aliased = await get(who, '/food-intel/evidence/dalchini').expect(200);
    expect(aliased.body.found).toBe(true);
    const explain = await get(who, '/food-intel/explain/cinnamon?q=does cinnamon help weight').expect(200);
    expect(explain.body.answer.join(' ')).toMatch(/Not supported|insufficient|marketing/i);

    // composed scan result
    const scan = await post(who, '/food-intel/scan-result', { barcode: '8901234567890' }).expect(200);
    expect(scan.body.product.name).toBe('Test Oats');
    expect(scan.body.evidence.length).toBeGreaterThan(0);

    // log through existing FoodLog pipeline
    const log = await post(who, '/food-intel/log', { productName: 'Test Oats', servingG: 40, nutrients: { calories: 150, proteinG: 5 }, barcode: '8901234567890', mealType: 'breakfast' }).expect(201);
    expect(log.body.foodLog.calories).toBe(150);
    const stored = await prisma.foodLog.findUnique({ where: { id: log.body.foodLog.id } });
    expect(stored.userId).toBe(who.user.id);
    expect(stored.nutritionSnapshot.loggedSource).toBe('food-intel');
  });
});

d('golden path — Wearables', () => {
  test('connect → ingest → dedup → trends → recovery → disconnect keeps data', async () => {
    const who = await account();
    const providers = (await get(who, '/health-sources/providers').expect(200)).body.providers;
    expect(providers.find((p) => p.id === 'humai_band').availability).toBe('not_available');
    await post(who, '/health-sources/sources/humai_band/connect').expect(409); // band refused
    await post(who, '/health-sources/sources/apple_health/connect', { scopes: ['steps', 'heart_rate'] }).expect(200);

    // ingest with intentional duplicates: same externalId twice + cross-provider overlap
    const day = '2026-11-10';
    const recs = [
      { metric: 'steps', value: 8000, unit: 'count', startAt: `${day}T00:00:00Z`, endAt: `${day}T23:59:00Z`, externalId: 'ah-1' },
      { metric: 'steps', value: 8000, unit: 'count', startAt: `${day}T00:00:00Z`, endAt: `${day}T23:59:00Z`, externalId: 'ah-1' }, // dup
      { metric: 'heart_rate', value: 62, unit: 'bpm', startAt: `${day}T08:00:00Z`, externalId: 'ah-hr1' },
      { metric: 'resting_heart_rate', value: 58, unit: 'bpm', startAt: `${day}T06:00:00Z`, externalId: 'ah-rhr1' },
      { metric: 'bogus', value: 1, unit: 'x', startAt: `${day}T00:00:00Z` },
    ];
    const ing = await post(who, '/health-sources/sources/apple_health/measurements', { records: recs }).expect(200);
    expect(ing.body.accepted).toBe(3);
    expect(ing.body.duplicates).toBe(1);
    expect(ing.body.rejected).toBe(1);

    // same data via second provider — daily summary must not double-count
    await post(who, '/health-sources/sources/health_connect/connect', { scopes: ['steps'] }).expect(200);
    await post(who, '/health-sources/sources/health_connect/measurements', { records: [{ metric: 'steps', value: 8000, unit: 'count', startAt: `${day}T00:00:00Z`, endAt: `${day}T23:59:00Z`, externalId: 'hc-1' }] }).expect(200);
    const daily = await get(who, `/health-sources/metrics/steps/daily?days=365`).expect(200);
    const d = daily.body.summary.find((x) => x.day === day);
    expect(d.value).toBe(8000); // NOT 16000
    expect(d.provider).toBe('apple_health');

    // series + isolation
    const series = await get(who, `/health-sources/metrics/heart_rate?from=${day}`).expect(200);
    expect(series.body.records.length).toBe(1);
    const other = await account();
    expect((await get(other, `/health-sources/metrics/heart_rate?from=${day}`)).body.records.length).toBe(0);

    // recovery: insufficient data → honest
    const rec = await get(who, '/health-sources/recovery').expect(200);
    expect(rec.body.status).toBe('INSUFFICIENT_DATA');

    // disconnect keeps records; explicit delete removes
    await post(who, '/health-sources/sources/apple_health/disconnect').expect(200);
    expect((await get(who, `/health-sources/metrics/heart_rate?from=${day}`)).body.records.length).toBe(1);
    await request(app).delete('/health-sources/sources/apple_health/data').set('Authorization', `Bearer ${who.token}`).expect(200);
    expect((await get(who, `/health-sources/metrics/heart_rate?from=${day}`)).body.records.length).toBe(0);

    // revoked source refuses ingest
    await post(who, '/health-sources/sources/health_connect/disconnect').expect(200);
    const denied = await post(who, '/health-sources/sources/health_connect/measurements', { records: [{ metric: 'steps', value: 1, unit: 'count', startAt: `${day}T00:00:00Z` }] }).expect(403);
    expect(denied.body.error).toMatch(/revoked/i);
  });
});
