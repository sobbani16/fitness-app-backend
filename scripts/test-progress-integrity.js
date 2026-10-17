const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { getPrisma } = require('../src/lib/prisma');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (url.hostname !== '127.0.0.1' || !url.pathname.startsWith('/fitness_ux_m2_')) throw new Error('Disposable localhost UX database required');
const db = getPrisma(), alice = randomUUID(), bob = randomUUID();
let server;
(async () => {
  try {
    await db.user.createMany({ data: [{ id: alice, email: `${alice}@example.test` }, { id: bob, email: `${bob}@example.test` }] });
    const app = express(); app.use(express.json());
    // Fixture identity, never connected to a deployment; exercise real routing/database operations.
    app.use((req, _res, next) => { req.userId = alice; next(); });
    app.use('/me/profile', require('../src/routes/profile')); app.use('/me/progress', require('../src/routes/progress'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const profile = { name: 'Fixture', age: 30, sex: 'female', heightCm: 173.2, weightKg: 73.37, goalWeightKg: 70, units: 'metric', activityLevel: 'moderate', goal: 'maintain' };
    const put = body => fetch(`${base}/me/profile`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const results = await Promise.all(Array.from({ length: 8 }, () => put(profile)));
    assert(results.every(r => r.status === 200));
    assert.equal(await db.weightEntry.count({ where: { userId: alice } }), 1);
    assert.equal((await put({ ...profile, units: 'imperial' })).status, 200);
    assert.equal(await db.weightEntry.count({ where: { userId: alice } }), 1);
    assert.equal((await put({ ...profile, age: 30.5 })).status, 400);
    assert.equal((await put({ ...profile, goalWeightKg: -1 })).status, 400);
    await db.weightEntry.createMany({ data: [{ userId: alice, weightKg: 72, recordedAt: new Date('2026-03-08T05:30:00Z') }, { userId: bob, weightKg: 99, recordedAt: new Date('2026-03-08T05:30:00Z') }] });
    await db.waterLog.create({ data: { userId: alice, amountMl: 0, loggedAt: new Date('2026-03-08T06:00:00Z') } });
    const res = await fetch(`${base}/me/progress?from=2026-03-07&to=2026-03-09&timeZone=America%2FNew_York&userId=${bob}`);
    assert.equal(res.status, 200); const { entries } = await res.json();
    assert.deepEqual(entries.map(e => e.weightKg), [null, 72, null]);
    assert.deepEqual(entries.map(e => e.waterMl), [null, 0, null]);
    assert(entries.every(e => e.calories === null && e.fiber === null && e.steps === null));
    console.log('PASS: concurrent profile retries create one weight entry; units preserve history; fractional age rejected; invalid goal rejected; owned timezone progress; missing versus zero preserved');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    const where = { userId: { in: [alice, bob] } };
    await db.macroGoal.deleteMany({ where }); await db.weightEntry.deleteMany({ where }); await db.waterLog.deleteMany({ where });
    await db.user.deleteMany({ where: { id: { in: [alice, bob] } } }); await db.$disconnect();
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
