// Clinical rule governance — lifecycle, activation, and audit for the three
// rule tables. Separation of duties:
//   - approval requires CLINICAL_RULE_APPROVE (CLINICAL_REVIEWER role)
//   - activation requires CLINICAL_RULE_ACTIVATE (SUPER_ADMIN) AND prior approval
//     by a *different* actor — an approver may not activate their own approval
//   - retirement can be executed by either role (safety stop always available)
//   - only APPROVED + activated + non-expired rules may fire (see isRuleActive)
// AI/provider content can never reach these functions — actions only exist as
// authenticated admin API calls with ClinicalRuleEvent provenance.
const { httpError } = require('../../lib/errors');

const TABLES = {
  conditionRule: { model: 'conditionRule', codeField: 'ruleCode' },
  nutrientRule: { model: 'healthConditionNutrientRule', codeField: 'code' },
  activitySafetyRule: { model: 'activitySafetyRule', codeField: 'ruleCode' },
};

// status transitions that change reviewStatus (activate/retire are column ops)
const TRANSITIONS = {
  submit:   { from: ['DRAFT', 'REJECTED'], to: 'IN_REVIEW', perm: 'review' },
  review:   { from: ['IN_REVIEW'], to: 'REVIEWED', perm: 'review' },
  approve:  { from: ['REVIEWED', 'IN_REVIEW'], to: 'APPROVED', perm: 'approve' },
  reject:   { from: ['IN_REVIEW', 'REVIEWED'], to: 'REJECTED', perm: 'review' },
  retire:   { from: ['DRAFT', 'IN_REVIEW', 'REVIEWED', 'APPROVED'], to: 'RETIRED', perm: 'review' }, // always stoppable
};

/** Effective firing predicate — approval alone is insufficient; activation is
 * required, and expiry/retirement/overdue-review always win. Legacy APPROVED
 * rows without activeAt do NOT fire until explicitly activated. */
function isRuleLive(rule, now = new Date()) {
  if (rule.reviewStatus !== 'APPROVED' || !rule.activeAt || rule.retiredAt) return false;
  if (rule.expiresAt && new Date(rule.expiresAt) <= now) return false;
  if (rule.reviewDueAt && new Date(rule.reviewDueAt) <= now) return false;
  return true;
}
const isRuleActive = isRuleLive;

/** Prisma where-fragment equivalent of isRuleLive — pushes the gate into SQL
 * so consumers cannot accidentally evaluate inactive rules. */
const liveRuleWhere = (now = new Date()) => ({
  reviewStatus: 'APPROVED',
  activeAt: { not: null },
  retiredAt: null,
  AND: [
    { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    { OR: [{ reviewDueAt: null }, { reviewDueAt: { gt: now } }] },
  ],
});

async function recordEvent(prisma, { ruleTable, ruleId, ruleCode, fromStatus, toStatus, action, actorId, actorRole, notes, diff }) {
  return prisma.clinicalRuleEvent.create({
    data: { ruleTable, ruleId, ruleCode: ruleCode || null, fromStatus, toStatus, action, actorId, actorRole: actorRole || null, notes: notes || null, diff: diff || undefined },
  });
}

async function getRule(prisma, tableKey, id) {
  const t = TABLES[tableKey];
  if (!t) throw httpError(400, `Unknown rule table. Expected one of: ${Object.keys(TABLES).join(', ')}`);
  const rule = await prisma[t.model].findUnique({ where: { id } });
  if (!rule) throw httpError(404, 'Rule not found.');
  return { t, rule };
}

async function transition(prisma, { tableKey, ruleId, action, actorId, actorRole, notes, reviewDueAt }) {
  const t = TRANSITIONS[action];
  if (!t) throw httpError(400, `Unknown action. Expected one of: ${[...Object.keys(TRANSITIONS), 'activate'].join(', ')}`);
  const { t: table, rule } = await getRule(prisma, tableKey, ruleId);
  if (!t.from.includes(rule.reviewStatus)) throw httpError(409, `Cannot ${action} a rule in ${rule.reviewStatus}.`);
  const data = { reviewStatus: t.to };
  if (action === 'approve') { data.reviewedBy = actorId; data.reviewedAt = new Date(); }
  if (action === 'retire') data.retiredAt = new Date();
  if (action === 'review' && reviewDueAt) data.reviewDueAt = new Date(reviewDueAt);
  const updated = await prisma[table.model].update({ where: { id: rule.id }, data });
  const event = await recordEvent(prisma, { ruleTable: table.model, ruleId: rule.id, ruleCode: rule[table.codeField], fromStatus: rule.reviewStatus, toStatus: t.to, action, actorId, actorRole, notes, diff: { reviewStatus: [rule.reviewStatus, t.to] } });
  return { rule: updated, event };
}

async function activate(prisma, { tableKey, ruleId, actorId, actorRole, notes, expiresAt, reviewDueAt }) {
  const { t, rule } = await getRule(prisma, tableKey, ruleId);
  if (rule.reviewStatus !== 'APPROVED') throw httpError(409, 'Only APPROVED rules can be activated.');
  if (rule.activeAt && !rule.retiredAt) throw httpError(409, 'Rule is already active.');
  if (rule.reviewedBy === actorId) throw httpError(403, 'The approving reviewer cannot activate their own approval.');
  const data = { activeAt: new Date(), activatedBy: actorId, retiredAt: null };
  if (expiresAt) data.expiresAt = new Date(expiresAt);
  if (reviewDueAt) data.reviewDueAt = new Date(reviewDueAt);
  const updated = await prisma[t.model].update({ where: { id: rule.id }, data });
  const event = await recordEvent(prisma, { ruleTable: t.model, ruleId: rule.id, ruleCode: rule[t.codeField], fromStatus: 'APPROVED', toStatus: 'ACTIVATED', action: 'activate', actorId, actorRole, notes, diff: { activeAt: [null, updated.activeAt] } });
  return { rule: updated, event };
}

async function deactivateNow(prisma, { tableKey, ruleId, actorId, actorRole, notes }) {
  const { t, rule } = await getRule(prisma, tableKey, ruleId);
  if (rule.retiredAt || !rule.activeAt) throw httpError(409, 'Rule is not active.');
  const updated = await prisma[t.model].update({ where: { id: rule.id }, data: { retiredAt: new Date() } });
  const event = await recordEvent(prisma, { ruleTable: t.model, ruleId: rule.id, ruleCode: rule[t.codeField], fromStatus: 'ACTIVATED', toStatus: 'DEACTIVATED', action: 'deactivate', actorId, actorRole, notes });
  return { rule: updated, event };
}

module.exports = { TABLES, TRANSITIONS, isRuleActive, isRuleLive, liveRuleWhere, transition, activate, deactivateNow, recordEvent, getRule };
