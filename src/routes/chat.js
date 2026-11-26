const express = require('express');
const { generateReply } = require('../services/aiService');
const { createDailyLimiter } = require('../services/rateLimiter');
const { requireFeature } = require('../middleware/requireFeature');
const { safetyGate } = require('../services/activitySafety/gate');
const flags = require('../services/featureFlags/service');
const { getPrisma } = require('../lib/prisma');

const router = express.Router();

// Per-user fiber-conversation marker (last grounded fiber answer time).
// In-memory is sufficient: it only widens follow-up routing within a few
// minutes on this instance, never across users, and nothing is persisted.
const FIBER_THREAD_TTL_MS = 10 * 60 * 1000;
const fiberThreads = new Map();

const DAILY_LIMIT = Number(process.env.CHAT_DAILY_LIMIT || 5);
// Deterministic activity-suggestion detector for post-generation validation.
// Deliberately broad — a false positive replaces a reply with a safe
// deflection; a false negative could push exercise on a restricted user.
const ACTIVITY_SUGGESTION_RE = /\b(run|running|jog|jogging|walk(ing)?|work ?out|exercise|train(ing)?|lift(ing)?|gym|squat|lunge|deadlift|swim(ming)?|cycl(e|ing)|bike|hiit|cardio|yoga|stretch(ing)?|push-?ups?|pull-?ups?|plank|sprint|hik(e|ing)|row(ing)?|elliptical|treadmill|burpee)\b/i;
const limiter = process.env.NODE_ENV === 'test' && process.env.AUTH_TEST_BYPASS === 'true' ? createDailyLimiter({limit:DAILY_LIMIT}) : require('../services/persistentLimiter').createPersistentLimiter({limit:DAILY_LIMIT});

// Exposed for tests.
router.__limiter = limiter;

// Identity: session userId first (authenticate rewrites x-user-id to the
// verified id for signed-in requests); the header path covers the isolated
// AUTH_TEST_BYPASS contract only — never reachable in a running server.
function getUserId(req) {
  return (req.userId || req.headers['x-user-id'] || '').toString().trim();
}

// GET /chat/status — remaining quota for today
router.get('/status', requireFeature('ai_coach'), async (req, res, next) => {
 try {
  const userId = getUserId(req);
  if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
  res.json(await limiter.status(userId));
 } catch(e) {next(e);}
});

// POST /chat { message } (header: x-user-id)
router.post('/', requireFeature('ai_coach'), async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const message = (req.body && req.body.message) ? String(req.body.message) : '';
    if (!message.trim()) return res.status(400).json({ error: 'message is required' });

    // Fiber questions are answered deterministically by the engine — the LLM
    // never sees them, so numbers can't be fabricated and no chat quota is
    // consumed. Requires the fiber_ai_enabled flag on top of ai_coach. A
    // grounded fiber answer opens a short-lived per-user "fiber thread" so
    // follow-ups without a fiber keyword ("what can I add to dinner?") stay
    // on the deterministic path. This check runs before the quota gate so
    // free grounded answers — and quota-exhausted users' fiber questions —
    // are not blocked by the LLM daily limit.
    const fiberOn = await flags.isEnabled('fiber_ai_enabled', userId).catch(() => false);
    if (fiberOn) {
      const now = Date.now();
      // Prune expired thread markers — the map is in-process and must not
      // grow with every user who ever asked a fiber question.
      for (const [uid, t] of fiberThreads) if (now - t >= FIBER_THREAD_TTL_MS) fiberThreads.delete(uid);
      const inFiberThread = fiberThreads.has(userId);
      const grounded = await require('../services/fiber/assistant').groundFiberAnswer(userId, message, { inFiberThread }).catch(() => ({ handled: false }));
      if (grounded.handled) {
        fiberThreads.set(userId, now);
        const status = await limiter.status(userId);
        return res.json({ topic: grounded.topic, answer: grounded.answer, source: grounded.source, quota: { limit: status.limit, used: status.used, remaining: status.remaining } });
      }
      fiberThreads.delete(userId);
    }

    const gate = await limiter.consume(userId);
    if (!gate.allowed) {
      return res.status(429).json({
        error: 'Daily chat limit reached',
        limit: gate.limit,
        used: gate.used,
        remaining: 0,
      });
    }

    const reply = await generateReply(message, userId);
    // Post-generation safety validation: an LLM answer that nudges activity is
    // replaced by a deterministic deflection when the shared engine verdict
    // can't confirm any compatible activity (urgent symptom, restriction,
    // requested rest, unverifiable state). The flag does not weaken recorded
    // restrictions — it only decides whether the check runs.
    const sGate = await safetyGate(getPrisma(), userId).catch(() => null);
    if (sGate?.enabled && (sGate.suppressActivityPushes || sGate.activityPushOk === false) && reply?.answer && ACTIVITY_SUGGESTION_RE.test(reply.answer)) {
      return res.json({
        topic: reply.topic || 'safety',
        answer: 'A recorded restriction or recent report means activity suggestions are paused for you right now — rest is a valid choice. If symptoms are new or worsening, consider seeking medical care.',
        safetyFlag: 'activity_suggestion_suppressed',
        quota: { limit: gate.limit, used: gate.used, remaining: gate.remaining },
      });
    }
    res.json({
      ...reply,
      quota: { limit: gate.limit, used: gate.used, remaining: gate.remaining },
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;
