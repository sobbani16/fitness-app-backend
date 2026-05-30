const { createExerciseSessionStore } = require('../models/exerciseSessionStore');
const { buildPrefill } = require('../services/exerciseService');

// Singleton store for the process. Tests can reset via `store.reset()`.
const store = createExerciseSessionStore();

function getUserId(req) {
  return (req.headers['x-user-id'] || req.body?.userId || '').toString().trim();
}

function requireUser(req, res) {
  const userId = getUserId(req);
  if (!userId) {
    res.status(400).json({ error: 'x-user-id header or userId required' });
    return null;
  }
  return userId;
}

function listSessions(req, res) {
  const userId = requireUser(req, res);
  if (!userId) return;
  res.json({ sessions: store.listForUser(userId) });
}

function getPrefill(req, res) {
  const userId = requireUser(req, res);
  if (!userId) return;
  const { exerciseType } = req.params;
  if (!exerciseType) {
    return res.status(400).json({ error: 'exerciseType required' });
  }
  const previous = store.findLastSessionForExercise(userId, exerciseType);
  res.json(buildPrefill(previous));
}

function createSession(req, res) {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const { exerciseType, sets } = req.body || {};
    const session = store.create(userId, { exerciseType, sets });
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

function appendSet(req, res) {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const { id } = req.params;
    const { reps, weight } = req.body || {};
    const updated = store.addSet(userId, id, { reps, weight });
    if (!updated) return res.status(404).json({ error: 'session not found' });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = {
  store, // exported for tests
  listSessions,
  getPrefill,
  createSession,
  appendSet,
};
