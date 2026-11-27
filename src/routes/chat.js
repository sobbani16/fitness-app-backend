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
// Covers gym vocabulary, named sports (incl. common Indian sports), dance/
// aerobic formats, and generic "be active" nudges — an LLM suggesting any of
// these to a restricted user is a safety leak regardless of phrasing.
const ACTIVITY_SUGGESTION_RE = /\b(run|running|jog|jogging|walk(ing)?|work ?out|exercise|train(ing)?|lift(ing)?|gym|squat|lunge|deadlift|swim(ming)?|cycl(e|ing)|bike|hiit|cardio|yoga|stretch(ing)?|push-?ups?|pull-?ups?|plank|sprint|hik(e|ing)|row(ing)?|elliptical|treadmill|burpee|jump|jumps|jumping|plyo(metrics?)?|overhead|mountain climbers?|box jumps?|sports?(?! ?(?:drinks?|nutrition|bars?|massage))|cricket|badminton|football|soccer|tennis|volleyball|basketball|hockey|golf|boxing|wrestl(e|ing)|kabaddi|martial arts?|karate|judo|taekwondo|kickboxing|zumba|danc(e|ing)|aerobics?|pilates|crossfit|spinning|skip(ping)? rope|jump ?rope|climb(ing)?|skat(e|ing|boarding)|surf(ing)?|kayak(ing)?|stay(ing)? active|get(ting)? active|be(ing)? active|more active|keep moving|get moving|physical activit(y|ies))\b/i;
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

    const gate = await limiter.consume(userId);
    if (!gate.allowed) {
      return res.status(429).json({
        error: 'Daily chat limit reached',
        limit: gate.limit,
        used: gate.used,
        remaining: 0,
      });
    }

    // Fiber questions are answered deterministically by the engine — the LLM
    // never sees them, so numbers can't be fabricated. Requires the
    // fiber_ai_enabled flag on top of ai_coach. A grounded fiber answer opens
    // a short-lived per-user "fiber thread" so follow-ups without a fiber
    // keyword ("what can I add to dinner?") stay on the deterministic path.
    const fiberOn = await flags.isEnabled('fiber_ai_enabled', userId).catch(() => false);
    if (fiberOn) {
      const thread = fiberThreads.get(userId);
      const inFiberThread = !!(thread && Date.now() - thread < FIBER_THREAD_TTL_MS);
      const grounded = await require('../services/fiber/assistant').groundFiberAnswer(userId, message, { inFiberThread }).catch(() => ({ handled: false }));
      if (grounded.handled) {
        fiberThreads.set(userId, Date.now());
        return res.json({ topic: grounded.topic, answer: grounded.answer, source: grounded.source, quota: { limit: gate.limit, used: gate.used, remaining: gate.remaining } });
      }
      fiberThreads.delete(userId);
    }

    const reply = await generateReply(message, userId);
    // Post-generation safety validation: an LLM answer that nudges activity is
    // replaced by a deterministic deflection when the shared engine verdict
    // can't confirm any compatible activity (urgent symptom, restriction,
    // requested rest, unverifiable state). The flag does not weaken recorded
    // restrictions — it only decides whether the check runs.
    // Fail closed on an unexpected gate error: a suppressed push beats a
    // leaked one. gate.js already returns a fail-closed 'unknown' verdict for
    // handled engine failures; this covers unhandled throws (e.g. DB down).
    const sGate = await safetyGate(getPrisma(), userId).catch(() => ({ enabled: true, status: 'unknown', suppressActivityPushes: true, activityPushOk: false }));
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
