const { getPrisma } = require('../lib/prisma');
const { randomUUID } = require('crypto');
const include = { exerciseSets: { orderBy: { setNumber: 'asc' } } };
function conflict(message) { const e = new Error(message); e.status = 409; throw e; }
function operationId(id) {
  if (id !== undefined && (typeof id !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(id))) throw new Error('Invalid operation ID');
  return id || randomUUID();
}
function output(s) {
  if (!s) return null;
  return { id: s.id, userId: s.userId, exerciseType: s.workoutType, createdAt: s.startedAt.toISOString(), updatedAt: s.endedAt.toISOString(), finishedAt: s.finishedAt?.toISOString() || null,
    weightUnit: 'lb', sets: s.exerciseSets.map(x => ({ id: x.id, reps: x.reps, weight: x.weightLbs, timestamp: s.endedAt.toISOString() })) };
}
function validate(set) {
  if (!Number.isInteger(set.reps) || set.reps < 1 || set.reps > 1000) throw new Error('reps must be a positive integer up to 1000');
  if (!Number.isFinite(set.weight) || set.weight < 0 || set.weight > 2000) throw new Error('weight must be between 0 and 2000 lb');
  return { id: operationId(set.id), reps: set.reps, weightLbs: set.weight };
}
function checkReplay(s, userId, exerciseType, sets) {
  if (s.userId !== userId || s.workoutType !== exerciseType || sets.some((x, i) => s.exerciseSets[i]?.reps !== x.reps || s.exerciseSets[i]?.weightLbs !== x.weightLbs)) conflict('Operation ID already used');
  return output(s);
}
module.exports = {
  async listForUser(userId) { return (await getPrisma().workoutSession.findMany({ where: { userId }, include, orderBy: { startedAt: 'desc' }, take: 200 })).map(output); },
  async findLastSessionForExercise(userId, exerciseType) { return output(await getPrisma().workoutSession.findFirst({ where: { userId, workoutType: exerciseType }, include, orderBy: { startedAt: 'desc' } })); },
  async create(userId, { exerciseType, sets = [], id, startedAt }) {
    if (typeof exerciseType !== 'string' || !exerciseType.trim() || exerciseType.length > 100 || !Array.isArray(sets) || sets.length > 100) throw new Error('Invalid exercise or sets');
    const normalized = sets.map(validate), key = operationId(id), now = new Date();
    const start = startedAt === undefined ? now : new Date(startedAt);
    const existing = await getPrisma().workoutSession.findUnique({ where: { id: key }, include });
    if (existing) return checkReplay(existing, userId, exerciseType, normalized);
    if (!Number.isFinite(start.getTime()) || start > now || now - start > 7 * 86400000) throw new Error('Workout start must be within the last seven days');
    try {
      return output(await getPrisma().workoutSession.create({ data: { id: key, userId, workoutType: exerciseType, durationMinutes: 0, startedAt: start, endedAt: now,
        exerciseSets: { create: normalized.map((x, i) => ({ ...x, exerciseName: exerciseType, setNumber: i + 1 })) } }, include }));
    } catch (e) {
      if (e.code !== 'P2002') throw e;
      const committed = await getPrisma().workoutSession.findUnique({ where: { id: key }, include });
      if (!committed) conflict('Operation ID already used');
      return checkReplay(committed, userId, exerciseType, normalized);
    }
  },
  async addSet(userId, id, set) {
    const normalized = validate(set);
    return getPrisma().$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "WorkoutSession" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
      const s = await tx.workoutSession.findFirst({ where: { id, userId }, include });
      if (!s) return null;
      const existing = s.exerciseSets.find(x => x.id === normalized.id);
      if (existing) {
        if (existing.reps !== normalized.reps || existing.weightLbs !== normalized.weightLbs) conflict('Operation ID already used');
        return output(s);
      }
      if (s.finishedAt) conflict('Workout already finished');
      if (s.exerciseSets.length >= 100) throw new Error('Maximum 100 sets per workout');
      const now = new Date();
      return output(await tx.workoutSession.update({ where: { id }, data: { endedAt: now, durationMinutes: Math.min(240, Math.round((now - s.startedAt) / 60000)),
        exerciseSets: { create: { ...normalized, exerciseName: s.workoutType, setNumber: s.exerciseSets.length + 1 } } }, include }));
    });
  },
  async finish(userId, id) {
    return getPrisma().$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "WorkoutSession" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
      const s = await tx.workoutSession.findFirst({ where: { id, userId }, include });
      if (!s || s.finishedAt) return output(s);
      if (!s.exerciseSets.length) throw new Error('Log a set before finishing');
      const now = new Date();
      return output(await tx.workoutSession.update({ where: { id }, data: { finishedAt: now, endedAt: now, durationMinutes: Math.min(240, Math.round((now - s.startedAt) / 60000)) }, include }));
    });
  }
};
