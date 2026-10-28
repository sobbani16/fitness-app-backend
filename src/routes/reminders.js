const express = require('express');
const { getPrisma } = require('../lib/prisma');
const prefs = require('../services/reminders/preferences');
const { generateSuggestions } = require('../services/reminders/learn');
const { planUser, runTick, TITLES } = require('../services/reminders/scheduler');
const { emit, notifyInbox } = require('../services/reminders/inbox');
const { SNOOZE_OPTIONS, TERMINAL_STATUSES } = require('../services/reminders/constants');

const router = express.Router();

function getUserId(req) {
  return (req.headers['x-user-id'] || req.query.userId || '').toString().trim();
}

function requireUser(req, res) {
  const userId = getUserId(req);
  if (!userId) res.status(400).json({ error: 'x-user-id header or userId required' });
  return userId;
}

// GET /reminders/preferences — returns stored prefs or all-off defaults.
router.get('/preferences', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    res.json({ preferences: await prefs.getPreferences(getPrisma(), userId) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /reminders/preferences — partial update; consent fields are independent.
router.put('/preferences', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    res.json({ preferences: await prefs.updatePreferences(getPrisma(), userId, req.body || {}) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /reminders/preferences/pause { minutes? } — pause all; null/0 resumes.
router.post('/preferences/pause', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const minutes = req.body?.minutes == null ? null : Number(req.body.minutes);
    res.json({ preferences: await prefs.pauseAll(getPrisma(), userId, minutes, req.body?.reason) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /reminders/preferences/revoke-adaptive — immediately stops adaptive automation.
router.post('/preferences/revoke-adaptive', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    await prefs.revokeAdaptive(getPrisma(), userId);
    await emit(getPrisma(), userId, 'reminder.opted_out', { scope: 'adaptive' });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /reminders/preferences/reset-learning — clears learned patterns only.
router.post('/preferences/reset-learning', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    await prefs.resetLearned(getPrisma(), userId);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /reminders/preferences/mute-suggestions — stop future suggestions.
router.post('/preferences/mute-suggestions', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    await prefs.muteSuggestions(getPrisma(), userId);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /reminders/categories — every category with effective settings.
router.get('/categories', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    res.json({ categories: await prefs.listCategories(getPrisma(), userId) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /reminders/categories/:category — configure or toggle one category.
router.put('/categories/:category', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const setting = await prefs.updateCategory(getPrisma(), userId, req.params.category, req.body || {});
    await emit(getPrisma(), userId, 'reminder.category_updated', { category: req.params.category, enabled: setting.enabled });
    res.json({ setting });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /reminders/suggestions?status=pending
router.get('/suggestions', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const status = req.query.status || 'pending';
    const suggestions = await getPrisma().reminderSuggestion.findMany({ where: { userId, status }, orderBy: { createdAt: 'desc' }, take: 50 });
    res.json({ suggestions });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /reminders/suggestions/generate — analyze recent logs now (dev hook).
router.post('/suggestions/generate', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    res.json({ suggestions: await generateSuggestions(getPrisma(), userId) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/suggestions/:id/accept', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    res.json({ setting: await prefs.acceptSuggestion(getPrisma(), userId, req.params.id) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/suggestions/:id/decline', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    res.json({ suggestion: await prefs.declineSuggestion(getPrisma(), userId, req.params.id, { mute: Boolean(req.body?.mute) }) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /reminders/instances?limit=30 — history feed for the notification center.
router.get('/instances', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const instances = await getPrisma().reminderInstance.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit });
    res.json({ instances });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /reminders/instances/:id/action — snooze | skip | complete | dismiss.
// Idempotent: acting on a terminal instance returns it unchanged.
router.post('/instances/:id/action', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const prisma = getPrisma();
    const instance = await prisma.reminderInstance.findUnique({ where: { id: req.params.id } });
    if (!instance || instance.userId !== userId) return res.status(404).json({ error: 'Reminder not found' });
    if (TERMINAL_STATUSES.includes(instance.status)) return res.json({ instance });
    const action = String(req.body?.action || '');
    const now = new Date();
    let data;
    if (action === 'snooze') {
      const minutes = SNOOZE_OPTIONS.includes(Number(req.body?.minutes)) ? Number(req.body.minutes) : 30;
      data = { status: 'snoozed', snoozeUntil: new Date(now.getTime() + minutes * 60000) };
    } else if (action === 'skip') {
      data = { status: 'skipped', actedAt: now };
    } else if (action === 'dismiss') {
      data = { status: 'dismissed', actedAt: now };
    } else if (action === 'complete') {
      data = { status: 'completed', actedAt: now };
    } else {
      return res.status(400).json({ error: 'action must be snooze|skip|complete|dismiss' });
    }
    const updated = await prisma.reminderInstance.update({ where: { id: instance.id }, data });
    if (action === 'complete' && instance.category === 'supplement' && instance.payload?.userSupplementId) {
      const link = await prisma.userSupplement.findUnique({ where: { id: instance.payload.userSupplementId }, include: { supplement: true } });
      const today = new Date().toISOString().slice(0, 10);
      const existing = link ? await prisma.supplementLog.findFirst({ where: { userId, userSupplementId: link.id, date: today } }) : null;
      // Never create a duplicate same-day completion record.
      if (link && link.userId === userId && !existing) {
        await prisma.supplementLog.create({ data: { userId, userSupplementId: link.id, supplementName: link.supplement.name, quantity: 1, calories: link.supplement.calories || 0, proteinG: link.supplement.proteinG || 0, carbsG: link.supplement.carbsG || 0, fatG: link.supplement.fatG || 0, fiberG: link.supplement.fiberG || 0, date: today } });
      }
    }
    await emit(prisma, userId, `reminder.${data.status}`, { category: instance.category });
    res.json({ instance: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /reminders/diagnostics — authenticated user-scoped pipeline status:
// consent, category settings, registered devices, and recent instance
// outcomes (sent/suppressed/expired with reasons). No other user's data.
router.get('/diagnostics', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const prisma = getPrisma();
    const [prefs, categories, devices, instances, counts] = await Promise.all([
      prisma.reminderPreference.findUnique({ where: { userId } }),
      prisma.reminderCategorySetting.findMany({ where: { userId } }),
      prisma.pushDevice.findMany({ where: { userId }, orderBy: { lastSeenAt: 'desc' }, take: 10 }),
      prisma.reminderInstance.findMany({ where: { userId }, orderBy: { scheduledFor: 'desc' }, take: 15,
        select: { category: true, status: true, reason: true, scheduledFor: true, actedAt: true } }),
      prisma.reminderInstance.groupBy({ by: ['status'], where: { userId, scheduledFor: { gte: new Date(Date.now() - 86400000) } }, _count: true }),
    ]);
    res.json({
      delivery: 'device-local', // reminders are scheduled on-device; no remote push is configured
      consent: prefs ? { masterEnabled: prefs.masterEnabled, adaptiveEnabled: prefs.adaptiveEnabled, pausedUntil: prefs.pausedUntil, quietStart: prefs.quietStart, quietEnd: prefs.quietEnd, dailyCap: prefs.dailyCap, timezone: prefs.timezone } : null,
      categories: categories.map(c => ({ category: c.category, enabled: c.enabled, times: c.times, intervalMinutes: c.intervalMinutes })),
      devices: devices.map(d => ({ deviceId: d.deviceId, platform: d.platform, hasPushToken: Boolean(d.expoPushToken), lastSeenAt: d.lastSeenAt, active: d.active })),
      last24h: Object.fromEntries(counts.map(c => [c.status, c._count])),
      recent: instances,
    });
  } catch (error) { fail(res, error); }
});

// GET /reminders/inbox — recent inbox notifications (reminder-prefixed only).
router.get('/inbox', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const notifications = await getPrisma().notification.findMany({ where: { userId, type: { startsWith: 'reminder:' } }, orderBy: { createdAt: 'desc' }, take: limit });
    res.json({ notifications });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /reminders/devices { deviceId, platform, expoPushToken? }
router.post('/devices', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { deviceId, platform, expoPushToken } = req.body || {};
    if (!deviceId || !['ios', 'android'].includes(platform)) return res.status(400).json({ error: 'deviceId and platform ios|android required' });
    const device = await getPrisma().pushDevice.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      create: { userId, deviceId, platform, expoPushToken: expoPushToken || null, lastSeenAt: new Date(), active: true },
      update: { platform, expoPushToken: expoPushToken || undefined, lastSeenAt: new Date(), active: true },
    });
    res.json({ device: { id: device.id, deviceId: device.deviceId, platform: device.platform, active: device.active } });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /reminders/devices/:deviceId — permission revoked / device removed.
router.delete('/devices/:deviceId', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    await getPrisma().pushDevice.updateMany({ where: { userId, deviceId: req.params.deviceId }, data: { active: false } });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /reminders/test — writes an inbox entry only. No push is sent; real
// delivery arrives with the device pipeline milestone.
router.post('/test', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const notification = await notifyInbox(getPrisma(), { userId, category: 'test', title: 'Test reminder', body: 'This is how Humai reminders will look.', why: 'You tapped Send test notification.' });
    res.json({ notification });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /reminders/tick — run one planning+evaluation pass for this user.
// Exposed for development builds; production scheduling is wired separately.
router.post('/tick', async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const prisma = getPrisma();
    const planned = await planUser(prisma, userId, new Date());
    const results = await runTick(prisma, { userIds: [userId] });
    res.json({ planned: planned.length, ...results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
