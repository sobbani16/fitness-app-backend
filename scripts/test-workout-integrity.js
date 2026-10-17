// Disposable local databases only; never run against a deployment.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { getPrisma } = require('../src/lib/prisma');
const store = require('../src/models/persistentExerciseStore');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (url.hostname !== '127.0.0.1' || !url.pathname.startsWith('/fitness_ux_m2_')) throw new Error('Disposable local UX database required');
const db = getPrisma();
const userId = randomUUID(), otherId = randomUUID();
(async () => {
  try {
    await db.user.createMany({ data: [{ id: userId, email: `${userId}@example.test` }, { id: otherId, email: `${otherId}@example.test` }] });
    const id = randomUUID(), setId = randomUUID();
    const payload = { id, exerciseType: 'squat', sets: [{ id: setId, reps: 5, weight: 100 }] };
    const created = await Promise.all(Array.from({ length: 8 }, () => store.create(userId, payload)));
    assert(created.every(s => s.id === id && s.sets.length === 1));
    assert.equal(await db.workoutSession.count({ where: { userId } }), 1);
    const next = { id: randomUUID(), reps: 8, weight: 110 };
    await Promise.all(Array.from({ length: 8 }, () => store.addSet(userId, id, next)));
    assert.equal((await store.listForUser(userId))[0].sets.length, 2);
    await assert.rejects(store.addSet(userId, id, { ...next, reps: 9 }), /already used/);
    await assert.rejects(store.create(otherId, payload), /already used/);
    assert.equal(await store.addSet(otherId, id, { id: randomUUID(), reps: 5, weight: 50 }), null);
    const finished = await store.finish(userId, id);
    assert.equal((await store.finish(userId, id)).finishedAt, finished.finishedAt);
    await assert.rejects(store.addSet(userId, id, { id: randomUUID(), reps: 5, weight: 50 }), /already finished/);
    assert.equal((await store.addSet(userId, id, next)).sets.length, 2);
    assert.equal((await store.listForUser(userId))[0].finishedAt, finished.finishedAt);
    console.log('PASS: concurrent creation, concurrent append, payload conflict, ownership, idempotent finish, finished write rejection, lost-response replay, persistent review');
  } finally {
    await db.exerciseSet.deleteMany({ where: { workoutSession: { userId: { in: [userId, otherId] } } } });
    await db.workoutSession.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await db.$disconnect();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
