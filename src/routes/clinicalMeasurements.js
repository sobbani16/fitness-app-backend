// /me/clinical-measurements — manual clinical/lab tracking (F-C4).
// Records are provenance-labeled (self-reported vs device vs lab vs clinician)
// and immutable — corrections create superseding rows, history is kept.
// This API never interprets results: no diagnosis, no remission, no verdicts.
const router = require('express').Router();
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { requireFeature } = require('../middleware/requireFeature');
const M = require('../services/healthOutcomes/measurementRegistry');
const audit = require('../services/auditService');
const { getUserId } = require('../middleware/rbac');
const uid = req => req.userId || getUserId(req);

router.use(requireFeature('clinical_measurements'));

const DISCLAIMER = 'Measurements you enter help you track progress. Humai never diagnoses conditions or declares improvement from a single result. Share trends with your clinician.';

// GET /me/clinical-measurements?metric=&from=&to=&limit=
router.get('/', async (req, res, next) => {
  try {
    const { metric, from, to, limit } = req.query || {};
    if (metric && !M.METRICS[metric]) throw httpError(400, 'Unknown metric.');
    const take = Math.min(parseInt(limit, 10) || 200, 500);
    const rows = await getPrisma().clinicalMeasurement.findMany({
      where: { userId: uid(req), ...(metric ? { metric } : {}), measuredAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } },
      orderBy: { measuredAt: 'desc' }, take,
    });
    res.json({ measurements: rows.map(M.view), metrics: Object.keys(M.METRICS), disclaimer: DISCLAIMER });
  } catch (e) { next(e); }
});

// POST /me/clinical-measurements { metric, value, valueSecondary?, unit, measuredAt, source?, method?, meta? }
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const v = M.validate(b.metric, b);
    if (v.error) throw httpError(400, v.error);
    const meta = { ...(typeof b.meta === 'object' && b.meta && !Array.isArray(b.meta) ? b.meta : {}) };
    if (v.normalized) meta.normalized = v.normalized;
    if (meta.refRange != null && typeof meta.refRange !== 'string') delete meta.refRange;
    const quality = b.source === 'lab_report' ? 'self_reported' : b.source === 'device' ? 'device_measured' : b.source === 'clinician' ? 'clinician_verified' : 'self_reported';
    const row = await getPrisma().clinicalMeasurement.create({
      data: {
        userId: uid(req), metric: b.metric, value: b.value, valueSecondary: b.valueSecondary ?? null,
        unit: b.unit, measuredAt: new Date(b.measuredAt), source: b.source || 'user_entry',
        method: b.method ?? null, quality, meta,
      },
    });
    await audit.log({ actorId: uid(req), action: 'clinical_measurement.add', entityType: 'ClinicalMeasurement', entityId: row.id, afterData: { metric: b.metric } }).catch(() => null);
    res.status(201).json({ measurement: M.view(row), disclaimer: DISCLAIMER });
  } catch (e) { next(e); }
});

// POST /me/clinical-measurements/:id/correct — immutable corrections: creates a
// superseding row; the original stays with meta.supersededBy set.
router.post('/:id/correct', async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const original = await prisma.clinicalMeasurement.findFirst({ where: { id: req.params.id, userId: uid(req) } });
    if (!original) throw httpError(404, 'Measurement not found.');
    const b = { metric: original.metric, unit: original.unit, measuredAt: original.measuredAt, source: original.source, method: original.method, ...req.body };
    const v = M.validate(b.metric, b);
    if (v.error) throw httpError(400, v.error);
    const meta = { ...(typeof original.meta === 'object' && original.meta ? original.meta : {}), ...(v.normalized ? { normalized: v.normalized } : {}) };
    const corrected = await prisma.$transaction(async (tx) => {
      const row = await tx.clinicalMeasurement.create({ data: { userId: uid(req), metric: original.metric, value: b.value, valueSecondary: b.valueSecondary ?? null, unit: b.unit, measuredAt: new Date(b.measuredAt), source: b.source, method: b.method ?? original.method, quality: original.quality, correctionOfId: original.id, meta } });
      await tx.clinicalMeasurement.update({ where: { id: original.id }, data: { meta: { ...(typeof original.meta === 'object' && original.meta ? original.meta : {}), supersededBy: row.id } } });
      return row;
    });
    await audit.log({ actorId: uid(req), action: 'clinical_measurement.correct', entityType: 'ClinicalMeasurement', entityId: corrected.id, afterData: { corrects: original.id } }).catch(() => null);
    res.status(201).json({ measurement: M.view(corrected), supersedes: original.id });
  } catch (e) { next(e); }
});

// DELETE /me/clinical-measurements/:id — user-owned entry removal.
router.delete('/:id', async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const row = await prisma.clinicalMeasurement.findFirst({ where: { id: req.params.id, userId: uid(req) } });
    if (!row) throw httpError(404, 'Measurement not found.');
    await prisma.clinicalMeasurement.delete({ where: { id: row.id } });
    await audit.log({ actorId: uid(req), action: 'clinical_measurement.remove', entityType: 'ClinicalMeasurement', entityId: row.id, afterData: { metric: row.metric } }).catch(() => null);
    res.json({ removed: true, id: row.id });
  } catch (e) { next(e); }
});

module.exports = router;
