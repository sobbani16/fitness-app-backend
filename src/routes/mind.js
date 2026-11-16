// Mind & Habits routes — /mind/*. All member-scoped; journals never leave
// the owning account or reach AI providers without aiJournalConsent.
const express = require('express');
const svc = require('../services/mind');
const audit = require('../services/auditService');
const { requireFeature } = require('../middleware/requireFeature');
const prisma = require('../lib/prisma');

const router = express.Router();
router.use(requireFeature('mind_habits_enabled'));

const uid = (req) => req.userId || req.user.id;

// Preferences + privacy settings
router.get('/preferences', async (req, res) => res.json({ preferences: await svc.getPreferences(uid(req)) }));
router.put('/preferences', async (req, res) => res.json({ preferences: await svc.updatePreferences(uid(req), req.body || {}) }));

// Check-ins
router.post('/check-ins', async (req, res) => {
  const c = await svc.createCheckIn(uid(req), req.body || {}, req.user?.timezone);
  audit.log({ userId: uid(req), action: 'mind.checkin.create', entity: 'EmotionalCheckIn', entityId: c.id }).catch(() => {});
  res.status(201).json({ checkin: c });
});
router.get('/check-ins', async (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 365);
  res.json({ checkins: await svc.listCheckIns(uid(req), { days }) });
});
router.patch('/check-ins/:id', async (req, res) => {
  res.json({ checkin: await svc.updateCheckIn(uid(req), req.params.id, req.body || {}) });
});
router.delete('/check-ins/:id', async (req, res) => {
  await svc.deleteCheckIn(uid(req), req.params.id);
  res.json({ deleted: true });
});

// Learning
router.get('/tracks', async (req, res) => res.json({ tracks: svc.listTracks() }));
router.get('/tracks/:key', async (req, res) => {
  const completed = await svc.listCompletions(uid(req));
  res.json({ track: svc.getTrack(req.params.key, completed) });
});

// Guided exercises
router.get('/exercises', async (req, res) => res.json({ exercises: svc.listExercises() }));
router.post('/exercises/:key/complete', async (req, res) => {
  const c = await svc.completeExercise(uid(req), req.params.key, req.body?.reflection);
  res.status(201).json({ completion: c });
});
router.get('/completions', async (req, res) => res.json({ completions: await svc.listCompletions(uid(req)) }));

// Suggested habits — uses the existing Habits engine; this just lists options.
router.get('/suggested-habits', async (req, res) => res.json({ habits: svc.listSuggestedHabits() }));

// Insights — descriptive, threshold-gated
router.get('/insights', async (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
  res.json(await svc.getInsights(uid(req), { days }));
});

// Leo assist — deterministic supportive suggestions + crisis safety.
// Journals are NOT read or sent anywhere here; body text only.
router.post('/leo', async (req, res) => {
  const prefs = await svc.getPreferences(uid(req));
  const out = svc.leoSuggestions(req.body?.text);
  res.json({ ...out, aiProcessing: false, journalShared: false, aiJournalConsent: prefs.aiJournalConsent });
});

module.exports = router;
