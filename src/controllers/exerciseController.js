const { createExerciseSessionStore } = require('../models/exerciseSessionStore');
const { buildPrefill } = require('../services/exerciseService');

// Singleton store for the process. Tests can reset via `store.reset()`.
const store = process.env.NODE_ENV === 'test' && process.env.AUTH_TEST_BYPASS === 'true' ? createExerciseSessionStore() : require('../models/persistentExerciseStore');

function getUserId(req) {
  return (req.userId || req.headers['x-user-id'] || req.body?.userId || '').toString().trim();
}

function requireUser(req, res) {
  const userId = getUserId(req);
  if (!userId) {
    res.status(400).json({ error: 'x-user-id header or userId required' });
    return null;
  }
  return userId;
}

async function listSessions(req, res) {
  const userId = requireUser(req, res);
  if (!userId) return;
  res.json({ sessions: await store.listForUser(userId) });
}

async function getPrefill(req, res) {
  const userId = requireUser(req, res);
  if (!userId) return;
  const { exerciseType } = req.params;
  if (!exerciseType) {
    return res.status(400).json({ error: 'exerciseType required' });
  }
  const previous = await store.findLastSessionForExercise(userId, exerciseType);
  res.json(buildPrefill(previous));
}

async function createSession(req, res) {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const { exerciseType, sets, id, startedAt } = req.body || {};
    const session = await store.create(userId, { exerciseType, sets, id, startedAt });
    res.status(201).json(session);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
}

async function appendSet(req, res) {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const { id } = req.params;
    const { reps, weight, id: setId } = req.body || {};
    const updated = await store.addSet(userId, id, { reps, weight, id: setId });
    if (!updated) return res.status(404).json({ error: 'session not found' });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
}

module.exports = {
  store, // exported for tests
  listSessions,
  getPrefill,
  createSession,
  appendSet,
};

module.exports.finishSession = async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const session = await store.finish(userId, req.params.id);
    if (!session) return res.status(404).json({ error: 'session not found' });
    res.json(session);
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
};
