// In-memory exercise session store, keyed by userId.
// Swap for a real DB in production; keep the same public surface.

function createExerciseSessionStore({ clock = () => new Date() } = {}) {
  // userId -> ExerciseSession[]
  const sessions = new Map();

  function listForUser(userId) {
    return sessions.get(userId) ? [...sessions.get(userId)] : [];
  }

  function getById(userId, sessionId) {
    const list = sessions.get(userId) || [];
    return list.find((s) => s.id === sessionId) || null;
  }

  function create(userId, { exerciseType, sets = [] }) {
    if (!userId) throw new Error('userId required');
    if (!exerciseType) throw new Error('exerciseType required');
    const now = clock().toISOString();
    const session = {
      id: `ex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      exerciseType,
      createdAt: now,
      updatedAt: now,
      sets: sets.map((s) => normalizeSet(s, now)),
    };
    const list = sessions.get(userId) || [];
    list.push(session);
    sessions.set(userId, list);
    return session;
  }

  function addSet(userId, sessionId, set) {
    const list = sessions.get(userId) || [];
    const idx = list.findIndex((s) => s.id === sessionId);
    if (idx === -1) return null;
    const now = clock().toISOString();
    list[idx] = {
      ...list[idx],
      updatedAt: now,
      sets: [...list[idx].sets, normalizeSet(set, now)],
    };
    sessions.set(userId, list);
    return list[idx];
  }

  // Returns the most recent session (by createdAt) for a given exerciseType.
  function findLastSessionForExercise(userId, exerciseType) {
    const list = sessions.get(userId) || [];
    const matching = list.filter((s) => s.exerciseType === exerciseType);
    if (matching.length === 0) return null;
    return matching.reduce((latest, cur) =>
      new Date(cur.createdAt) > new Date(latest.createdAt) ? cur : latest,
    );
  }

  function reset() {
    sessions.clear();
  }

  return {
    listForUser,
    getById,
    create,
    addSet,
    findLastSessionForExercise,
    reset,
  };
}

function normalizeSet(s, fallbackTs) {
  const reps = Number(s.reps);
  const weight = Number(s.weight);
  if (!Number.isFinite(reps) || reps <= 0) {
    throw new Error('reps must be a positive number');
  }
  if (!Number.isFinite(weight) || weight < 0) {
    throw new Error('weight must be a non-negative number');
  }
  return {
    reps,
    weight,
    timestamp: s.timestamp || fallbackTs,
  };
}

module.exports = { createExerciseSessionStore };
