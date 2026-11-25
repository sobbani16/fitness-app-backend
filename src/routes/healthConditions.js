// /me/health-conditions — the user's own health-condition list (F-C1 fix).
// Identity is always uid(req); no path can read or write another user's
// conditions. Catalog rows come from the versioned condition registry —
// unregistered conditions are rejected rather than invented. Writes re-validate
// nothing downstream eagerly: every safety/recommendation surface already
// reads userHealthCondition live per request.
const router = require('express').Router();
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { requireFeature } = require('../middleware/requireFeature');
const R = require('../services/healthOutcomes/conditionRegistry');
const audit = require('../services/auditService');
const { getUserId } = require('../middleware/rbac');
const uid = req => req.userId || getUserId(req);
const { revalidateActivePlans } = require('../services/allergyRevalidation');

router.use(requireFeature('health_conditions'));

const CONSENT_COPY = 'Humai uses your conditions to filter and personalize nutrition and activity suggestions. This is not a diagnosis and does not replace medical care. A self-reported condition is not treated as clinician-confirmed. You can remove it anytime; removal stops it from affecting new recommendations.';

const SOURCES = new Set(['self_report', 'clinician_reported']);
const SEVERITIES = new Set(['mild', 'moderate', 'severe']);
const validDate = (v) => v == null || (!Number.isNaN(new Date(v).getTime()) && new Date(v) <= new Date());

// GET /me/health-conditions — active + inactive list for the caller.
router.get('/', async (req, res, next) => {
  try {
    const rows = await R.loadUserConditions(getPrisma(), uid(req), { includeInactive: true });
    res.json({
      conditions: rows.filter(r => r.active).map(R.view),
      inactive: rows.filter(r => !r.active).map(R.view),
      consentCopy: CONSENT_COPY,
    });
  } catch (e) { next(e); }
});

// GET /me/health-conditions/catalog — supported conditions (same shape as the
// public /health-conditions route; kept here for a single client call path).
router.get('/catalog', async (req, res, next) => {
  try { res.json({ catalog: await R.catalog(getPrisma()), consentCopy: CONSENT_COPY }); } catch (e) { next(e); }
});

// GET /me/health-conditions/plan — the shared personalization resolution:
// one coherent precedence-resolved plan over conditions + meds + allergies +
// life-stage + rules. Status: RESOLVED | EDUCATION_ONLY | PERSONALIZATION_REQUIRED
// | URGENT_ESCALATION. Never fabricates guidance when inputs are insufficient.
router.get('/plan', async (req, res, next) => {
  try {
    const { resolvePlan } = require('../services/health/engine');
    res.json({ plan: await resolvePlan(getPrisma(), uid(req), { purpose: String(req.query?.purpose || 'plan') }) });
  } catch (e) { next(e); }
});

