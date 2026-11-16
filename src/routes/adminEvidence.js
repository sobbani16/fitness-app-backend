// Super-admin ingredient evidence review — /super-admin/ingredient-evidence.
// Lifecycle: DRAFT → IN_REVIEW → APPROVED/ACTIVE → NEEDS_REVIEW/RETIRED.
// Only APPROVED/ACTIVE profiles surface to members (foodIntel.getEvidence).
const express = require('express');
const prisma = require('../lib/prisma');
const { requirePermission } = require('../middleware/rbac');
const audit = require('../services/auditService');

const router = express.Router();
const AUTHOR = requirePermission('ACADEMY_AUTHOR');
const REVIEW = requirePermission('ACADEMY_REVIEW');
const STATUSES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'NEEDS_REVIEW', 'RETIRED'];

// List all profiles incl. drafts (admins see everything)
router.get('/', REVIEW, async (req, res) => {
  const profiles = await prisma.ingredientEvidenceProfile.findMany({ orderBy: [{ ingredientKey: 'asc' }, { version: 'desc' }] });
  res.json({ profiles });
});

// Create a new DRAFT profile (v1) or next version of an existing key
router.post('/', AUTHOR, async (req, res) => {
  const b = req.body || {};
  if (!b.ingredientKey || !b.displayName || !b.summary) return res.status(400).json({ error: 'ingredientKey, displayName, summary required' });
  const key = String(b.ingredientKey).toLowerCase().trim();
  const latest = await prisma.ingredientEvidenceProfile.findFirst({ where: { ingredientKey: key }, orderBy: { version: 'desc' } });
  const profile = await prisma.ingredientEvidenceProfile.create({
    data: {
      ingredientKey: key, displayName: b.displayName, summary: b.summary,
      claims: Array.isArray(b.claims) ? b.claims : [],
      cautions: Array.isArray(b.cautions) ? b.cautions : [],
      status: 'DRAFT', version: (latest?.version || 0) + 1,
      reviewedBy: req.userId || req.user?.id,
    },
  });
  audit.log({ userId: req.userId || req.user?.id, action: 'evidence.create', entity: 'IngredientEvidenceProfile', entityId: profile.id }).catch(() => {});
  res.status(201).json({ profile });
});

// Edit a DRAFT/NEEDS_REVIEW profile
router.patch('/:id', AUTHOR, async (req, res) => {
  const p = await prisma.ingredientEvidenceProfile.findUnique({ where: { id: req.params.id } });
  if (!p) return res.status(404).json({ error: 'not found' });
  if (!['DRAFT', 'NEEDS_REVIEW'].includes(p.status)) return res.status(409).json({ error: `cannot edit status ${p.status} — create a new version` });
  const b = req.body || {};
  const data = {};
  for (const k of ['displayName', 'summary']) if (typeof b[k] === 'string') data[k] = b[k];
  for (const k of ['claims', 'cautions']) if (Array.isArray(b[k])) data[k] = b[k];
  res.json({ profile: await prisma.ingredientEvidenceProfile.update({ where: { id: p.id }, data }) });
});

// Status transitions — reviewer gate. APPROVED/ACTIVE are what members see.
router.post('/:id/status', REVIEW, async (req, res) => {
  const { status } = req.body || {};
  if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  const p = await prisma.ingredientEvidenceProfile.findUnique({ where: { id: req.params.id } });
  if (!p) return res.status(404).json({ error: 'not found' });
  const reviewer = req.userId || req.user?.id;
  const profile = await prisma.ingredientEvidenceProfile.update({
    where: { id: p.id },
    data: { status, reviewedBy: reviewer, reviewedAt: new Date() },
  });
  audit.log({ userId: reviewer, action: `evidence.${status.toLowerCase()}`, entity: 'IngredientEvidenceProfile', entityId: p.id }).catch(() => {});
  res.json({ profile });
});

module.exports = router;
