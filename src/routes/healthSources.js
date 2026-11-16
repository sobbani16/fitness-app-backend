// Wearable-ready health platform routes — /health-sources/*.
// Measurement ingest is idempotent; disconnect preserves history; deletion
// is a separate explicit action. Synthetic provider is internal-only.
const express = require('express');
const svc = require('../services/healthSources');
const { requireFeature } = require('../middleware/requireFeature');
const audit = require('../services/auditService');

const router = express.Router();
router.use(requireFeature('wearable_platform_enabled'));

const uid = (req) => req.userId || req.user.id;

router.get('/providers', async (req, res) => res.json({ providers: svc.listProviders(req.user) }));
router.get('/sources', async (req, res) => res.json({ sources: await svc.listSources(uid(req)) }));

router.post('/sources/:provider/connect', requireFeature('health_data_sources_enabled'), async (req, res) => {
  const src = await svc.connectSource(uid(req), req.params.provider, req.body || {});
  audit.log({ userId: uid(req), action: 'healthSource.connect', entity: 'HealthDataSource', entityId: src.id }).catch(() => {});
  res.json({ source: src });
});
router.post('/sources/:provider/disconnect', async (req, res) => {
  res.json(await svc.disconnectSource(uid(req), req.params.provider));
});
router.delete('/sources/:provider/data', async (req, res) => {
  const r = await svc.deleteSourceData(uid(req), req.params.provider);
  audit.log({ userId: uid(req), action: 'healthSource.deleteData', entity: 'HealthDataSource', entityId: req.params.provider }).catch(() => {});
  res.json(r);
});

// Ingest — the mobile provider adapters POST normalized records here.
router.post('/sources/:provider/measurements', requireFeature('health_data_sources_enabled'), async (req, res) => {
  const records = Array.isArray(req.body?.records) ? req.body.records.slice(0, 5000) : [];
  if (!records.length) return res.status(400).json({ error: 'records array required' });
  res.json(await svc.ingestMeasurements(uid(req), req.params.provider, records));
});

router.get('/metrics/:metric', async (req, res) => {
  res.json({ records: await svc.getSeries(uid(req), { metric: req.params.metric, from: req.query.from, to: req.query.to, includeSynthetic: req.query.includeSynthetic === '1' }) });
});
router.get('/metrics/:metric/daily', async (req, res) => {
  res.json(await svc.getDailySummary(uid(req), { metric: req.params.metric, days: Math.min(parseInt(req.query.days, 10) || 14, 90) }));
});
router.get('/recovery', async (req, res) => res.json(await svc.getRecovery(uid(req))));

// Internal synthetic provider — dev/internal testing only.
router.post('/sim/seed', async (req, res) => {
  if (process.env.NODE_ENV === 'production' && !req.user?.isSuperAdmin) {
    return res.status(403).json({ error: 'internal testing only' });
  }
  await svc.connectSource(uid(req), 'internal_sim', {});
  const r = await svc.ingestMeasurements(uid(req), 'internal_sim', svc.simFixtures('all', 7));
  res.json({ synthetic: true, ...r });
});

module.exports = router;
