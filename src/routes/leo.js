const express = require('express');
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { requireFeature } = require('../middleware/requireFeature');
const { getUserId } = require('../middleware/rbac');
const registry = require('../services/leo/toolRegistry');
const confirmations = require('../services/leo/confirmations');
const tools = require('../services/leo/tools');

const router = express.Router();
router.use(requireFeature('ai_coach'));
tools.ensureRegistered();

// Every /leo response carries the same shape: {ok, ...} on success or
// {error, code?, details?} via the global error handler. Identity is
// server-bound: userId comes from auth, sessionId from the route — model
// or client input can never supply them (registry rejects identity args).
const CONTRACT_VERSION = 'leo-v1';

function sessionFor(userId, id) {
  return getPrisma().leoSession.findFirst({ where: { id: String(id || ''), userId } });
}

// Idempotent helper: callers supply clientRef (body) or Idempotency-Key
// header; unique constraint turns retries into no-ops.
const clientRefOf = (req) => {
  const v = req.headers['idempotency-key'] || req.body?.clientRef;
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null;
};

// --- Capabilities: what the registry exposes to the model ----------------
router.get('/capabilities', (_req, res) => {
  res.json({ contractVersion: CONTRACT_VERSION, tools: registry.list(), categories: Object.values(registry.CATEGORIES) });
});

// --- Sessions -------------------------------------------------------------
router.post('/sessions', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) throw httpError(401, 'unauthorized');
    const clientRef = clientRefOf(req);
    if (clientRef) {
      const existing = await getPrisma().leoSession.findUnique({ where: { userId_clientRef: { userId, clientRef } } });
      if (existing) return res.json({ ok: true, session: existing, idempotentReplay: true });
    }
    try {
      const session = await getPrisma().leoSession.create({ data: { userId, clientRef } });
      return res.status(201).json({ ok: true, session });
    } catch (e) {
      if (e.code === 'P2002' && clientRef) {
        const existing = await getPrisma().leoSession.findUnique({ where: { userId_clientRef: { userId, clientRef } } });
        if (existing) return res.json({ ok: true, session: existing, idempotentReplay: true });
      }
      throw e;
    }
  } catch (e) { next(e); }
});

router.get('/sessions/:id', async (req, res, next) => {
  try {
    const session = await sessionFor(getUserId(req), req.params.id);
    if (!session) throw httpError(404, 'session_not_found');
    res.json({ ok: true, session });
  } catch (e) { next(e); }
});

router.post('/sessions/:id/cancel', async (req, res, next) => {
  try {
    const session = await sessionFor(getUserId(req), req.params.id);
    if (!session) throw httpError(404, 'session_not_found');
    if (session.status !== 'active') return res.json({ ok: true, session });
    const updated = await getPrisma().leoSession.update({ where: { id: session.id }, data: { status: 'cancelled', endedAt: new Date() } });
    res.json({ ok: true, session: updated });
  } catch (e) { next(e); }
});

// --- Preferences ----------------------------------------------------------
router.put('/sessions/:id/preferences', async (req, res, next) => {
  try {
    const session = await sessionFor(getUserId(req), req.params.id);
    if (!session) throw httpError(404, 'session_not_found');
    const prefs = req.body?.preferences;
    if (typeof prefs !== 'object' || prefs === null || Array.isArray(prefs)) throw httpError(400, 'preferences must be an object');
    if (JSON.stringify(prefs).length > 8000) throw httpError(400, 'preferences too large');
    const updated = await getPrisma().leoSession.update({ where: { id: session.id }, data: { preferences: prefs } });
    res.json({ ok: true, preferences: updated.preferences });
  } catch (e) { next(e); }
});

// --- History --------------------------------------------------------------
router.get('/sessions/:id/messages', async (req, res, next) => {
  try {
    const session = await sessionFor(getUserId(req), req.params.id);
    if (!session) throw httpError(404, 'session_not_found');
    const messages = await getPrisma().leoMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    res.json({ ok: true, messages });
  } catch (e) { next(e); }
});

