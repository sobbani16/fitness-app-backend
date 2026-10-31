const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { identifyUser } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');
const { requireApprovedTrainer } = require('../services/trainerAccess');
const messaging = require('../services/messagingService');

const router = express.Router();

// Flag gate first (FEATURE_DISABLED), then identity. Participant/role checks
// live inside the service layer per route.
router.use(requireFeature('trainer_messaging_enabled'), identifyUser);

// Stricter bucket than the global apiLimiter: sends are the abuse vector.
const messageSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.MESSAGE_RATE_LIMIT || 30),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req.ip),
  skip: () => process.env.NODE_ENV === 'test',
});

// GET /conversations — mine (trainer or client), with lastMessage + unreadCount
router.get('/', async (req, res) => {
  try {
    res.json({ conversations: await messaging.listConversations(req.userId) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /conversations/unread-count — total unread across own conversations
router.get('/unread-count', async (req, res) => {
  try {
    res.json(await messaging.unreadCount(req.userId));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /conversations/with/:clientId — trainer starts (or reopens) a conversation
router.post('/with/:clientId', async (req, res) => {
  try {
    await requireApprovedTrainer(req.userId);
    const { conversation, created } = await messaging.getOrCreateConversation({
      trainerUserId: req.userId,
      clientUserId: req.params.clientId,
    });
    res.status(created ? 201 : 200).json({ conversation });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /conversations/with-trainer/:trainerId — client starts (trainer profile id)
router.post('/with-trainer/:trainerId', async (req, res) => {
  try {
    const { conversation, created } = await messaging.getOrCreateConversation({
      trainerId: req.params.trainerId,
      clientUserId: req.userId,
    });
    res.status(created ? 201 : 200).json({ conversation });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /conversations/:id/messages?after=&limit= — cursor page, oldest→newest
router.get('/:id/messages', async (req, res) => {
  try {
    res.json(await messaging.listMessages(req.params.id, req.userId, {
      after: req.query.after,
      limit: req.query.limit,
    }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /conversations/:id/messages { body } — rate-limited send
router.post('/:id/messages', messageSendLimiter, async (req, res) => {
  try {
    const message = await messaging.sendMessage(req.params.id, req.userId, req.body && req.body.body);
    res.status(201).json({ message });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /conversations/:id/read { lastMessageId } — batch read marker
router.post('/:id/read', async (req, res) => {
  try {
    res.json(await messaging.markRead(req.params.id, req.userId, req.body && req.body.lastMessageId));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /conversations/:id/report — abuse report (audit metadata only)
router.post('/:id/report', async (req, res) => {
  try {
    res.json(await messaging.reportConversation(req.params.id, req.userId));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
