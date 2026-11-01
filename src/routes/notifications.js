// General member/trainer notification feed (messages, plan updates, requests…).
const express = require('express');
const { identifyUser } = require('../middleware/rbac');
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');

const router = express.Router();
router.use(identifyUser);

// GET /me/notifications?take=50 — newest first.
router.get('/', async (req, res, next) => {
  try {
    const take = Math.min(100, Math.max(1, Number(req.query.take) || 50));
    const notifications = await getPrisma().notification.findMany({
      where: { userId: req.userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
    const unread = await getPrisma().notification.count({ where: { userId: req.userId, read: false } });
    res.json({ notifications, unread });
  } catch (e) { next(e); }
});

// POST /me/notifications/read {ids?: string[]} — mark read; empty = mark all.
router.post('/read', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(x => typeof x === 'string') : undefined;
    if (ids && ids.length > 200) throw httpError(400, 'Too many ids');
    await getPrisma().notification.updateMany({
      where: { userId: req.userId, read: false, ...(ids ? { id: { in: ids } } : {}) },
      data: { read: true },
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
