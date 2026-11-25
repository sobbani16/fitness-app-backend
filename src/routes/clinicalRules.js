// /super-admin/clinical-rules — governance workflow for ConditionRule,
// HealthConditionNutrientRule and ActivitySafetyRule (F-C2 remediation).
// Separation of duties is enforced in the service:
//   review/submit/reject/retire → CLINICAL_RULE_REVIEW or SUPER_ADMIN
//   approve                     → CLINICAL_RULE_APPROVE (CLINICAL_REVIEWER role)
//   activate/deactivate         → CLINICAL_RULE_ACTIVATE; activator ≠ approver
// Every action writes an immutable ClinicalRuleEvent — there is no silent path.
const router = require('express').Router();
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { requireFeature } = require('../middleware/requireFeature');
const { requirePermission } = require('../middleware/rbac');
const G = require('../services/healthOutcomes/clinicalRuleGovernance');

router.use(requireFeature('clinical_rule_admin'));

const REVIEWER = requirePermission('CLINICAL_RULE_REVIEW', 'CLINICAL_RULE_APPROVE', 'SUPER_ADMIN_PANEL');
const ACTIVATOR = requirePermission('CLINICAL_RULE_ACTIVATE');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const actor = (req) => req.userId || req.user?.id;
const TABLE_KEYS = Object.keys(G.TABLES);

// GET /super-admin/clinical-rules?table=&status=&q=
router.get('/', REVIEWER, wrap(async (req, res) => {
  const prisma = getPrisma();
  const { table, status, q } = req.query || {};
  const tables = table ? [table] : TABLE_KEYS;
  const out = {};
  for (const key of tables) {
    const t = G.TABLES[key];
    if (!t) throw httpError(400, `Unknown table '${key}'. Expected: ${TABLE_KEYS.join(', ')}`);
    const where = {};
    if (status) where.reviewStatus = String(status).toUpperCase();
    if (q) where[t.codeField] = { contains: String(q), mode: 'insensitive' };
    out[key] = await prisma[t.model].findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200 });
  }
  res.json({ rules: out, live: 'reviewStatus=APPROVED AND activeAt set AND not retired/expired' });
}));

// GET /super-admin/clinical-rules/events?ruleTable=&ruleId=&limit=
router.get('/events', REVIEWER, wrap(async (req, res) => {
  const { ruleTable, ruleId, limit } = req.query || {};
  const events = await getPrisma().clinicalRuleEvent.findMany({
    where: { ...(ruleTable ? { ruleTable } : {}), ...(ruleId ? { ruleId } : {}) },
    orderBy: { createdAt: 'desc' }, take: Math.min(parseInt(limit, 10) || 100, 500),
  });
  res.json({ events });
}));

// GET /super-admin/clinical-rules/review-queue — open patient-level escalations
router.get('/user-reviews', REVIEWER, wrap(async (req, res) => {
  const rows = await getPrisma().userClinicalReview.findMany({ where: { status: { in: ['open', 'in_review'] } }, orderBy: { requestedAt: 'asc' }, take: 200 });
  res.json({ reviews: rows });
}));

// POST /super-admin/clinical-rules/:table/:id/transition { action, notes?, reviewDueAt? }
// REVIEWER populates req.userPermissions; approve additionally requires the
// dedicated CLINICAL_RULE_APPROVE permission (review ≠ approve).
router.post('/:table/:id/transition', REVIEWER, wrap(async (req, res) => {
  const action = String(req.body?.action || '');
  if (action === 'approve' && !(req.userPermissions || []).includes('CLINICAL_RULE_APPROVE')) {
    throw httpError(403, 'CLINICAL_RULE_APPROVE permission required to approve clinical rules.');
  }
  const { rule, event } = await G.transition(getPrisma(), { tableKey: req.params.table, ruleId: req.params.id, action, actorId: actor(req), actorRole: req.body?.actorRole || null, notes: req.body?.notes, reviewDueAt: req.body?.reviewDueAt });
  res.json({ rule, event });
}));

// POST /super-admin/clinical-rules/:table/:id/activate { expiresAt?, reviewDueAt?, notes? }
router.post('/:table/:id/activate', ACTIVATOR, wrap(async (req, res) => {
  const { rule, event } = await G.activate(getPrisma(), { tableKey: req.params.table, ruleId: req.params.id, actorId: actor(req), actorRole: req.body?.actorRole || null, notes: req.body?.notes, expiresAt: req.body?.expiresAt, reviewDueAt: req.body?.reviewDueAt });
  res.json({ rule, event });
}));

// POST /super-admin/clinical-rules/:table/:id/deactivate { notes } — immediate stop.
router.post('/:table/:id/deactivate', ACTIVATOR, wrap(async (req, res) => {
  const { rule, event } = await G.deactivateNow(getPrisma(), { tableKey: req.params.table, ruleId: req.params.id, actorId: actor(req), actorRole: req.body?.actorRole || null, notes: req.body?.notes });
  res.json({ rule, event });
}));

module.exports = router;