// --- Messages -------------------------------------------------------------
// {content} — a user turn. Optional {toolCall:{name,args,version?}} requests
// a tool execution through the registry (confirmation flow applies).
router.post('/sessions/:id/messages', async (req, res, next) => {
  try {
    const session = await sessionFor(getUserId(req), req.params.id);
    if (!session) throw httpError(404, 'session_not_found');
    if (session.status !== 'active') throw httpError(409, 'session_not_active');
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content && !req.body?.toolCall) throw httpError(400, 'content or toolCall required');
    if (content.length > 4000) throw httpError(400, 'content too long');

    const prisma = getPrisma();
    const clientRef = clientRefOf(req);
    if (clientRef) {
      const existing = await prisma.leoMessage.findUnique({ where: { sessionId_clientRef: { sessionId: session.id, clientRef } } });
      if (existing) return res.json({ ok: true, message: existing, idempotentReplay: true });
    }
    const userMsg = await prisma.leoMessage.create({
      data: { sessionId: session.id, role: 'user', content: content || '(tool call)', clientRef },
    });

    const call = req.body?.toolCall;
    if (!call) {
      // No orchestration engine is wired yet — respond honestly.
      const reply = await prisma.leoMessage.create({
        data: { sessionId: session.id, role: 'assistant', content: 'Tool calls are supported via the toolCall field; conversational orchestration is not connected yet.' },
      });
      return res.status(201).json({ ok: true, message: userMsg, reply });
    }

    let result;
    try {
      result = await registry.execute(call.name, call.args || {}, { userId: session.userId, sessionId: session.id }, { version: call.version || '1' });
    } catch (e) {
      if (e.code === 'confirmation_required') {
        // Auto-issue the confirmation bound to this exact call.
        const c = await confirmations.issue(session.userId, session.id, call.name, call.args || {});
        return res.status(202).json({
          ok: true, status: 'pending_confirmation',
          confirmation: { id: c.id, toolName: call.name, expiresAt: c.expiresAt },
          message: userMsg,
        });
      }
      throw e;
    }
    const toolMsg = await prisma.leoMessage.create({
      data: { sessionId: session.id, role: 'tool', content: JSON.stringify(result.result), toolName: result.tool },
    });
    res.status(201).json({ ok: true, message: userMsg, toolResult: result, toolMessage: toolMsg });
  } catch (e) {
    if (e.code === 'P2002') {
      const existing = await getPrisma().leoMessage.findFirst({ where: { sessionId: session?.id, clientRef: clientRefOf(req) } });
      if (existing) return res.json({ ok: true, message: existing, idempotentReplay: true });
    }
    next(e);
  }
});

// --- Confirmations ---------------------------------------------------------
// POST /confirmations/:id/confirm — re-executes the bound tool; the consume
// inside registry.execute enforces single-use + binding + expiry.
router.post('/confirmations/:id/confirm', async (req, res, next) => {
  try {
    const c = await getPrisma().leoConfirmation.findFirst({ where: { id: String(req.params.id), userId: getUserId(req) } });
    if (!c) throw httpError(404, 'confirmation_not_found');
    const session = await sessionFor(req.userId, c.sessionId);
    if (!session) throw httpError(404, 'session_not_found');
    // Args are re-sent by the caller and must hash-match the issued binding —
    // the confirmation can never be replayed against different arguments.
    const args = req.body?.args || {};
    const result = await registry.execute(c.toolName, args, { userId: session.userId, sessionId: session.id, confirmationId: c.id });
    const toolMsg = await getPrisma().leoMessage.create({
      data: { sessionId: session.id, role: 'tool', content: JSON.stringify(result.result), toolName: result.tool, toolCallId: c.id },
    });
    res.json({ ok: true, toolResult: result, toolMessage: toolMsg });
  } catch (e) { next(e); }
});

module.exports = router;
