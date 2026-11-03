const express = require('express');
const { getPrisma } = require('../lib/prisma');
const { summary } = require('../services/healthData');
const { requireAnyFeature } = require('../middleware/requireFeature');

const router = express.Router();
router.use(requireAnyFeature('apple_health_sync', 'android_health_sync'));

function getUserId(req) {
  return (req.headers['x-user-id'] || req.query.userId || '').toString().trim();
}

// GET /health-data/summary?days=7 — normalized metrics + freshness + sources.
router.get('/summary', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    res.json(await summary(getPrisma(), userId, { days }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /health-data/energy — upsert imported active-energy records.
// Body: { records: [{ provider, sourceId, startAt, endAt, activeKcal, deviceLabel?, metadata? }] }
// Dedupe: (userId, provider, sourceId) unique — repeated syncs are idempotent.
router.post('/energy', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const records = Array.isArray(req.body?.records) ? req.body.records.slice(0, 200) : [];
    const providers = new Set(['fitbit', 'healthkit', 'health_connect']);
    const prisma = getPrisma();
    let saved = 0;
    for (const r of records) {
      const provider = String(r.provider || '').toLowerCase();
      const sourceId = String(r.sourceId || '').slice(0, 200);
      const startAt = new Date(r.startAt), endAt = new Date(r.endAt);
      const kcal = Number(r.activeKcal ?? 0);
      const restKcal = r.restingKcal == null ? null : Number(r.restingKcal);
      const kcalOk = Number.isFinite(kcal) && kcal >= 0 && kcal <= 20000;
      const restOk = restKcal == null || (Number.isFinite(restKcal) && restKcal >= 0 && restKcal <= 20000);
      if (!providers.has(provider) || !sourceId || !Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || startAt >= endAt || !kcalOk || !restOk || (kcal <= 0 && restKcal == null)) continue;
      await prisma.healthEnergyRecord.upsert({
        where: { userId_provider_sourceId: { userId, provider, sourceId } },
        create: { userId, provider, sourceId, startAt, endAt, activeKcal: kcal, restingKcal: restKcal, deviceLabel: r.deviceLabel ? String(r.deviceLabel).slice(0, 100) : null, metadata: r.metadata && typeof r.metadata === 'object' ? r.metadata : null },
        update: { startAt, endAt, activeKcal: kcal, restingKcal: restKcal, syncedAt: new Date() },
      });
      saved++;
    }
    res.json({ saved, received: records.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /health-data/energy?days=7 — recent imported active calories, per provider.
router.get('/energy', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    const since = new Date(); since.setDate(since.getDate() - days);
    const records = await getPrisma().healthEnergyRecord.findMany({
      where: { userId, startAt: { gte: since } },
      orderBy: { startAt: 'desc' },
      take: 500,
      select: { provider: true, sourceId: true, deviceLabel: true, startAt: true, endAt: true, activeKcal: true, syncedAt: true },
    });
    res.json({ records });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