// POST /me/health-conditions — add a condition.
// { slug | conditionId, source?, severity?, diagnosedAt?, notes?, consent: true }
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.consent !== true) throw httpError(400, 'consent: true is required to record a health condition.');
    if (b.source != null && !SOURCES.has(b.source)) throw httpError(400, `source must be one of: ${[...SOURCES].join(', ')}`);
    if (b.severity != null && !SEVERITIES.has(b.severity)) throw httpError(400, `severity must be one of: ${[...SEVERITIES].join(', ')}`);
    if (!validDate(b.diagnosedAt)) throw httpError(400, 'diagnosedAt must be a past date.');
    if (b.notes != null && (typeof b.notes !== 'string' || b.notes.length > 500)) throw httpError(400, 'notes must be ≤ 500 characters.');
    const prisma = getPrisma();
    const { row, slug } = await R.ensureConditionRow(prisma, { slug: b.slug, conditionId: b.conditionId, httpError });
    const meta = slug ? R.REGISTRY[slug] : null;
    if (meta && meta.evidenceClass === 'allergy') throw httpError(400, 'Allergies are managed in the allergy settings, not health conditions.');

    const now = new Date();
    const saved = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${uid(req)} FOR UPDATE`;
      const existing = await tx.userHealthCondition.findFirst({ where: { userId: uid(req), conditionId: row.id } });
      if (existing?.active) {
        // Idempotent re-save: update fields, keep one active row per condition.
        return tx.userHealthCondition.update({
          where: { id: existing.id },
          data: {
            severity: b.severity ?? existing.severity,
            source: b.source ?? existing.source,
            diagnosedAt: b.diagnosedAt ? new Date(b.diagnosedAt) : existing.diagnosedAt,
            notes: b.notes !== undefined ? b.notes : existing.notes,
            lastConfirmedAt: now,
          },
          include: { condition: true },
        });
      }
      if (existing) {
        return tx.userHealthCondition.update({
          where: { id: existing.id },
          data: { active: true, severity: b.severity ?? null, source: b.source || 'self_report', diagnosedAt: b.diagnosedAt ? new Date(b.diagnosedAt) : null, notes: b.notes ?? null, consentedAt: now, lastConfirmedAt: now },
          include: { condition: true },
        });
      }
      return tx.userHealthCondition.create({
        data: { userId: uid(req), conditionId: row.id, severity: b.severity ?? null, source: b.source || 'self_report', diagnosedAt: b.diagnosedAt ? new Date(b.diagnosedAt) : null, notes: b.notes ?? null, consentedAt: now, lastConfirmedAt: now },
        include: { condition: true },
      });
    });
    await audit.log({ actorId: uid(req), action: 'health_condition.add', entityType: 'UserHealthCondition', entityId: saved.id, afterData: { slug, source: saved.source } }).catch(() => null);
    await revalidateActivePlans(prisma, uid(req)).catch(() => null);
    res.status(201).json({ condition: R.view(saved), consentCopy: CONSENT_COPY });
  } catch (e) { next(e); }
});

// PATCH /me/health-conditions/:id — update severity/source/diagnosedAt/notes.
router.patch('/:id', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.source != null && !SOURCES.has(b.source)) throw httpError(400, `source must be one of: ${[...SOURCES].join(', ')}`);
    if (b.severity != null && b.severity !== null && !SEVERITIES.has(b.severity)) throw httpError(400, `severity must be one of: ${[...SEVERITIES].join(', ')}`);
    if (!validDate(b.diagnosedAt)) throw httpError(400, 'diagnosedAt must be a past date.');
    if (b.notes != null && (typeof b.notes !== 'string' || b.notes.length > 500)) throw httpError(400, 'notes must be ≤ 500 characters.');
    const prisma = getPrisma();
    const row = await prisma.userHealthCondition.findFirst({ where: { id: req.params.id, userId: uid(req) } });
    if (!row) throw httpError(404, 'Condition not found.');
    const updated = await prisma.userHealthCondition.update({
      where: { id: row.id },
      data: {
        ...(b.severity !== undefined ? { severity: b.severity } : {}),
        ...(b.source ? { source: b.source } : {}),
        ...(b.diagnosedAt !== undefined ? { diagnosedAt: b.diagnosedAt ? new Date(b.diagnosedAt) : null } : {}),
        ...(b.notes !== undefined ? { notes: b.notes } : {}),
        lastConfirmedAt: new Date(),
      },
      include: { condition: true },
    });
    await audit.log({ actorId: uid(req), action: 'health_condition.update', entityType: 'UserHealthCondition', entityId: row.id, afterData: { severity: updated.severity, source: updated.source } }).catch(() => null);
    res.json({ condition: R.view(updated) });
  } catch (e) { next(e); }
});

// DELETE /me/health-conditions/:id — deactivate (keeps provenance; active=false
// removes it from every recommendation surface that reads active rows).
router.delete('/:id', async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const row = await prisma.userHealthCondition.findFirst({ where: { id: req.params.id, userId: uid(req) } });
    if (!row) throw httpError(404, 'Condition not found.');
    await prisma.userHealthCondition.update({ where: { id: row.id }, data: { active: false, lastConfirmedAt: new Date() } });
    await audit.log({ actorId: uid(req), action: 'health_condition.remove', entityType: 'UserHealthCondition', entityId: row.id }).catch(() => null);
    await revalidateActivePlans(prisma, uid(req)).catch(() => null);
    res.json({ removed: true, id: row.id });
  } catch (e) { next(e); }
});

module.exports = router;
